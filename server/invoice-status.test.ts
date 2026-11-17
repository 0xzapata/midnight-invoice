import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

async function freshWorkspace() {
  const clock = new TestClock(); // 2026-11-17T10:00:00Z → "today" = 2026-11-17 (UTC)
  const { app } = buildApp(d1.db, { clock: clock.fn });
  const client = api(app);
  const ws = await createWorkspace(client);
  return { client, clock, token: ws.token, workspaceId: ws.workspace.id };
}

type Client = Awaited<ReturnType<typeof freshWorkspace>>['client'];

async function create(client: Client, token: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post('/api/v1/invoices', sampleInvoice(overrides), token);
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${res.text}`);
  return res.json.invoice;
}

const numbers = (res: { json: { invoices: { invoiceNumber: string }[] } }) => res.json.invoices.map((i) => i.invoiceNumber).sort();

describe('status on invoices', () => {
  it('defaults to draft and exposes derived overdue fields', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token, { dueDate: '2026-11-01' });
    expect(inv).toMatchObject({ status: 'draft', sentAt: null, paidAt: null, isOverdue: false, daysOverdue: 0 });

    const sent = await create(client, token, { status: 'sent', dueDate: '2026-11-10' });
    expect(sent).toMatchObject({ status: 'sent', sentAt: '2026-11-17', paidAt: null, isOverdue: true, daysOverdue: 7 });

    const paid = await create(client, token, { status: 'paid', paidAt: '2026-11-03' });
    expect(paid).toMatchObject({ status: 'paid', sentAt: '2026-11-03', paidAt: '2026-11-03', isOverdue: false });
  });

  it('reads rows written before statuses existed as draft', async () => {
    const { client, token, workspaceId } = await freshWorkspace();
    const inv = await create(client, token, { dueDate: '2020-01-01' });
    // Simulate a pre-0002 row: strip the status keys from the stored JSON.
    await d1.db
      .prepare(`UPDATE invoices SET data = json_remove(data, '$.status', '$.sentAt', '$.paidAt') WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, inv.id)
      .run();
    const got = await client.get(`/api/v1/invoices/${inv.id}`, token);
    expect(got.json.invoice).toMatchObject({ status: 'draft', sentAt: null, paidAt: null, isOverdue: false });
    expect(numbers(await client.get('/api/v1/invoices?status=draft', token))).toEqual([inv.invoiceNumber]);
    expect((await client.get('/api/v1/invoices?status=overdue', token)).json.invoices).toEqual([]);
    // And it can be marked sent like any draft.
    const marked = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token);
    expect(marked.json.invoice).toMatchObject({ status: 'sent', isOverdue: true });
  });

  it('PUT replace keeps the status when omitted and accepts any status (sync)', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token);
    await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token);
    const put = await client.put(`/api/v1/invoices/${inv.id}`, sampleInvoice({ notes: 'edited' }), token);
    expect(put.json.invoice).toMatchObject({ status: 'sent', sentAt: '2026-11-17', notes: 'edited' });
    // A full-state write (offline draft → sent → paid) arrives as one PUT.
    const fresh = await create(client, token);
    const paid = await client.put(`/api/v1/invoices/${fresh.id}`, sampleInvoice({ status: 'paid', paidAt: '2026-11-15', sentAt: '2026-11-14' }), token);
    expect(paid.status).toBe(200);
    expect(paid.json.invoice).toMatchObject({ status: 'paid', paidAt: '2026-11-15', sentAt: '2026-11-14' });
  });

  it('PATCH enforces the transition rules', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token);
    const bad = await client.patch(`/api/v1/invoices/${inv.id}`, { status: 'paid' }, token);
    expect(bad.status).toBe(409);
    expect(bad.json.error).toMatchObject({ code: 'invalid_status_transition', details: { from: 'draft', to: 'paid', allowed: ['sent', 'void'] } });
    const sent = await client.patch(`/api/v1/invoices/${inv.id}`, { status: 'sent', notes: 'sent by mail' }, token);
    expect(sent.json.invoice).toMatchObject({ status: 'sent', sentAt: '2026-11-17', notes: 'sent by mail', revision: 2 });
    const paid = await client.patch(`/api/v1/invoices/${inv.id}`, { status: 'paid', paidAt: '2026-11-16' }, token);
    expect(paid.json.invoice).toMatchObject({ status: 'paid', paidAt: '2026-11-16' });
    // A content-only PATCH leaves the status alone.
    const notes = await client.patch(`/api/v1/invoices/${inv.id}`, { notes: 'thanks' }, token);
    expect(notes.json.invoice).toMatchObject({ status: 'paid', paidAt: '2026-11-16', notes: 'thanks' });
    expect((await client.patch(`/api/v1/invoices/${inv.id}`, { status: 'shipped' }, token)).status).toBe(400);
  });
});

