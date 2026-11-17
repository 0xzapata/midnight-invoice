import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Scope } from '../shared/api';
import type { RecurringSchedule } from '../shared/recurring';
import { createApp } from './app';
import { defaultDeps, type AppDeps } from './deps';
import { CRON_SCHEDULES, JOBS, runScheduledJobs } from './scheduled';
import { setRecurringEmailSender } from './recurring/autoActions';
import { periodInvoiceId, retryDelayMs } from './recurring/generate';
import { RECURRING_CRON, runRecurringGeneration } from './recurring/job';
import { api, BASE, connectAgent, createWorkspace, readPublicAsset, startD1, TestClock, type Api } from './test/helpers';
import { connectOAuth } from './test/oauth';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});
// The generator scans every workspace: start each test without schedules from earlier ones.
beforeEach(async () => {
  await d1.db.batch([d1.db.prepare('DELETE FROM recurring_runs'), d1.db.prepare('DELETE FROM recurring_schedules')]);
});
afterEach(() => setRecurringEmailSender(null));

const SYSTEM = { id: null, email: null, type: 'system' as const };

function setup(start = '2026-11-17T10:00:00.000Z') {
  const clock = new TestClock(new Date(start));
  const errors: unknown[] = [];
  const deps: AppDeps = defaultDeps({ db: d1.db, readAsset: readPublicAsset, clock: clock.fn, logError: (_m, e) => errors.push(e) });
  const app = createApp(deps);
  const client = api(app);
  const run = () => runRecurringGeneration(deps, clock.now.getTime());
  const at = (iso: string) => {
    clock.now = new Date(iso);
  };
  return { app, client, clock, deps, errors, run, at };
}

const RETAINER = {
  name: 'Monthly retainer',
  lineItems: [
    { description: 'Retainer {{prev_month_name}} {{prev_month_year}}', quantity: 1, price: 2000 },
    { description: 'Hosting {{quarter}} {{year}}', quantity: 1, price: 50 },
  ],
  notes: 'Thanks, {{client_name}}',
  invoiceNamePattern: 'Retainer {{month_name}} {{year}}',
  paymentTermsDays: 14,
};

async function workspaceWithTemplate(client: Api, template: Record<string, unknown> = {}) {
  const ws = await createWorkspace(client);
  await client.put('/api/v1/settings', { fromName: 'Studio', fromEmail: '', fromAddress: 'Studio St 1', paymentDetails: 'IBAN', notes: '', taxRate: 10, currency: 'EUR' }, ws.token);
  const globex = (await client.post('/api/v1/clients', { name: 'Globex Corporation', email: 'ap@globex.example', defaultCurrency: 'USD' }, ws.token)).json.client;
  const initech = (await client.post('/api/v1/clients', { name: 'Initech', address: '1 Initech Way' }, ws.token)).json.client;
  const tpl = await client.post('/api/v1/templates', { ...RETAINER, clientId: globex.id, ...template }, ws.token);
  if (tpl.status !== 201) throw new Error(`template: ${tpl.status} ${tpl.text}`);
  return { ws, token: ws.token, globex, initech, template: tpl.json.template };
}

async function createSchedule(client: Api, token: string, body: Record<string, unknown>) {
  const res = await client.post('/api/v1/recurring', { name: 'Globex retainer', frequency: 'monthly', startDate: '2026-12-01', timezone: 'UTC', ...body }, token);
  if (res.status !== 201) throw new Error(`create schedule: ${res.status} ${res.text}`);
  return res.json.recurring as RecurringSchedule;
}

async function generated(client: Api, token: string, recurringId: string) {
  const res = await client.get(`/api/v1/invoices?recurring_id=${recurringId}`, token);
  expect(res.status).toBe(200);
  return (res.json.invoices as { issueDate: string; invoiceNumber: string }[]).sort((a, b) => a.issueDate.localeCompare(b.issueDate));
}

async function activity(client: Api, token: string, prefix: string) {
  return (await client.get(`/api/v1/activity?action=${prefix}&limit=200`, token)).json.activity as {
    action: string;
    actor: { type: string };
    entity: { type: string; id: string; label: string } | null;
    changes: Record<string, unknown> | null;
    source: string;
  }[];
}

