import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scope } from '../shared/api';
import { api, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

function setup() {
  const clock = new TestClock();
  const { app } = buildApp(d1.db, { clock: clock.fn });
  return { client: api(app), clock };
}

async function freshWorkspace() {
  const { client, clock } = setup();
  const ws = await createWorkspace(client);
  return { client, clock, token: ws.token, workspaceId: ws.workspace.id };
}

const SETTINGS = {
  fromName: 'Midnight Studio LLC',
  fromEmail: 'billing@midnight.example',
  fromAddress: '1 Night St\nOakland',
  paymentDetails: 'IBAN DE00 1234',
  notes: 'Default notes',
  taxRate: 19,
  currency: 'EUR',
};

describe('invoice CRUD', () => {
  it('creates with server-computed totals, number allocation, defaults and attribution', async () => {
    const { client, token } = await freshWorkspace();
    const res = await client.post(
      '/api/v1/invoices',
      sampleInvoice({ taxRate: 10, lineItems: [{ description: 'A', quantity: 3, price: 33.33 }, { description: 'B', quantity: 1, price: 0.1 }] }),
      token,
    );
    expect(res.status).toBe(201);
    const inv = res.json.invoice;
    expect(res.headers.get('etag')).toBe('"1"');
    expect(res.headers.get('location')).toBe(`/api/v1/invoices/${inv.id}`);
    expect(inv).toMatchObject({
      invoiceNumber: 'INV-0001',
      issueDate: '2026-11-17',
      dueDate: '',
      currency: 'USD',
      revision: 1,
      deletedAt: null,
      version: 2,
      subtotal: 100.09,
      taxAmount: 10.01,
      total: 110.1,
      createdBy: { type: 'user' },
      updatedBy: { type: 'user' },
    });
    expect(inv.lineItems.every((li: { id: string }) => /^[0-9a-f-]{36}$/.test(li.id))).toBe(true);
    expect(inv.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const got = await client.get(`/api/v1/invoices/${inv.id}`, token);
    expect(got.status).toBe(200);
    expect(got.json.invoice).toEqual(inv);
  });

  it('applies workspace settings as defaults on create', async () => {
    const { client, token } = await freshWorkspace();
    expect((await client.get('/api/v1/settings', token)).json).toEqual({
      settings: { fromName: '', fromEmail: '', fromAddress: '', paymentDetails: '', notes: '', taxRate: 0, currency: 'USD' },
      updatedAt: null,
    });
    const put = await client.put('/api/v1/settings', SETTINGS, token);
    expect(put.status).toBe(200);
    expect(put.json.settings).toEqual(SETTINGS);
    const res = await client.post('/api/v1/invoices', { toName: 'Client', lineItems: [{ description: 'X', quantity: 1, price: 100 }] }, token);
    expect(res.status).toBe(201);
    expect(res.json.invoice).toMatchObject({
      fromName: SETTINGS.fromName,
      fromEmail: SETTINGS.fromEmail,
      fromAddress: SETTINGS.fromAddress,
      paymentDetails: SETTINGS.paymentDetails,
      taxRate: 19,
      currency: 'EUR',
      notes: '',
      total: 119,
    });
    // Explicit values win over defaults.
    const explicit = await client.post('/api/v1/invoices', sampleInvoice({ currency: 'GBP', taxRate: 0, fromName: 'Other' }), token);
    expect(explicit.json.invoice).toMatchObject({ currency: 'GBP', taxRate: 0, fromName: 'Other' });
  });

  it('requires a sender name when neither the body nor settings provide one', async () => {
    const { client, token } = await freshWorkspace();
    const res = await client.post('/api/v1/invoices', { toName: 'Client', lineItems: [{ description: 'X', quantity: 1, price: 1 }] }, token);
    expect(res.status).toBe(400);
    expect(res.json.error.details).toContainEqual({ path: 'fromName', message: 'Your name/company is required' });
  });

  it('validates input with a consistent error shape and size caps', async () => {
    const { client, token } = await freshWorkspace();
    const bad = [
      sampleInvoice({ lineItems: [] }),
      sampleInvoice({ lineItems: Array.from({ length: 201 }, () => ({ description: 'x', quantity: 1, price: 1 })) }),
      sampleInvoice({ taxRate: 101 }),
      sampleInvoice({ currency: 'XXX' }),
      sampleInvoice({ issueDate: '17/11/2026' }),
      sampleInvoice({ issueDate: '2026-02-30' }),
      sampleInvoice({ toEmail: 'not-an-email' }),
      sampleInvoice({ toName: 'x'.repeat(201) }),
      sampleInvoice({ notes: 'x'.repeat(5001) }),
      sampleInvoice({ lineItems: [{ description: '', quantity: 1, price: 1 }] }),
      sampleInvoice({ lineItems: [{ description: 'x', quantity: -1, price: 1 }] }),
      sampleInvoice({ lineItems: [{ id: 'a', description: 'x', quantity: 1, price: 1 }, { id: 'a', description: 'y', quantity: 1, price: 1 }] }),
      { lineItems: [{ description: 'x', quantity: 1, price: 1 }] },
    ];
    for (const body of bad) {
      const res = await client.post('/api/v1/invoices', body, token);
      expect(res.status, JSON.stringify(body).slice(0, 120)).toBe(400);
      expect(res.json.error.code).toBe('validation_failed');
      expect(Array.isArray(res.json.error.details)).toBe(true);
    }
    const tooBig = await client.post('/api/v1/invoices', sampleInvoice({ notes: 'x'.repeat(300 * 1024) }), token);
    expect(tooBig.status).toBe(413);
    expect((await client.post('/api/v1/invoices', '{', token)).json.error.code).toBe('invalid_json');
    expect((await client.post('/api/v1/invoices', undefined, token)).status).toBe(400);
    expect((await client.get('/api/v1/invoices/not-a-uuid', token)).status).toBe(400);
    expect((await client.get('/api/v1/invoices?limit=0', token)).status).toBe(400);
    expect((await client.get('/api/v1/invoices?updated_since=yesterday', token)).status).toBe(400);
  });

  it('PUT upserts with a client UUID (201 then 200), keeping createdAt/createdBy', async () => {
    const { client, token } = await freshWorkspace();
    const id = crypto.randomUUID();
    const local = {
      id,
      invoiceNumber: 'INV-0042',
      invoiceName: 'Cosmic Phoenix 7',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      fromName: 'Me',
      fromAddress: '',
      fromEmail: '',
      toName: 'You',
      toAddress: '',
      toEmail: '',
      lineItems: [{ id: 'li-1', description: 'Thing', quantity: 1, price: 10 }],
      taxRate: 0,
      notes: '',
      paymentDetails: '',
      currency: 'USD',
      createdAt: '2026-10-01T08:00:00.000Z',
      version: 2,
    };
    const created = await client.put(`/api/v1/invoices/${id}`, local, token);
    expect(created.status).toBe(201);
    expect(created.json.invoice).toMatchObject({ ...local, revision: 1, createdAt: '2026-10-01T08:00:00.000Z' });

    const replaced = await client.put(`/api/v1/invoices/${id}`, { ...local, toName: 'Someone else', createdAt: '2020-01-01T00:00:00Z' }, token);
    expect(replaced.status).toBe(200);
    expect(replaced.json.invoice).toMatchObject({ toName: 'Someone else', revision: 2, createdAt: '2026-10-01T08:00:00.000Z', createdBy: { type: 'user' } });
    expect(replaced.json.invoice.updatedAt >= created.json.invoice.updatedAt).toBe(true);

    // Round-tripping a full API response (with totals etc.) is accepted.
    const roundTrip = await client.put(`/api/v1/invoices/${id}`, replaced.json.invoice, token);
    expect(roundTrip.status).toBe(200);

    // Body id must match.
    const mismatch = await client.put(`/api/v1/invoices/${id}`, { ...local, id: crypto.randomUUID() }, token);
    expect(mismatch.status).toBe(400);
    // Next number honours client-chosen numbers (INV-0042 → INV-0043).
    expect((await client.get('/api/v1/invoices/next-number', token)).json).toEqual({ invoiceNumber: 'INV-0043' });
  });

  it('PATCH merges fields, regenerates totals and validates the result', async () => {
    const { client, token } = await freshWorkspace();
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice({ notes: 'keep me' }), token)).json;
    const patched = await client.patch(`/api/v1/invoices/${invoice.id}`, { taxRate: 50, lineItems: [{ description: 'New', quantity: 4, price: 25 }] }, token);
    expect(patched.status).toBe(200);
    expect(patched.json.invoice).toMatchObject({ notes: 'keep me', taxRate: 50, subtotal: 100, taxAmount: 50, total: 150, revision: 2, invoiceNumber: invoice.invoiceNumber });
    expect(patched.headers.get('etag')).toBe('"2"');
    expect((await client.patch(`/api/v1/invoices/${invoice.id}`, { toName: '' }, token)).status).toBe(400);
    expect((await client.patch(`/api/v1/invoices/${crypto.randomUUID()}`, { notes: 'x' }, token)).status).toBe(404);
  });

  it('If-Match / If-None-Match preconditions → 412', async () => {
    const { client, token } = await freshWorkspace();
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice(), token)).json;
    const url = `/api/v1/invoices/${invoice.id}`;
    expect((await client.patch(url, { notes: 'a' }, token, { 'if-match': '"1"' })).status).toBe(200);
    const stale = await client.patch(url, { notes: 'b' }, token, { 'if-match': '"1"' });
    expect(stale.status).toBe(412);
    expect(stale.json.error).toMatchObject({ code: 'precondition_failed', details: { currentRevision: 2 } });
    expect((await client.put(url, sampleInvoice(), token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.put(url, sampleInvoice(), token, { 'if-match': 'W/"2"' })).status).toBe(200);
    expect((await client.put(url, sampleInvoice(), token, { 'if-none-match': '*' })).status).toBe(412);
    expect((await client.put(`/api/v1/invoices/${crypto.randomUUID()}`, sampleInvoice(), token, { 'if-none-match': '*' })).status).toBe(201);
    expect((await client.put(`/api/v1/invoices/${crypto.randomUUID()}`, sampleInvoice(), token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.del(url, token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.del(url, token, { 'if-match': '"3"' })).status).toBe(204);
    expect((await client.patch(url, { notes: 'c' }, token, { 'if-match': 'garbage' })).status).toBe(400);
  });

  it('concurrent PATCHes of different fields do not lose updates', async () => {
    const { client, token } = await freshWorkspace();
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice(), token)).json;
    const url = `/api/v1/invoices/${invoice.id}`;
    const results = await Promise.all([
      client.patch(url, { notes: 'from A' }, token),
      client.patch(url, { paymentDetails: 'from B' }, token),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const final = (await client.get(url, token)).json.invoice;
    expect(final).toMatchObject({ notes: 'from A', paymentDetails: 'from B', revision: 3 });
  });
});

describe('soft delete and sync semantics', () => {
  it('DELETE leaves a tombstone: 410 on read/write, hidden unless include_deleted', async () => {
    const { client, token } = await freshWorkspace();
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice(), token)).json;
    const url = `/api/v1/invoices/${invoice.id}`;
    expect((await client.del(url, token)).status).toBe(204);
    expect((await client.del(url, token)).status).toBe(204); // idempotent
    const get = await client.get(url, token);
    expect(get.status).toBe(410);
    expect(get.json.error.details.deletedAt).toBeTruthy();
    expect((await client.patch(url, { notes: 'x' }, token)).status).toBe(410);
    // PUT never resurrects a tombstone.
    const put = await client.put(url, sampleInvoice(), token);
    expect(put.status).toBe(410);
    expect((await client.get(`${url}/pdf`, token)).status).toBe(410);
    expect((await client.get('/api/v1/invoices', token)).json.invoices).toEqual([]);
    const withDeleted = (await client.get('/api/v1/invoices?include_deleted=true', token)).json.invoices;
    expect(withDeleted).toHaveLength(1);
    expect(withDeleted[0]).toMatchObject({ id: invoice.id, revision: 2, updatedBy: { type: 'user' } });
    expect(withDeleted[0].deletedAt).toBe(withDeleted[0].updatedAt);
    expect((await client.del(`/api/v1/invoices/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('updated_since returns every change at or after the cursor, including tombstones', async () => {
    const { client, token } = await freshWorkspace();
    const a = (await client.post('/api/v1/invoices', sampleInvoice({ toName: 'A' }), token)).json.invoice;
    const b = (await client.post('/api/v1/invoices', sampleInvoice({ toName: 'B' }), token)).json.invoice;
    const first = (await client.get('/api/v1/invoices', token)).json;
    expect(first.invoices.map((i: { id: string }) => i.id)).toEqual([a.id, b.id]);
    expect(first.hasMore).toBe(false);
    expect(first.next).toBeNull();
    const cursor = first.syncedAt;
    expect(cursor >= b.updatedAt).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    await client.patch(`/api/v1/invoices/${a.id}`, { notes: 'changed' }, token);
    await client.del(`/api/v1/invoices/${b.id}`, token);
    const c = (await client.post('/api/v1/invoices', sampleInvoice({ toName: 'C' }), token)).json.invoice;

    const delta = (await client.get(`/api/v1/invoices?updated_since=${encodeURIComponent(cursor)}&include_deleted=true`, token)).json;
    const ids = delta.invoices.map((i: { id: string }) => i.id);
    expect(ids).toEqual([a.id, b.id, c.id]);
    for (const inv of delta.invoices) expect(inv.updatedAt >= cursor).toBe(true);
    expect(delta.invoices.find((i: { id: string }) => i.id === b.id).deletedAt).not.toBeNull();

    // Without include_deleted, tombstones are omitted from the delta too.
    const live = (await client.get(`/api/v1/invoices?updated_since=${encodeURIComponent(cursor)}`, token)).json;
    expect(live.invoices.map((i: { id: string }) => i.id)).toEqual([a.id, c.id]);

    // Offsets are normalised to UTC.
    const offset = new Date(new Date(cursor).getTime()).toISOString().replace('Z', '+00:00');
    expect((await client.get(`/api/v1/invoices?updated_since=${encodeURIComponent(offset)}&include_deleted=true`, token)).json.invoices).toHaveLength(3);
  });

  it('paginates with a keyset cursor (updated_since + after_id) without gaps or repeats', async () => {
    const { client, token } = await freshWorkspace();
    const created: string[] = [];
    for (let i = 0; i < 7; i++) created.push((await client.post('/api/v1/invoices', sampleInvoice({ toName: `C${i}` }), token)).json.invoice.id);
    const seen: string[] = [];
    let query = '?limit=3';
    for (let page = 0; page < 5; page++) {
      const res = (await client.get(`/api/v1/invoices${query}`, token)).json;
      seen.push(...res.invoices.map((i: { id: string }) => i.id));
      if (!res.hasMore) break;
      expect(res.invoices).toHaveLength(3);
      query = `?limit=3&updated_since=${encodeURIComponent(res.next.updated_since)}&after_id=${res.next.after_id}`;
    }
    expect(seen).toEqual(created);
    expect((await client.get('/api/v1/invoices?after_id=x', token)).status).toBe(400);
  });
});

describe('invoice numbers', () => {
  it('next-number follows the store rule over live invoices', async () => {
    const { client, token } = await freshWorkspace();
    expect((await client.get('/api/v1/invoices/next-number', token)).json.invoiceNumber).toBe('INV-0001');
    await client.post('/api/v1/invoices', sampleInvoice({ invoiceNumber: 'ACME-2026-17' }), token);
    expect((await client.get('/api/v1/invoices/next-number', token)).json.invoiceNumber).toBe('INV-202618');
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice({ invoiceNumber: 'INV-999999' }), token)).json;
    expect((await client.get('/api/v1/invoices/next-number', token)).json.invoiceNumber).toBe('INV-1000000');
    await client.del(`/api/v1/invoices/${invoice.id}`, token);
    expect((await client.get('/api/v1/invoices/next-number', token)).json.invoiceNumber).toBe('INV-202618');
  });

  it('concurrent creates without invoiceNumber never get the same number', async () => {
    const { client, token } = await freshWorkspace();
    const results = await Promise.all(Array.from({ length: 12 }, () => client.post('/api/v1/invoices', sampleInvoice(), token)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.json.invoice.invoiceNumber).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `INV-${String(i + 1).padStart(4, '0')}`));
  });
});

describe('scope enforcement per endpoint', () => {
  const cases: { scope: Scope; method: string; path: (id: string) => string; body?: unknown }[] = [
    { scope: 'invoices:read', method: 'GET', path: () => '/api/v1/invoices' },
    { scope: 'invoices:read', method: 'GET', path: (id) => `/api/v1/invoices/${id}` },
    { scope: 'invoices:read', method: 'GET', path: () => '/api/v1/invoices/next-number' },
    { scope: 'invoices:read', method: 'GET', path: (id) => `/api/v1/invoices/${id}/pdf` },
    { scope: 'invoices:write', method: 'POST', path: () => '/api/v1/invoices', body: sampleInvoice() },
    { scope: 'invoices:write', method: 'PUT', path: (id) => `/api/v1/invoices/${id}`, body: sampleInvoice() },
    { scope: 'invoices:write', method: 'PATCH', path: (id) => `/api/v1/invoices/${id}`, body: { notes: 'x' } },
    { scope: 'invoices:delete', method: 'DELETE', path: (id) => `/api/v1/invoices/${id}` },
    { scope: 'settings:read', method: 'GET', path: () => '/api/v1/settings' },
  ];
  const ALL: Scope[] = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'];

  it('each endpoint requires exactly its scope', async () => {
    const { client, token } = await freshWorkspace();
    const keys = new Map<string, string>();
    for (const scope of ALL) {
      keys.set(`only:${scope}`, (await connectAgent(client, token, [scope])).api_key);
      keys.set(`except:${scope}`, (await connectAgent(client, token, ALL.filter((s) => s !== scope))).api_key);
    }
    for (const c of cases) {
      const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice(), token)).json;
      const denied = await client.call(c.method, c.path(invoice.id), { token: keys.get(`except:${c.scope}`), body: c.body });
      expect(denied.status, `${c.method} ${c.path('id')} without ${c.scope}`).toBe(403);
      expect(denied.json.error).toMatchObject({ code: 'insufficient_scope', details: { requiredScope: c.scope } });
      const allowed = await client.call(c.method, c.path(invoice.id), { token: keys.get(`only:${c.scope}`), body: c.body });
      expect(allowed.status, `${c.method} ${c.path('id')} with ${c.scope}`).toBeLessThan(300);
    }
    // Settings writes are reserved to the workspace token, whatever the scopes.
    const allScopes = (await connectAgent(client, token, ALL)).api_key;
    expect((await client.put('/api/v1/settings', SETTINGS, allScopes)).status).toBe(403);
  });
});

describe('workspace isolation', () => {
  it("workspace A's token and agents cannot see or modify workspace B's data", async () => {
    const { client } = setup();
    const a = await createWorkspace(client);
    const b = await createWorkspace(client);
    const agentA = (await connectAgent(client, a.token, ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'])).api_key;
    await client.put('/api/v1/settings', SETTINGS, b.token);
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice({ toName: 'B secret' }), b.token)).json;
    const url = `/api/v1/invoices/${invoice.id}`;

    for (const cred of [a.token, agentA]) {
      expect((await client.get(url, cred)).status).toBe(404);
      expect((await client.get(`${url}/pdf`, cred)).status).toBe(404);
      expect((await client.patch(url, { notes: 'pwned' }, cred)).status).toBe(404);
      expect((await client.del(url, cred)).status).toBe(404);
      expect((await client.get('/api/v1/invoices?include_deleted=true', cred)).json.invoices).toEqual([]);
      expect((await client.get('/api/v1/invoices/next-number', cred)).json.invoiceNumber).toBe('INV-0001');
      expect((await client.get('/api/v1/settings', cred)).json.settings.fromName).toBe('');
    }
    // PUT with B's id from A creates an independent invoice in A; B's is untouched.
    const put = await client.put(url, sampleInvoice({ toName: 'A copy' }), a.token);
    expect(put.status).toBe(201);
    const bView = (await client.get(url, b.token)).json.invoice;
    expect(bView).toMatchObject({ toName: 'B secret', revision: 1, notes: '' });
    expect((await client.get(url, a.token)).json.invoice.toName).toBe('A copy');
  });
});