describe('mark-* endpoints', () => {
  it('walks draft → sent → paid → reopen → void → reopen with ETags', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token, { dueDate: '2026-12-01' });

    const sent = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token, { 'if-match': '"1"' });
    expect(sent.status).toBe(200);
    expect(sent.headers.get('etag')).toBe('"2"');
    expect(sent.json.invoice).toMatchObject({ status: 'sent', sentAt: '2026-11-17', revision: 2, updatedBy: { type: 'user' } });

    const paid = await client.post(`/api/v1/invoices/${inv.id}/mark-paid`, { paidAt: '2026-11-16' }, token);
    expect(paid.json.invoice).toMatchObject({ status: 'paid', paidAt: '2026-11-16', revision: 3 });

    const reopened = await client.post(`/api/v1/invoices/${inv.id}/reopen`, undefined, token);
    expect(reopened.json.invoice).toMatchObject({ status: 'sent', paidAt: null, sentAt: '2026-11-17' });

    const voided = await client.post(`/api/v1/invoices/${inv.id}/void`, undefined, token);
    expect(voided.json.invoice).toMatchObject({ status: 'void', sentAt: '2026-11-17', paidAt: null });

    const back = await client.post(`/api/v1/invoices/${inv.id}/reopen`, undefined, token);
    expect(back.json.invoice).toMatchObject({ status: 'sent', revision: 6 });
  });

  it('is a no-op when repeated, 409 when not allowed, and validates the body', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token);
    await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token);
    const again = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token);
    expect(again.status).toBe(200);
    expect(again.json.invoice.revision).toBe(2);

    const reopenSent = await client.post(`/api/v1/invoices/${inv.id}/reopen`, undefined, token);
    expect(reopenSent.status).toBe(409);
    expect(reopenSent.json.error.code).toBe('invalid_status_transition');

    const draft = await create(client, token);
    const payDraft = await client.post(`/api/v1/invoices/${draft.id}/mark-paid`, undefined, token);
    expect(payDraft.status).toBe(409);
    expect(payDraft.json.error.details).toMatchObject({ from: 'draft', action: 'mark_paid' });

    expect((await client.post(`/api/v1/invoices/${inv.id}/mark-paid`, { paidAt: '16/11/2026' }, token)).status).toBe(400);
    expect((await client.post(`/api/v1/invoices/${inv.id}/mark-paid`, { paidAt: '2026-02-30' }, token)).status).toBe(400);
  });

  it('honours If-Match and handles missing / deleted invoices', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token);
    const stale = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, token, { 'if-match': '"7"' });
    expect(stale.status).toBe(412);
    expect(stale.json.error.details).toMatchObject({ currentRevision: 1 });
    expect((await client.get(`/api/v1/invoices/${inv.id}`, token)).json.invoice.status).toBe('draft');

    expect((await client.post('/api/v1/invoices/00000000-0000-4000-8000-000000000000/void', undefined, token)).status).toBe(404);
    expect((await client.post('/api/v1/invoices/not-a-uuid/void', undefined, token)).status).toBe(400);
    await client.del(`/api/v1/invoices/${inv.id}`, token);
    expect((await client.post(`/api/v1/invoices/${inv.id}/void`, undefined, token)).status).toBe(410);
  });

  it('requires invoices:write and attributes the change to the agent', async () => {
    const { client, token } = await freshWorkspace();
    const inv = await create(client, token);
    const reader = await connectAgent(client, token, ['invoices:read']);
    const denied = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, reader.api_key);
    expect(denied.status).toBe(403);
    expect(denied.json.error).toMatchObject({ code: 'insufficient_scope', details: { requiredScope: 'invoices:write' } });
    expect((await client.get('/api/v1/invoices/summary', reader.api_key)).status).toBe(200);

    const writer = await connectAgent(client, token, ['invoices:write'], undefined, 'Bookkeeper');
    expect((await client.get('/api/v1/invoices/summary', writer.api_key)).status).toBe(403);
    const ok = await client.post(`/api/v1/invoices/${inv.id}/mark-sent`, undefined, writer.api_key);
    expect(ok.json.invoice.updatedBy).toMatchObject({ type: 'agent', agentName: 'Bookkeeper' });
    expect((await client.post(`/api/v1/invoices/${inv.id}/mark-sent`)).status).toBe(401);
  });
});