async function mcpClient(app: ReturnType<typeof createApp>, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: 'recurring-test', version: '1.0.0' });
  await c.connect(transport);
  return c;
}
const parse = (result: { content?: unknown; isError?: boolean }) => JSON.parse((result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!.text!);

describe('recurring schedules: CRUD', () => {
  it('creates, reads, patches, replaces and deletes with ETags; computes the next run date and the summary', async () => {
    const { client } = setup();
    const { token, template, initech } = await workspaceWithTemplate(client);
    const created = await client.post(
      '/api/v1/recurring',
      { name: 'Globex retainer', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01', timezone: 'Europe/Berlin' },
      token,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"1"');
    const s = created.json.recurring;
    expect(s).toMatchObject({
      name: 'Globex retainer',
      templateId: template.id,
      clientId: null,
      frequency: 'monthly',
      startDate: '2026-12-01',
      timezone: 'Europe/Berlin',
      endDate: null,
      maxOccurrences: null,
      autoAction: 'draft',
      overrides: { notes: null, taxRate: null },
      status: 'active',
      nextRunDate: '2026-12-01',
      runCount: 0,
      lastError: null,
      summary: 'Every month on the 1st, starting 1 Dec 2026 — next: 1 Dec 2026',
      revision: 1,
      createdBy: { type: 'user' },
    });
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring).toEqual(s);
    expect((await client.get('/api/v1/recurring', token)).json.recurring.map((r: RecurringSchedule) => r.id)).toEqual([s.id]);

    const patched = await client.patch(`/api/v1/recurring/${s.id}`, { clientId: initech.id, overrides: { taxRate: 0 } }, token, { 'if-match': '"1"' });
    expect(patched.status).toBe(200);
    expect(patched.json.recurring).toMatchObject({ clientId: initech.id, overrides: { notes: null, taxRate: 0 }, revision: 2, nextRunDate: '2026-12-01' });
    expect((await client.patch(`/api/v1/recurring/${s.id}`, { name: 'x' }, token, { 'if-match': '"1"' })).status).toBe(412);
    // No change → no new revision.
    expect((await client.patch(`/api/v1/recurring/${s.id}`, { name: 'Globex retainer' }, token)).json.recurring.revision).toBe(2);

    // Changing the cadence recomputes the next run date from today (17 Nov 2026).
    const weekly = await client.put(
      `/api/v1/recurring/${s.id}`,
      { name: 'Weekly', templateId: template.id, frequency: 'weekly', startDate: '2026-11-02', timezone: 'Europe/Berlin' },
      token,
      { 'if-match': '"2"' },
    );
    expect(weekly.json.recurring).toMatchObject({ frequency: 'weekly', nextRunDate: '2026-11-23', clientId: null, summary: 'Every week on Monday, starting 2 Nov 2026 — next: 23 Nov 2026' });

    expect((await client.del(`/api/v1/recurring/${s.id}`, token)).status).toBe(204);
    expect((await client.del(`/api/v1/recurring/${s.id}`, token)).status).toBe(204);
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).status).toBe(410);
    expect((await client.get('/api/v1/recurring', token)).json.recurring).toEqual([]);
  });

  it('validates references, dates and time zones', async () => {
    const { client } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const base = { name: 'X', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01' };
    const bad = async (body: Record<string, unknown>) => (await client.post('/api/v1/recurring', { ...base, ...body }, token)).json.error;
    expect((await bad({ templateId: '00000000-0000-4000-8000-000000000000' })).message).toBe('Unknown template');
    expect((await bad({ clientId: '00000000-0000-4000-8000-000000000000' })).message).toBe('Unknown client');
    expect((await bad({ timezone: 'Mars/Olympus' })).details[0].path).toBe('timezone');
    expect((await bad({ endDate: '2026-11-30' })).details[0]).toMatchObject({ path: 'endDate' });
    expect((await bad({ frequency: 'daily' })).code).toBe('validation_failed');
    expect((await bad({ startDate: '2026-02-30' })).code).toBe('validation_failed');
    // Default time zone is UTC.
    expect((await createSchedule(client, token, { templateId: template.id })).timezone).toBe('UTC');
    // A schedule whose end date is already past is created ended.
    const past = await createSchedule(client, token, { templateId: template.id, startDate: '2026-01-01', endDate: '2026-06-30' });
    expect(past).toMatchObject({ status: 'ended', nextRunDate: null });
  });

  it('keeps workspaces apart', async () => {
    const { client } = setup();
    const a = await workspaceWithTemplate(client);
    const b = await workspaceWithTemplate(client);
    const s = await createSchedule(client, a.token, { templateId: a.template.id });
    expect((await client.get(`/api/v1/recurring/${s.id}`, b.token)).status).toBe(404);
    expect((await client.post(`/api/v1/recurring/${s.id}/pause`, undefined, b.token)).status).toBe(404);
    expect((await client.get('/api/v1/recurring', b.token)).json.recurring).toEqual([]);
    // Another workspace's template cannot be used.
    expect((await client.post('/api/v1/recurring', { name: 'X', templateId: a.template.id, frequency: 'monthly', startDate: '2026-12-01' }, b.token)).json.error.message).toBe('Unknown template');
  });
});

describe('recurring schedules: generation', () => {
  it('generates the invoice from the template on the run date: placeholders, precedence, numbering, attribution, activity', async () => {
    const { client, run, at } = setup();
    const { token, template, globex, initech } = await workspaceWithTemplate(client);
    await client.post('/api/v1/invoices', { toName: 'Manual', fromName: 'S', lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, token);
    const byTemplateClient = await createSchedule(client, token, { templateId: template.id });
    const byScheduleClient = await createSchedule(client, token, { name: 'Initech retainer', templateId: template.id, clientId: initech.id, overrides: { notes: 'Fixed note {{month_name}}', taxRate: 0 } });

    expect((await run()).generated).toBe(0); // 17 Nov: not due
    at('2026-12-01T00:30:00.000Z');
    expect(await run()).toMatchObject({ generated: 2, failed: 0 });

    const [inv] = await generated(client, token, byTemplateClient.id);
    expect(inv).toMatchObject({
      issueDate: '2026-12-01',
      dueDate: '2026-12-15',
      invoiceName: 'Retainer December 2026',
      toName: 'Globex Corporation',
      toEmail: 'ap@globex.example',
      clientId: globex.id,
      currency: 'USD', // client default before workspace settings
      taxRate: 10,
      notes: 'Thanks, Globex Corporation',
      status: 'draft',
      templateId: template.id,
      recurringId: byTemplateClient.id,
      createdBy: { type: 'system', recurringId: byTemplateClient.id, recurringName: 'Globex retainer' },
    });
    expect((inv as unknown as { lineItems: { description: string }[] }).lineItems.map((l) => l.description)).toEqual(['Retainer November 2026', 'Hosting Q4 2026']);
    const [other] = await generated(client, token, byScheduleClient.id);
    expect(other).toMatchObject({ toName: 'Initech', clientId: initech.id, taxRate: 0, notes: 'Fixed note December', currency: 'EUR' });
    // Numbers come from the atomic allocator, after the manual INV-0001.
    expect([inv.invoiceNumber, other.invoiceNumber].sort()).toEqual(['INV-0002', 'INV-0003']);

    const s = (await client.get(`/api/v1/recurring/${byTemplateClient.id}`, token)).json.recurring;
    expect(s).toMatchObject({ nextRunDate: '2027-01-01', lastRunDate: '2026-12-01', runCount: 1, lastInvoiceId: (inv as unknown as { id: string }).id, revision: 1 });

    const created = (await activity(client, token, 'invoice.created')).find((e) => e.entity?.id === (inv as unknown as { id: string }).id)!;
    expect(created).toMatchObject({
      actor: { type: 'system' },
      source: 'system',
      changes: { template: { id: template.id, label: 'Monthly retainer' }, recurring: { id: byTemplateClient.id, label: 'Globex retainer' } },
    });
    expect(created.entity!.label).toBe(inv.invoiceNumber);

    // Year rollover.
    at('2027-01-01T00:10:00.000Z');
    await run();
    const two = await generated(client, token, byTemplateClient.id);
    expect(two.map((i) => i.issueDate)).toEqual(['2026-12-01', '2027-01-01']);
    expect((two[1] as unknown as { invoiceName: string }).invoiceName).toBe('Retainer January 2027');
    expect((two[1] as unknown as { lineItems: { description: string }[] }).lineItems[0].description).toBe('Retainer December 2026');
  });

  it('generates exactly once per period under repeated and concurrent runs (and run-now racing the job)', async () => {
    const { client, run, at, app } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id });
    at('2026-12-01T05:00:00.000Z');
    const results = await Promise.all([run(), run(), run(), client.post(`/api/v1/recurring/${s.id}/run-now`, { period: '2026-12-01' }, token)]);
    expect(results.slice(0, 3).reduce((n, r) => n + (r as { generated: number }).generated, 0) + ((results[3] as { status: number }).status === 201 ? 1 : 0)).toBe(1);
    await run();
    await run();
    expect((await generated(client, token, s.id)).map((i) => i.issueDate)).toEqual(['2026-12-01']);
    const runs = await d1.db.prepare('SELECT period, outcome FROM recurring_runs WHERE schedule_id = ?').bind(s.id).all();
    expect(runs.results).toEqual([{ period: '2026-12-01', outcome: 'generated' }]);
    const after = (await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring;
    expect(after).toMatchObject({ runCount: 1, nextRunDate: '2027-01-01' });
    // The invoice id is derived from (workspace, schedule, period); deleting the invoice never lets the period run again.
    const [inv] = (await client.get(`/api/v1/invoices?recurring_id=${s.id}`, token)).json.invoices;
    expect(inv.id).toBe(await periodInvoiceId(await workspaceIdOf(token, client), s.id, '2026-12-01'));
    expect((await client.del(`/api/v1/invoices/${inv.id}`, token)).status).toBe(204);
    // Simulate a lost bookkeeping write: put the schedule back on the generated period.
    await d1.db.prepare(`UPDATE recurring_schedules SET next_run_date = '2026-12-01' WHERE id = ?`).bind(s.id).run();
    await run();
    expect((await client.get(`/api/v1/invoices?recurring_id=${s.id}&include_deleted=true`, token)).json.invoices).toHaveLength(1);
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring).toMatchObject({ nextRunDate: '2027-01-01', runCount: 1 });
    void app;
  });

  it('run-now generates the next period and is idempotent per period', async () => {
    const { client } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id, frequency: 'quarterly', startDate: '2026-11-30' });
    expect(s.nextRunDate).toBe('2026-11-30');
    const first = await client.post(`/api/v1/recurring/${s.id}/run-now`, { period: '2026-11-30' }, token);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ period: '2026-11-30', generated: true, recurring: { nextRunDate: '2027-02-28', runCount: 1 } });
    expect(first.headers.get('location')).toBe(`/api/v1/invoices/${first.json.invoice.id}`);
    // A retry with the same period returns the same invoice and generates nothing.
    const again = await client.post(`/api/v1/recurring/${s.id}/run-now`, { period: '2026-11-30' }, token);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ generated: false, invoice: { id: first.json.invoice.id } });
    // Another period than the next one is refused.
    const wrong = await client.post(`/api/v1/recurring/${s.id}/run-now`, { period: '2027-05-30' }, token);
    expect(wrong.status).toBe(409);
    expect(wrong.json.error.details).toEqual({ nextRunDate: '2027-02-28' });
    // Without a period: the next one (dated with its run date: month-end rule).
    const next = await client.post(`/api/v1/recurring/${s.id}/run-now`, undefined, token);
    expect(next.json).toMatchObject({ period: '2027-02-28', invoice: { issueDate: '2027-02-28' }, recurring: { nextRunDate: '2027-05-30' } });
    // run-now from the user records the user as the actor of invoice.created.
    const entries = (await activity(client, token, 'invoice.created')).filter((e) => (e.changes?.recurring as { id: string } | undefined)?.id === s.id);
    expect(entries.map((e) => [e.actor.type, e.changes?.trigger])).toEqual([
      ['user', 'run_now'],
      ['user', 'run_now'],
    ]);
    await client.post(`/api/v1/recurring/${s.id}/pause`, undefined, token);
    expect((await client.post(`/api/v1/recurring/${s.id}/run-now`, undefined, token)).status).toBe(409);
  });

  it('month ends, leap days and time zones: due at local midnight', async () => {
    const { client, run, at } = setup('2028-01-20T12:00:00.000Z');
    const { token, template } = await workspaceWithTemplate(client);
    const monthEnd = await createSchedule(client, token, { name: 'Month end', templateId: template.id, startDate: '2028-01-31' });
    const auckland = await createSchedule(client, token, { name: 'Auckland', templateId: template.id, startDate: '2028-02-01', timezone: 'Pacific/Auckland' });
    const la = await createSchedule(client, token, { name: 'LA', templateId: template.id, startDate: '2028-02-01', timezone: 'America/Los_Angeles' });
    at('2028-01-31T01:00:00.000Z');
    await run();
    at('2028-01-31T12:00:00.000Z'); // 1 Feb 01:00 in Auckland (UTC+13), 31 Jan 04:00 in Los Angeles
    await run();
    expect((await generated(client, token, auckland.id)).map((i) => i.issueDate)).toEqual(['2028-02-01']);
    expect(await generated(client, token, la.id)).toEqual([]);
    at('2028-02-01T08:30:00.000Z'); // 1 Feb 00:30 in Los Angeles (UTC-8)
    await run();
    expect((await generated(client, token, la.id)).map((i) => i.issueDate)).toEqual(['2028-02-01']);
    at('2028-02-29T00:30:00.000Z');
    await run();
    at('2028-03-31T00:30:00.000Z');
    await run();
    expect((await generated(client, token, monthEnd.id)).map((i) => i.issueDate)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('DST: a Berlin weekly schedule across the spring and autumn changes runs once per week, stepping the clock hourly', async () => {
    const { client, run, at, clock } = setup('2027-03-20T12:00:00.000Z');
    const { token, template } = await workspaceWithTemplate(client);
    // Sundays, the days the clocks change in 2027 (28 Mar, 31 Oct).
    const s = await createSchedule(client, token, { templateId: template.id, frequency: 'weekly', startDate: '2027-03-21', timezone: 'Europe/Berlin' });
    const ny = await createSchedule(client, token, { name: 'NY', templateId: template.id, frequency: 'weekly', startDate: '2027-03-14', timezone: 'America/New_York' });
    for (const [from, to] of [
      ['2027-03-20T12:00:00.000Z', '2027-03-29T12:00:00.000Z'],
      ['2027-10-30T12:00:00.000Z', '2027-11-08T12:00:00.000Z'],
    ]) {
      at(from);
      await client.patch(`/api/v1/recurring/${s.id}`, { startDate: from.slice(0, 10) === '2027-03-20' ? '2027-03-21' : '2027-10-31' }, token);
      await client.patch(`/api/v1/recurring/${ny.id}`, { startDate: from.slice(0, 10) === '2027-03-20' ? '2027-03-21' : '2027-10-31' }, token);
      while (clock.now.toISOString() < to) {
        await run();
        clock.advance(3_600_000);
      }
    }
    expect((await generated(client, token, s.id)).map((i) => i.issueDate)).toEqual(['2027-03-21', '2027-03-28', '2027-10-31', '2027-11-07']);
    expect((await generated(client, token, ny.id)).map((i) => i.issueDate)).toEqual(['2027-03-21', '2027-03-28', '2027-10-31', '2027-11-07']);
  }, 60_000);
});

async function workspaceIdOf(token: string, client: Api): Promise<string> {
  return (await client.get('/api/v1/workspace', token)).json.workspace.id;
}

describe('recurring schedules: catch-up, pause/resume and end conditions', () => {
  it('after downtime only the most recent missed period is generated; older ones are skipped and recorded', async () => {
    const { client, run, at } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id });
    at('2027-03-15T10:00:00.000Z'); // Dec, Jan, Feb and Mar were missed
    expect(await run()).toMatchObject({ generated: 1, skippedPeriods: 3 });
    expect((await generated(client, token, s.id)).map((i) => i.issueDate)).toEqual(['2027-03-01']);
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring).toMatchObject({
      nextRunDate: '2027-04-01',
      skippedCount: 3,
      lastSkipped: { from: '2026-12-01', to: '2027-02-01', count: 3 },
      runCount: 1,
    });
    const runs = await d1.db.prepare('SELECT period, outcome FROM recurring_runs WHERE schedule_id = ? ORDER BY period').bind(s.id).all();
    expect(runs.results.map((r) => `${r.period}:${r.outcome}`)).toEqual(['2026-12-01:skipped', '2027-01-01:skipped', '2027-02-01:skipped', '2027-03-01:generated']);
    const [entry] = (await activity(client, token, 'invoice.created')).filter((e) => (e.changes?.recurring as { id: string } | undefined)?.id === s.id);
    expect(entry.changes).toMatchObject({ skipped: 3, trigger: 'schedule' });
  });

  it('pause stops generation; resume skips the periods missed while paused except the most recent one', async () => {
    const { client, run, at } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id, frequency: 'weekly', startDate: '2026-11-23' });
    const paused = await client.post(`/api/v1/recurring/${s.id}/pause`, undefined, token);
    expect(paused.json.recurring).toMatchObject({ status: 'paused', revision: 2 });
    expect((await client.post(`/api/v1/recurring/${s.id}/pause`, undefined, token)).json.recurring.revision).toBe(2);
    at('2026-12-16T09:00:00.000Z');
    await run();
    expect(await generated(client, token, s.id)).toEqual([]);
    const resumed = (await client.post(`/api/v1/recurring/${s.id}/resume`, undefined, token)).json.recurring;
    expect(resumed).toMatchObject({ status: 'active', nextRunDate: '2026-12-14', skippedCount: 3, lastSkipped: { from: '2026-11-23', to: '2026-12-07', count: 3 } });
    await run();
    expect((await generated(client, token, s.id)).map((i) => i.issueDate)).toEqual(['2026-12-14']);
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring.nextRunDate).toBe('2026-12-21');
    const actions = (await activity(client, token, 'recurring.')).map((e) => e.action);
    expect(actions).toEqual(['recurring.resumed', 'recurring.paused', 'recurring.created']);
  });

  it('ends after maxOccurrences or the end date, and stops', async () => {
    const { client, run, at } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const limited = await createSchedule(client, token, { name: 'Twice', templateId: template.id, maxOccurrences: 2 });
    const until = await createSchedule(client, token, { name: 'Until Jan', templateId: template.id, endDate: '2027-01-15' });
    for (const d of ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']) {
      at(`${d}T01:00:00.000Z`);
      await run();
    }
    expect((await generated(client, token, limited.id)).map((i) => i.issueDate)).toEqual(['2026-12-01', '2027-01-01']);
    expect((await generated(client, token, until.id)).map((i) => i.issueDate)).toEqual(['2026-12-01', '2027-01-01']);
    for (const id of [limited.id, until.id]) {
      expect((await client.get(`/api/v1/recurring/${id}`, token)).json.recurring).toMatchObject({ status: 'ended', nextRunDate: null, runCount: 2 });
    }
    const ended = (await activity(client, token, 'recurring.ended')).map((e) => [e.entity!.label, e.actor.type]);
    expect(ended.sort()).toEqual([
      ['Twice', 'system'],
      ['Until Jan', 'system'],
    ]);
    expect((await client.post(`/api/v1/recurring/${limited.id}/resume`, undefined, token)).status).toBe(409);
    // Raising the limit continues it from today (1 Mar is a run date).
    const more = await client.patch(`/api/v1/recurring/${limited.id}`, { maxOccurrences: 3 }, token);
    expect(more.json.recurring).toMatchObject({ status: 'active', nextRunDate: '2027-03-01' });
  });
});

describe('recurring schedules: failures', () => {
  it('records a deleted template or client on the schedule with a visible reason, retries with backoff, and recovers after a fix', async () => {
    const { client, run, at, clock } = setup();
    const { token, template, globex } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id });
    const healthy = await createSchedule(client, token, { name: 'Other', templateId: (await client.post('/api/v1/templates', { ...RETAINER, name: 'Second' }, token)).json.template.id, clientId: null });
    await client.patch(`/api/v1/recurring/${healthy.id}`, { clientId: (await client.post('/api/v1/clients', { name: 'Healthy Co' }, token)).json.client.id }, token);
    expect((await client.del(`/api/v1/templates/${template.id}`, token)).status).toBe(204);
    at('2026-12-01T00:30:00.000Z');
    // One failing schedule never stops the batch.
    expect(await run()).toMatchObject({ generated: 1, failed: 1 });
    let state = (await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring;
    expect(state.lastError).toMatchObject({ code: 'template_deleted', period: '2026-12-01', attempts: 1, message: expect.stringContaining('template') });
    expect(state.retryAt).toBe(new Date(clock.now.getTime() + retryDelayMs(1)).toISOString());
    expect(state.nextRunDate).toBe('2026-12-01');
    // Before retryAt: not attempted.
    clock.advance(30 * 60_000);
    expect((await run()).processed).toBe(0);
    clock.advance(31 * 60_000);
    await run();
    state = (await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring;
    expect(state.lastError.attempts).toBe(2);
    expect(Date.parse(state.retryAt) - clock.now.getTime()).toBe(retryDelayMs(2));
    // One run_failed entry per schedule, period and reason, counting attempts.
    const failed = await activity(client, token, 'recurring.run_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ actor: { type: 'system' }, entity: { id: s.id, label: 'Globex retainer' }, changes: { reason: 'template_deleted', period: '2026-12-01', counts: { attempts: 2 } } });
    // The preview explains it too.
    expect((await client.get(`/api/v1/recurring/${s.id}/preview`, token)).json.problem).toMatchObject({ code: 'template_deleted' });

    // Fixing the schedule clears the error; the overdue period is generated by the next run.
    const other = (await client.post('/api/v1/templates', { ...RETAINER, name: 'Replacement', clientId: globex.id }, token)).json.template;
    const fixed = (await client.patch(`/api/v1/recurring/${s.id}`, { templateId: other.id }, token)).json.recurring;
    expect(fixed).toMatchObject({ lastError: null, retryAt: null, nextRunDate: '2026-12-01' });
    await run();
    expect((await generated(client, token, s.id)).map((i) => i.issueDate)).toEqual(['2026-12-01']);

    // A deleted client.
    const c = (await client.post('/api/v1/clients', { name: 'Gone Ltd' }, token)).json.client;
    await client.patch(`/api/v1/recurring/${s.id}`, { clientId: c.id }, token);
    await client.del(`/api/v1/clients/${c.id}`, token);
    at('2027-01-01T00:30:00.000Z');
    await run();
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring.lastError).toMatchObject({ code: 'client_deleted' });
    expect((await client.post(`/api/v1/recurring/${s.id}/run-now`, undefined, token)).json.error).toMatchObject({ code: 'validation_failed', details: { reason: 'client_deleted' } });
  });

  it('a template the invoice validation rejects is recorded as validation_failed', async () => {
    const { client, run, at } = setup();
    const { token } = await workspaceWithTemplate(client);
    const empty = (await client.post('/api/v1/templates', { name: 'Empty' }, token)).json.template;
    const noClient = (await client.post('/api/v1/templates', { name: 'No client', lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, token)).json.template;
    const a = await createSchedule(client, token, { name: 'Empty', templateId: empty.id });
    const b = await createSchedule(client, token, { name: 'No client', templateId: noClient.id });
    at('2026-12-01T00:30:00.000Z');
    await run();
    expect((await client.get(`/api/v1/recurring/${a.id}`, token)).json.recurring.lastError).toMatchObject({ code: 'validation_failed', message: expect.stringContaining('no line items') });
    expect((await client.get(`/api/v1/recurring/${b.id}`, token)).json.recurring.lastError).toMatchObject({ code: 'validation_failed', message: expect.stringContaining('toName') });
  });

  it('suspended workspaces and maintenance mode: nothing is generated, the reason is visible, generation resumes afterwards', async () => {
    const { client, run, at, deps } = setup();
    const { token, template, ws } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id });
    await d1.db.prepare(`INSERT INTO workspace_suspensions (workspace_id, suspended_at, suspended_by, reason) VALUES (?, 0, 'test', 'abuse')`).bind(ws.workspace.id).run();
    at('2026-12-01T00:30:00.000Z');
    await run();
    expect(await generatedRaw(s.id)).toBe(0);
    const suspended = await d1.db.prepare('SELECT last_error, retry_at FROM recurring_schedules WHERE id = ?').bind(s.id).first<{ last_error: string; retry_at: string }>();
    expect(JSON.parse(suspended!.last_error)).toMatchObject({ code: 'workspace_suspended' });
    await d1.db.prepare('DELETE FROM workspace_suspensions WHERE workspace_id = ?').bind(ws.workspace.id).run();

    await deps.settings.set('maintenance.enabled', true, SYSTEM);
    try {
      at('2026-12-01T02:00:00.000Z');
      await run();
      expect(await generatedRaw(s.id)).toBe(0);
      const m = await d1.db.prepare('SELECT last_error FROM recurring_schedules WHERE id = ?').bind(s.id).first<{ last_error: string }>();
      expect(JSON.parse(m!.last_error)).toMatchObject({ code: 'maintenance', attempts: 2 });
    } finally {
      await deps.settings.reset('maintenance.enabled', SYSTEM);
    }
    at('2026-12-01T03:30:00.000Z');
    await run();
    expect(await generatedRaw(s.id)).toBe(1);
    expect((await client.get(`/api/v1/recurring/${s.id}`, token)).json.recurring.lastError).toBeNull();
  });
});