describe('GET /invoices filters', () => {
  async function seed() {
    const ctx = await freshWorkspace();
    const { client, token } = ctx;
    const mk = (o: Record<string, unknown>) => create(client, token, o);
    const items = {
      draft: await mk({ toName: 'Acme Corp', dueDate: '2026-11-01' }),
      dueYesterday: await mk({ toName: 'Globex GmbH', status: 'sent', dueDate: '2026-11-16' }),
      dueToday: await mk({ toName: 'Initech', status: 'sent', dueDate: '2026-11-17' }),
      dueTomorrow: await mk({ toName: 'globex inc', status: 'sent', dueDate: '2026-11-18' }),
      noDue: await mk({ toName: 'Umbrella', status: 'sent' }),
      paid: await mk({ toName: 'Acme Corp', status: 'paid', dueDate: '2026-10-01' }),
      voided: await mk({ toName: 'Hooli', status: 'void', dueDate: '2026-10-01' }),
    };
    return { ...ctx, items };
  }

  it('filters by status, the virtual overdue (boundary: due today is not overdue) and combinations', async () => {
    const { client, token, items } = await seed();
    const n = (o: { invoiceNumber: string }) => o.invoiceNumber;
    const overdue = await client.get('/api/v1/invoices?status=overdue', token);
    expect(numbers(overdue)).toEqual([n(items.dueYesterday)]);
    expect(overdue.json.invoices[0]).toMatchObject({ isOverdue: true, daysOverdue: 1 });
    expect(numbers(await client.get('/api/v1/invoices?status=sent', token))).toEqual(
      [items.dueYesterday, items.dueToday, items.dueTomorrow, items.noDue].map(n).sort(),
    );
    expect(numbers(await client.get('/api/v1/invoices?status=paid,overdue', token))).toEqual([items.dueYesterday, items.paid].map(n).sort());
    expect(numbers(await client.get('/api/v1/invoices?status=draft,%20void', token))).toEqual([items.draft, items.voided].map(n).sort());
    expect((await client.get('/api/v1/invoices?status=late', token)).status).toBe(400);
    expect((await client.get('/api/v1/invoices?status=', token)).status).toBe(400);
  });

  it('filters by due date (strict bounds, no due date never matches) and client substring', async () => {
    const { client, token, items } = await seed();
    const n = (o: { invoiceNumber: string }) => o.invoiceNumber;
    expect(numbers(await client.get('/api/v1/invoices?due_before=2026-11-17', token))).toEqual(
      [items.draft, items.dueYesterday, items.paid, items.voided].map(n).sort(),
    );
    expect(numbers(await client.get('/api/v1/invoices?due_after=2026-11-16&due_before=2026-11-18', token))).toEqual([n(items.dueToday)]);
    expect(numbers(await client.get('/api/v1/invoices?client=GLOBEX', token))).toEqual([items.dueYesterday, items.dueTomorrow].map(n).sort());
    expect(numbers(await client.get('/api/v1/invoices?client=acme&status=paid', token))).toEqual([n(items.paid)]);
    expect(numbers(await client.get(`/api/v1/invoices?client=${encodeURIComponent('%')}`, token))).toEqual([]);
    expect((await client.get('/api/v1/invoices?due_before=17-11-2026', token)).status).toBe(400);
  });

  it('keeps sync semantics: filters combine with updated_since, paging and tombstones', async () => {
    const { client, token, items } = await seed();
    const page1 = await client.get('/api/v1/invoices?status=sent&limit=2', token);
    expect(page1.json.hasMore).toBe(true);
    const { updated_since, after_id } = page1.json.next;
    const page2 = await client.get(`/api/v1/invoices?status=sent&limit=2&updated_since=${encodeURIComponent(updated_since)}&after_id=${after_id}`, token);
    expect(page2.json.hasMore).toBe(false);
    const all = [...page1.json.invoices, ...page2.json.invoices].map((i: { id: string }) => i.id);
    expect(new Set(all).size).toBe(4);

    await client.del(`/api/v1/invoices/${items.dueYesterday.id}`, token);
    expect((await client.get('/api/v1/invoices?status=overdue', token)).json.invoices).toEqual([]);
    const withTombstones = await client.get('/api/v1/invoices?status=overdue&include_deleted=true', token);
    expect(withTombstones.json.invoices.map((i: { id: string; deletedAt: string | null }) => [i.id, i.deletedAt !== null])).toEqual([[items.dueYesterday.id, true]]);
    const since = await client.get(`/api/v1/invoices?status=draft&updated_since=${encodeURIComponent(page1.json.syncedAt)}`, token);
    expect(since.json.invoices).toEqual([]);
  });

  it('uses the UTC date as "today" (an invoice becomes overdue at 00:00 UTC)', async () => {
    const { client, token, clock } = await freshWorkspace();
    const inv = await create(client, token, { status: 'sent', dueDate: '2026-11-17' });
    clock.now = new Date('2026-11-17T23:59:59.999Z');
    expect((await client.get(`/api/v1/invoices/${inv.id}`, token)).json.invoice.isOverdue).toBe(false);
    expect((await client.get('/api/v1/invoices?status=overdue', token)).json.invoices).toEqual([]);
    clock.now = new Date('2026-11-18T00:00:00.000Z');
    expect((await client.get(`/api/v1/invoices/${inv.id}`, token)).json.invoice).toMatchObject({ isOverdue: true, daysOverdue: 1 });
    expect(numbers(await client.get('/api/v1/invoices?status=overdue', token))).toEqual([inv.invoiceNumber]);
  });
});