async function generatedRaw(scheduleId: string): Promise<number> {
  return (await d1.db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE recurring_id = ?').bind(scheduleId).first<{ n: number }>())!.n;
}

describe('recurring schedules: operator controls', () => {
  it('global switch, schedules per workspace and schedules per run', async () => {
    const { client, run, at, deps } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    await deps.settings.set('recurring.maxSchedulesPerWorkspace', 2, SYSTEM);
    await deps.settings.set('recurring.maxGeneratedPerRun', 1, SYSTEM);
    try {
      const a = await createSchedule(client, token, { name: 'A', templateId: template.id });
      const b = await createSchedule(client, token, { name: 'B', templateId: template.id });
      const third = await client.post('/api/v1/recurring', { name: 'C', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01' }, token);
      expect(third.status).toBe(409);
      expect(third.json.error).toMatchObject({ code: 'limit_reached', details: { max: 2 } });
      at('2026-12-01T00:30:00.000Z');
      expect(await run()).toMatchObject({ processed: 1, generated: 1, more: true });
      expect(await run()).toMatchObject({ processed: 1, generated: 1, more: false });
      expect((await generatedRaw(a.id)) + (await generatedRaw(b.id))).toBe(2);

      await deps.settings.set('recurring.enabled', false, SYSTEM);
      at('2027-01-01T00:30:00.000Z');
      expect(await run()).toMatchObject({ processed: 0, generated: 0 });
      const off = await client.post(`/api/v1/recurring/${a.id}/run-now`, undefined, token);
      expect(off.status).toBe(503);
      expect(off.json.error.code).toBe('recurring_disabled');
    } finally {
      for (const key of ['recurring.maxSchedulesPerWorkspace', 'recurring.maxGeneratedPerRun', 'recurring.enabled']) await deps.settings.reset(key, SYSTEM);
    }
  });

  it('is a registered scheduled job whose cron is configured', async () => {
    const { deps, client, at } = setup();
    expect(JOBS.find((j) => j.name === 'recurring.generate')?.cron).toBe(RECURRING_CRON);
    expect(CRON_SCHEDULES).toContain(RECURRING_CRON);
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id });
    at('2026-12-01T00:07:00.000Z');
    expect(await runScheduledJobs(deps, { cron: RECURRING_CRON, scheduledTime: Date.parse('2026-12-01T00:07:00.000Z') })).toEqual([{ name: 'recurring.generate', ok: true }]);
    expect(await generatedRaw(s.id)).toBe(1);
  });
});

describe('recurring schedules: agents', () => {
  const FULL: Scope[] = ['recurring:read', 'recurring:write', 'invoices:read', 'invoices:write', 'templates:read', 'clients:read'];

  it('scopes: existing scopes grant nothing; writes also need invoices:write + templates:read (+ clients:read)', async () => {
    const { client } = setup();
    const { token, template, globex } = await workspaceWithTemplate(client);
    const plain = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'templates:read', 'templates:write']);
    expect((await client.get('/api/v1/recurring', plain.api_key)).json.error).toMatchObject({ code: 'insufficient_scope', details: { requiredScope: 'recurring:read' } });
    const body = { name: 'A', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01' };
    expect((await client.post('/api/v1/recurring', body, plain.api_key)).json.error.details.requiredScope).toBe('recurring:write');

    const noInvoices = await connectAgent(client, token, ['recurring:read', 'recurring:write', 'templates:read']);
    expect((await client.post('/api/v1/recurring', body, noInvoices.api_key)).json.error.details.requiredScope).toBe('invoices:write');
    const noTemplates = await connectAgent(client, token, ['recurring:read', 'recurring:write', 'invoices:write']);
    expect((await client.post('/api/v1/recurring', body, noTemplates.api_key)).json.error.details.requiredScope).toBe('templates:read');
    const noClients = await connectAgent(client, token, ['recurring:read', 'recurring:write', 'invoices:write', 'templates:read']);
    expect((await client.post('/api/v1/recurring', { ...body, clientId: globex.id }, noClients.api_key)).json.error.details.requiredScope).toBe('clients:read');
    // The template bills Globex by default: the same rule.
    expect((await client.post('/api/v1/recurring', body, noClients.api_key)).json.error.details.requiredScope).toBe('clients:read');
    const bare = (await client.post('/api/v1/templates', { name: 'Bare', lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, token)).json.template;
    const ok = await client.post('/api/v1/recurring', { ...body, templateId: bare.id }, noClients.api_key);
    expect(ok.status).toBe(201);
    expect(ok.json.recurring.createdBy).toMatchObject({ type: 'agent', agentName: 'Test Agent' });
    // Read-only agents can read but not pause.
    const reader = await connectAgent(client, token, ['recurring:read']);
    expect((await client.get(`/api/v1/recurring/${ok.json.recurring.id}`, reader.api_key)).status).toBe(200);
    expect((await client.post(`/api/v1/recurring/${ok.json.recurring.id}/pause`, undefined, reader.api_key)).status).toBe(403);
    // The preview shows template content: templates:read.
    expect((await client.get(`/api/v1/recurring/${ok.json.recurring.id}/preview`, reader.api_key)).json.error.details.requiredScope).toBe('templates:read');
  });

  it('automatic emailing is the user’s decision only', async () => {
    const { client, run, at } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const agent = await connectAgent(client, token, FULL);
    const body = { name: 'Mail', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01', autoAction: 'send_email' };
    // Without an email feature on the server: refused for everyone.
    expect((await client.post('/api/v1/recurring', body, token)).json.error).toMatchObject({ code: 'validation_failed', message: 'Email sending is not available' });
    const sent: string[] = [];
    setRecurringEmailSender({ send: async (_ctx, id) => void sent.push(id) });
    // An agent may never choose it, even with every scope.
    const byAgent = await client.post('/api/v1/recurring', body, agent.api_key);
    expect(byAgent.status).toBe(403);
    expect(byAgent.json.error.message).toMatch(/Only the user/);
    const mark = await client.post('/api/v1/recurring', { ...body, autoAction: 'mark_sent', name: 'Mark' }, agent.api_key);
    expect(mark.status).toBe(201);
    expect((await client.patch(`/api/v1/recurring/${mark.json.recurring.id}`, { autoAction: 'send_email' }, agent.api_key)).status).toBe(403);
    // The user can; an agent then cannot change, resume or run it, but can pause it.
    const userMail = (await client.post('/api/v1/recurring', body, token)).json.recurring;
    expect(userMail.autoAction).toBe('send_email');
    expect((await client.patch(`/api/v1/recurring/${userMail.id}`, { clientId: null, name: 'Changed' }, agent.api_key)).status).toBe(403);
    expect((await client.post(`/api/v1/recurring/${userMail.id}/run-now`, undefined, agent.api_key)).status).toBe(403);
    expect((await client.post(`/api/v1/recurring/${userMail.id}/pause`, undefined, agent.api_key)).status).toBe(200);
    expect((await client.post(`/api/v1/recurring/${userMail.id}/resume`, undefined, agent.api_key)).status).toBe(403);
    expect((await client.post(`/api/v1/recurring/${userMail.id}/resume`, undefined, token)).status).toBe(200);
    // Generation hands send_email invoices to the email feature; mark_sent ones are marked sent on the run date.
    at('2026-12-01T00:30:00.000Z');
    await run();
    const [mailed] = (await client.get(`/api/v1/invoices?recurring_id=${userMail.id}`, token)).json.invoices;
    expect(sent).toEqual([mailed.id]);
    const [marked] = (await client.get(`/api/v1/invoices?recurring_id=${mark.json.recurring.id}`, token)).json.invoices;
    expect(marked).toMatchObject({ status: 'sent', sentAt: '2026-12-01' });
  });

  it('MCP tools for API-key agents: listed by scope, create + pause + preview + run-now', async () => {
    const { client, app } = setup();
    const { token, template, globex } = await workspaceWithTemplate(client);
    const reader = await connectAgent(client, token, ['invoices:read']);
    const r = await mcpClient(app, reader.api_key);
    expect((await r.listTools()).tools.map((t) => t.name).filter((n) => n.includes('recurring'))).toEqual([]);
    await r.close();

    const agent = await connectAgent(client, token, FULL);
    const mcp = await mcpClient(app, agent.api_key);
    const tools = (await mcp.listTools()).tools;
    expect(tools.map((t) => t.name).filter((n) => n.includes('recurring')).sort()).toEqual([
      'create_recurring',
      'delete_recurring',
      'get_recurring',
      'list_recurring',
      'pause_recurring',
      'preview_recurring',
      'resume_recurring',
      'run_recurring_now',
      'update_recurring',
    ]);
    const create = tools.find((t) => t.name === 'create_recurring')!;
    expect(create.description).toMatch(/confirm with the user/);
    expect(create.description).toMatch(/time zone/);
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tools.find((t) => t.name === 'list_recurring')!.annotations).toMatchObject({ readOnlyHint: true });

    const created = parse(
      await mcp.callTool({
        name: 'create_recurring',
        arguments: { name: 'Globex monthly', templateId: template.id, clientId: globex.id, frequency: 'monthly', startDate: '2026-12-01', timezone: 'Europe/Berlin' },
      }),
    ).recurring;
    expect(created).toMatchObject({ status: 'active', nextRunDate: '2026-12-01', createdBy: { type: 'agent' } });
    const preview = parse(await mcp.callTool({ name: 'preview_recurring', arguments: { id: created.id, count: 3 } }));
    expect(preview.upcoming).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(preview.nextInvoice).toMatchObject({ issueDate: '2026-12-01', invoiceName: 'Retainer December 2026', toName: 'Globex Corporation', total: 2255 });
    const ran = parse(await mcp.callTool({ name: 'run_recurring_now', arguments: { id: created.id, period: '2026-12-01' } }));
    expect(ran).toMatchObject({ generated: true, period: '2026-12-01' });
    expect(parse(await mcp.callTool({ name: 'run_recurring_now', arguments: { id: created.id, period: '2026-12-01' } }))).toMatchObject({ generated: false });
    const history = parse(await mcp.callTool({ name: 'list_invoices', arguments: { recurring_id: created.id } }));
    expect(history.invoices).toHaveLength(1);
    expect(parse(await mcp.callTool({ name: 'pause_recurring', arguments: { id: created.id } })).recurring.status).toBe('paused');
    const refused = await mcp.callTool({ name: 'update_recurring', arguments: { id: created.id, autoAction: 'send_email' } });
    expect(refused.isError).toBe(true);
    await mcp.close();
    const entries = (await activity(client, token, 'recurring.')).map((e) => [e.action, e.source]);
    expect(entries).toEqual([
      ['recurring.paused', 'mcp'],
      ['recurring.created', 'mcp'],
    ]);
  });

  it('MCP tools for OAuth-connected agents', async () => {
    const { client, app } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const { tokens } = await connectOAuth(app, client, token, { scope: 'recurring:read recurring:write invoices:write templates:read clients:read' });
    const mcp = await mcpClient(app, tokens.access_token);
    const created = parse(
      await mcp.callTool({ name: 'create_recurring', arguments: { name: 'OAuth schedule', templateId: template.id, frequency: 'weekly', startDate: '2026-11-23', timezone: 'UTC' } }),
    ).recurring;
    expect(created).toMatchObject({ summary: 'Every week on Monday, starting 23 Nov 2026 — next: 23 Nov 2026', createdBy: { type: 'agent' } });
    expect(parse(await mcp.callTool({ name: 'pause_recurring', arguments: { id: created.id } })).recurring.status).toBe('paused');
    expect(parse(await mcp.callTool({ name: 'list_recurring', arguments: { status: ['paused'] } })).recurring).toHaveLength(1);
    await mcp.close();
  });
});

describe('recurring schedules: activity log', () => {
  it('records created, updated, paused, resumed and deleted with field names only', async () => {
    const { client } = setup();
    const { token, template } = await workspaceWithTemplate(client);
    const s = await createSchedule(client, token, { templateId: template.id, overrides: { notes: 'SECRET NOTE' } });
    await client.patch(`/api/v1/recurring/${s.id}`, { overrides: { notes: 'OTHER SECRET' }, endDate: '2027-12-31' }, token);
    await client.post(`/api/v1/recurring/${s.id}/pause`, undefined, token);
    await client.post(`/api/v1/recurring/${s.id}/resume`, undefined, token);
    await client.del(`/api/v1/recurring/${s.id}`, token);
    const entries = await activity(client, token, 'recurring.');
    expect(entries.map((e) => [e.action, e.entity?.label, e.changes])).toEqual([
      ['recurring.deleted', 'Globex retainer', null],
      ['recurring.resumed', 'Globex retainer', null],
      ['recurring.paused', 'Globex retainer', null],
      ['recurring.updated', 'Globex retainer', { fields: ['endDate', 'overrides'] }],
      ['recurring.created', 'Globex retainer', null],
    ]);
    expect(JSON.stringify(entries)).not.toContain('SECRET');
  });
});