describe('GET /invoices/summary', () => {
  it('groups counts and totals by currency and lists the oldest overdue invoices', async () => {
    const { client, token } = await freshWorkspace();
    const line = (price: number) => [{ description: 'Work', quantity: 1, price }];
    await create(client, token, { currency: 'EUR', lineItems: line(10) });
    await create(client, token, { currency: 'EUR', status: 'sent', dueDate: '2026-12-01', lineItems: line(100) });
    const oldEur = await create(client, token, { currency: 'EUR', status: 'sent', dueDate: '2026-11-01', lineItems: line(200), taxRate: 10 });
    await create(client, token, { currency: 'EUR', status: 'paid', paidAt: '2026-11-05', lineItems: line(300) });
    await create(client, token, { currency: 'EUR', status: 'paid', paidAt: '2026-02-05', lineItems: line(400) });
    await create(client, token, { currency: 'EUR', status: 'void', dueDate: '2026-01-01', lineItems: line(999) });
    const oldUsd = await create(client, token, { currency: 'USD', status: 'sent', dueDate: '2026-10-17', lineItems: line(50) });
    const deleted = await create(client, token, { currency: 'GBP', status: 'sent', dueDate: '2026-01-01', lineItems: line(5) });
    await client.del(`/api/v1/invoices/${deleted.id}`, token);

    const res = await client.get('/api/v1/invoices/summary', token);
    expect(res.status).toBe(200);
    expect(res.json.asOf).toBe('2026-11-17');
    expect(res.json.currencies).toEqual([
      {
        currency: 'EUR',
        draft: { count: 1, total: 10 },
        outstanding: { count: 1, total: 100 },
        overdue: { count: 1, total: 220 },
        paidThisMonth: { count: 1, total: 300 },
        paidThisYear: { count: 2, total: 700 },
      },
      {
        currency: 'USD',
        draft: { count: 0, total: 0 },
        outstanding: { count: 0, total: 0 },
        overdue: { count: 1, total: 50 },
        paidThisMonth: { count: 0, total: 0 },
        paidThisYear: { count: 0, total: 0 },
      },
    ]);
    expect(res.json.oldestOverdue).toEqual([
      { id: oldUsd.id, invoiceNumber: oldUsd.invoiceNumber, toName: 'Acme Corp', currency: 'USD', total: 50, dueDate: '2026-10-17', daysOverdue: 31 },
      { id: oldEur.id, invoiceNumber: oldEur.invoiceNumber, toName: 'Acme Corp', currency: 'EUR', total: 220, dueDate: '2026-11-01', daysOverdue: 16 },
    ]);
    const limited = await client.get('/api/v1/invoices/summary?oldest_overdue_limit=1', token);
    expect(limited.json.oldestOverdue.map((o: { id: string }) => o.id)).toEqual([oldUsd.id]);
    expect((await client.get('/api/v1/invoices/summary?oldest_overdue_limit=500', token)).status).toBe(400);
  });

  it('is empty for an empty workspace and requires auth', async () => {
    const { client, token } = await freshWorkspace();
    expect((await client.get('/api/v1/invoices/summary', token)).json).toEqual({ asOf: '2026-11-17', currencies: [], oldestOverdue: [] });
    expect((await client.get('/api/v1/invoices/summary')).status).toBe(401);
  });
});
