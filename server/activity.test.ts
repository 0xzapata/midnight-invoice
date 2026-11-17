import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Scope } from '../shared/api';
import { ACTIVITY_RETENTION, type ActivityEntry } from '../shared/activity';
import { CRON_SCHEDULES, JOBS, runScheduledJobs } from './scheduled';
import { SETTINGS } from './operator/settings-registry';
import { api, BASE, connectAgent, createWorkspace, readPublicAsset, sampleInvoice, startD1, TestClock, type Api } from './test/helpers';
import { createApp } from './app';
import { defaultDeps } from './deps';
import type { ActivityRow } from './db/activityRepository';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const ALL: Scope[] = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read', 'clients:read', 'clients:write', 'activity:read'];
const SECRET_NOTE = 'NOTE-7f3a-private-memo';
const SECRET_IBAN = 'IBAN-DE00-SECRET-1234';
const SECRET_ADDR = 'ADDR-42-Hidden-Lane';
const SECRET_LINE = 'LINE-ITEM-confidential-work';
const UUIDS = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  d: '44444444-4444-4444-8444-444444444444',
  e: '55555555-5555-4555-8555-555555555555',
  batch: '99999999-9999-4999-8999-999999999999',
};

function setup() {
  const clock = new TestClock();
  const errors: unknown[] = [];
  const deps = defaultDeps({ db: d1.db, readAsset: readPublicAsset, clock: clock.fn, logError: (_m, e) => errors.push(e) });
  const app = createApp(deps);
  return { app, client: api(app), errors, clock, deps };
}

async function mcpClient(app: ReturnType<typeof createApp>, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'activity-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const parse = (result: { content?: unknown }) =>
  JSON.parse((result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!.text!);

/** All raw rows of a workspace, oldest first. */
async function rows(workspaceId: string): Promise<ActivityRow[]> {
  const { results } = await d1.db.prepare('SELECT * FROM activity WHERE workspace_id = ? ORDER BY id').bind(workspaceId).all<ActivityRow>();
  return results;
}

async function entries(client: Api, token: string, query = ''): Promise<ActivityEntry[]> {
  const res = await client.get(`/api/v1/activity?limit=200${query ? `&${query}` : ''}`, token);
  expect(res.status, res.text).toBe(200);
  return res.json.activity;
}

const summary = (e: ActivityEntry) =>
  `${e.actor.type === 'agent' ? e.actor.agentName : e.actor.type} ${e.action} ${e.entity?.label ?? '-'} ${e.source}${e.tool ? `:${e.tool}` : ''}`;

/** Waits for background (waitUntil) entries; then checks nothing else trickles in. */
async function settle(workspaceId: string, count: number) {
  await vi.waitFor(async () => expect(await rows(workspaceId)).toHaveLength(count), { timeout: 3000, interval: 20 });
  await new Promise((r) => setTimeout(r, 50));
  expect(await rows(workspaceId)).toHaveLength(count);
}

describe('activity log: every mutating path records exactly one entry', () => {
  it('invoices over REST: create, update, status, no-op, delete, PDF', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const agent = await connectAgent(client, ws.token, ALL, undefined, 'Billing Assistant');
    const base = (await rows(wid)).length; // approved + registered
    expect(base).toBe(2);

    const created = await client.post('/api/v1/invoices', sampleInvoice({ notes: SECRET_NOTE, paymentDetails: SECRET_IBAN }), agent.api_key);
    expect(created.status).toBe(201);
    const id = created.json.invoice.id;
    expect((await client.patch(`/api/v1/invoices/${id}`, { dueDate: '2026-12-01', notes: `${SECRET_NOTE}-2` }, agent.api_key)).status).toBe(200);
    expect((await client.post(`/api/v1/invoices/${id}/mark-sent`, undefined, agent.api_key)).status).toBe(200);
    expect((await client.post(`/api/v1/invoices/${id}/mark-paid`, { paidAt: '2026-11-17' }, agent.api_key)).status).toBe(200);
    // Repeating mark-paid is a no-op: no entry.
    expect((await client.post(`/api/v1/invoices/${id}/mark-paid`, undefined, agent.api_key)).status).toBe(200);
    // A routine sync PUT that changes nothing: no entry.
    const current = (await client.get(`/api/v1/invoices/${id}`, ws.token)).json.invoice;
    expect((await client.put(`/api/v1/invoices/${id}`, current, ws.token, { 'if-match': `"${current.revision}"` })).status).toBe(200);
    // The user's browser changes it (PUT replace from sync).
    expect((await client.put(`/api/v1/invoices/${id}`, { ...current, toName: 'Globex' }, ws.token)).status).toBe(200);
    // PDF download (background entry), twice within the window: recorded once.
    expect((await client.get(`/api/v1/invoices/${id}/pdf`, agent.api_key)).status).toBe(200);
    expect((await client.get(`/api/v1/invoices/${id}/pdf?theme=light`, agent.api_key)).status).toBe(200);
    expect((await client.del(`/api/v1/invoices/${id}`, agent.api_key)).status).toBe(204);
    expect((await client.del(`/api/v1/invoices/${id}`, agent.api_key)).status).toBe(204); // tombstone: no entry

    await settle(wid, base + 7);
    const list = await entries(client, ws.token, 'entity_type=invoice');
    expect(list.map(summary).reverse()).toEqual([
      'Billing Assistant invoice.created INV-0001 rest',
      'Billing Assistant invoice.updated INV-0001 rest',
      'Billing Assistant invoice.status_changed INV-0001 rest',
      'Billing Assistant invoice.status_changed INV-0001 rest',
      'user invoice.updated INV-0001 rest',
      'Billing Assistant invoice.pdf_downloaded INV-0001 rest',
      'Billing Assistant invoice.deleted INV-0001 rest',
    ]);
    const [created1, patched, sent, paid, userEdit, pdf] = [...list].reverse();
    expect(created1.changes).toBeNull();
    expect(created1.entity).toEqual({ type: 'invoice', id, label: 'INV-0001' });
    expect(created1.actor).toEqual({ type: 'agent', agentId: agent.agent.id, agentName: 'Billing Assistant' });
    expect(patched.changes).toEqual({ fields: ['dueDate', 'notes'] });
    expect(sent.changes).toEqual({ status: { from: 'draft', to: 'sent' } });
    expect(paid.changes).toEqual({ status: { from: 'sent', to: 'paid' } });
    expect(userEdit.changes).toEqual({ fields: ['toName'] });
    expect(pdf.changes).toEqual({ theme: 'dark' });
    expect(created1.requestId).toEqual(expect.any(String));
  });

  it('invoices and clients over MCP carry the tool name', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const agent = await connectAgent(client, ws.token, ALL, undefined, 'MCP Bot');
    const mcp = await mcpClient(app, agent.api_key);
    const inv = parse(await mcp.callTool({ name: 'create_invoice', arguments: sampleInvoice({ toAddress: SECRET_ADDR }) })).invoice;
    await mcp.callTool({ name: 'update_invoice', arguments: { id: inv.id, dueDate: '2026-12-24' } });
    await mcp.callTool({ name: 'update_invoice', arguments: { id: inv.id, dueDate: '2026-12-24' } }); // unchanged: no entry
    await mcp.callTool({ name: 'set_invoice_status', arguments: { id: inv.id, status: 'sent' } });
    await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: inv.id } });
    const cl = parse(await mcp.callTool({ name: 'create_client', arguments: { name: 'Globex', notes: SECRET_NOTE } })).client;
    await mcp.callTool({ name: 'update_client', arguments: { id: cl.id, email: 'ap@globex.example' } });
    await mcp.callTool({ name: 'update_client', arguments: { id: cl.id, archivedAt: '2026-11-17T10:00:00Z' } });
    await mcp.callTool({ name: 'delete_client', arguments: { id: cl.id } });
    await mcp.callTool({ name: 'delete_invoice', arguments: { id: inv.id } });
    await mcp.callTool({ name: 'get_invoice', arguments: { id: inv.id } }); // reads are not logged
    await mcp.close();

    await settle(wid, 2 + 9);
    const list = (await entries(client, ws.token, `actor=agent:${agent.agent.id}`)).reverse();
    expect(list.map(summary)).toEqual([
      'MCP Bot agent.registered MCP Bot rest',
      'MCP Bot invoice.created INV-0001 mcp:create_invoice',
      'MCP Bot invoice.updated INV-0001 mcp:update_invoice',
      'MCP Bot invoice.status_changed INV-0001 mcp:set_invoice_status',
      'MCP Bot invoice.pdf_downloaded INV-0001 mcp:get_invoice_pdf',
      'MCP Bot client.created Globex mcp:create_client',
      'MCP Bot client.updated Globex mcp:update_client',
      'MCP Bot client.archived Globex mcp:update_client',
      'MCP Bot client.deleted Globex mcp:delete_client',
      'MCP Bot invoice.deleted INV-0001 mcp:delete_invoice',
    ]);
    expect(list[6].changes).toEqual({ fields: ['email'] });
  });

  it('clients over REST incl. unarchive, and settings', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const c = (await client.post('/api/v1/clients', { name: 'Initech', address: SECRET_ADDR }, ws.token)).json.client;
    await client.patch(`/api/v1/clients/${c.id}`, { archivedAt: '2026-11-17T10:00:00Z' }, ws.token);
    await client.patch(`/api/v1/clients/${c.id}`, { archivedAt: null }, ws.token);
    await client.put(`/api/v1/clients/${c.id}`, { name: 'Initech LLC', address: SECRET_ADDR }, ws.token);
    await client.put(`/api/v1/clients/${c.id}`, { name: 'Initech LLC', address: SECRET_ADDR }, ws.token); // unchanged
    await client.put(`/api/v1/clients/${UUIDS.a}`, { name: 'Umbrella' }, ws.token, { 'if-none-match': '*' });
    await client.del(`/api/v1/clients/${UUIDS.a}`, ws.token);
    const settings = { fromName: 'Midnight Studio', paymentDetails: SECRET_IBAN };
    expect((await client.put('/api/v1/settings', settings, ws.token)).status).toBe(200);
    expect((await client.put('/api/v1/settings', settings, ws.token)).status).toBe(200); // unchanged
    await settle(wid, 7);
    const list = (await entries(client, ws.token)).reverse();
    expect(list.map(summary)).toEqual([
      'user client.created Initech rest',
      'user client.archived Initech rest',
      'user client.unarchived Initech rest',
      'user client.updated Initech LLC rest',
      'user client.created Umbrella rest',
      'user client.deleted Umbrella rest',
      'user settings.updated - rest',
    ]);
    expect(list[3].changes).toEqual({ fields: ['name'] });
    expect(list[6].changes).toEqual({ fields: ['fromName', 'paymentDetails'] });
  });

  it('agent access: approved with scopes, registered, denied, revoked, revoked key used (throttled)', async () => {
    const { client, clock } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const agent = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write'], ['invoices:read'], 'Narrowed');
    const reg = await client.post('/api/v1/agents/register', { name: 'Sketchy', scopes: ['invoices:delete'] });
    expect((await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/deny`, undefined, ws.token)).status).toBe(200);
    expect((await client.del(`/api/v1/agents/${agent.agent.id}`, ws.token)).status).toBe(204);
    expect((await client.del(`/api/v1/agents/${agent.agent.id}`, ws.token)).status).toBe(204); // already revoked: no entry
    // The revoked key keeps trying (REST and MCP): one entry per hour.
    expect((await client.get('/api/v1/invoices', agent.api_key)).status).toBe(401);
    expect((await client.post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, agent.api_key)).status).toBe(401);
    await settle(wid, 5);
    clock.advance(3_600_000);
    expect((await client.get('/api/v1/invoices', agent.api_key)).status).toBe(401);
    // Unknown keys are not attributable and not recorded.
    expect((await client.get('/api/v1/invoices', `mi_agent_${'x'.repeat(43)}`)).status).toBe(401);
    await settle(wid, 6);

    const list = (await entries(client, ws.token)).reverse();
    expect(list.map((e) => `${summary(e)} ${e.entity?.type}`)).toEqual([
      'user agent.approved Narrowed rest agent_registration',
      'Narrowed agent.registered Narrowed rest agent',
      'user agent.denied Sketchy rest agent_registration',
      'user agent.revoked Narrowed rest agent',
      'Narrowed agent.revoked_key_used Narrowed rest agent',
      'Narrowed agent.revoked_key_used Narrowed rest agent',
    ]);
    expect(list[0].changes).toEqual({ scopes: ['invoices:read'] });
    expect(list[1].changes).toEqual({ scopes: ['invoices:read'], registrationId: list[0].entity!.id });
    expect(list[2].changes).toBeNull();
    // Per-agent view: by or about the agent.
    const perAgent = await client.get(`/api/v1/agents/${agent.agent.id}/activity`, ws.token);
    expect(perAgent.json.activity.map((e: ActivityEntry) => e.action)).toEqual([
      'agent.revoked_key_used',
      'agent.revoked_key_used',
      'agent.revoked',
      'agent.registered',
      'agent.approved',
    ]);
    expect((await client.get('/api/v1/agents/nope/activity', ws.token)).status).toBe(404);
  });
});

describe('activity log: noise suppression', () => {
  it('summarises a browser bulk upload into one entry and ignores the marker from agents', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const bulk = { 'x-midnight-sync': `bulk-upload; batch=${UUIDS.batch}`, 'if-none-match': '*' };
    await client.put(`/api/v1/clients/${UUIDS.a}`, { name: 'Acme' }, ws.token, bulk);
    await client.put(`/api/v1/clients/${UUIDS.b}`, { name: 'Globex' }, ws.token, bulk);
    for (const id of [UUIDS.c, UUIDS.d, UUIDS.e]) {
      expect((await client.put(`/api/v1/invoices/${id}`, sampleInvoice({ notes: SECRET_NOTE }), ws.token, bulk)).status).toBe(201);
    }
    // A retried upload of an existing invoice (412) adds nothing.
    expect((await client.put(`/api/v1/invoices/${UUIDS.c}`, sampleInvoice(), ws.token, bulk)).status).toBe(412);
    await settle(wid, 1);
    const [entry] = await entries(client, ws.token);
    expect(entry).toMatchObject({ action: 'sync.bulk_upload', actor: { type: 'user' }, entity: null, changes: { counts: { clients: 2, invoices: 3 } } });

    // Later edits are logged normally; a malformed marker is ignored.
    await client.patch(`/api/v1/invoices/${UUIDS.c}`, { dueDate: '2026-12-01' }, ws.token, { 'x-midnight-sync': 'bulk-upload; batch=nope' });
    // An agent cannot hide its creates behind the marker.
    const agent = await connectAgent(client, ws.token, ALL);
    await client.post('/api/v1/invoices', sampleInvoice(), agent.api_key, { 'x-midnight-sync': `bulk-upload; batch=${UUIDS.batch}` });
    await settle(wid, 5);
    expect((await entries(client, ws.token)).map((e) => e.action)).toEqual(['invoice.created', 'agent.registered', 'agent.approved', 'invoice.updated', 'sync.bulk_upload']);
  });
});

describe('activity log: contents never include bodies or secrets', () => {
  it('scans every recorded row of a broad scenario', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const wid = ws.workspace.id;
    const agent = await connectAgent(client, ws.token, ALL, undefined, 'Scanner');
    const body = sampleInvoice({
      notes: SECRET_NOTE,
      paymentDetails: SECRET_IBAN,
      toAddress: SECRET_ADDR,
      lineItems: [{ description: SECRET_LINE, quantity: 1, price: 987654 }],
    });
    const inv = (await client.post('/api/v1/invoices', body, agent.api_key)).json.invoice;
    await client.patch(`/api/v1/invoices/${inv.id}`, { notes: `${SECRET_NOTE}!`, lineItems: [{ description: `${SECRET_LINE}!`, quantity: 2, price: 5 }] }, agent.api_key);
    await client.put(`/api/v1/invoices/${UUIDS.a}`, body, ws.token, { 'x-midnight-sync': `bulk-upload; batch=${UUIDS.batch}` });
    await client.put('/api/v1/settings', { fromName: 'Me', paymentDetails: SECRET_IBAN, notes: SECRET_NOTE }, ws.token);
    const c = (await client.post('/api/v1/clients', { name: 'Client', notes: SECRET_NOTE, address: SECRET_ADDR }, agent.api_key)).json.client;
    await client.patch(`/api/v1/clients/${c.id}`, { notes: `${SECRET_NOTE}?` }, agent.api_key);
    const mcp = await mcpClient(app, agent.api_key);
    await mcp.callTool({ name: 'update_invoice', arguments: { id: inv.id, paymentDetails: `${SECRET_IBAN}?` } });
    await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: inv.id } });
    await mcp.close();
    await client.del(`/api/v1/agents/${agent.agent.id}`, ws.token);
    await client.get('/api/v1/invoices', agent.api_key);
    await settle(wid, 12);

    const all = JSON.stringify(await rows(wid));
    for (const secret of [SECRET_NOTE, SECRET_IBAN, SECRET_ADDR, SECRET_LINE, ws.token, agent.api_key, 'mi_ws_', 'mi_agent_', 'mi_dc_', '987654']) {
      expect(all, secret).not.toContain(secret);
    }
    for (const row of await rows(wid)) {
      const changes = row.changes ? (JSON.parse(row.changes) as Record<string, unknown>) : {};
      expect(Object.keys(changes).every((k) => ['fields', 'status', 'scopes', 'counts', 'theme', 'registrationId'].includes(k))).toBe(true);
      expect((row.changes ?? '').length).toBeLessThan(300);
    }
  });
});

describe('activity log: reading', () => {
  async function scenario() {
    const s = setup();
    const ws = await createWorkspace(s.client);
    const a1 = await connectAgent(s.client, ws.token, ALL, undefined, 'Alpha');
    s.clock.advance(60_000);
    const a2 = await connectAgent(s.client, ws.token, ['invoices:read', 'invoices:write'], undefined, 'Beta');
    s.clock.advance(60_000);
    const i1 = (await s.client.post('/api/v1/invoices', sampleInvoice(), a1.api_key)).json.invoice;
    s.clock.advance(60_000);
    const i2 = (await s.client.post('/api/v1/invoices', sampleInvoice(), a2.api_key)).json.invoice;
    s.clock.advance(60_000);
    await s.client.post(`/api/v1/invoices/${i1.id}/mark-sent`, undefined, ws.token);
    await s.client.post('/api/v1/clients', { name: 'Acme' }, a1.api_key);
    await settle(ws.workspace.id, 8);
    return { ...s, ws, a1, a2, i1, i2 };
  }

  it('filters by actor, agent, action prefixes, entity and time; pages newest first', async () => {
    const { client, ws, a1, a2, i1 } = await scenario();
    const t = ws.token;
    const actions = async (q: string) => (await entries(client, t, q)).map((e) => e.action);
    expect(await actions('actor=user')).toEqual(['invoice.status_changed', 'agent.approved', 'agent.approved']);
    expect(await actions(`actor=agent:${a2.agent.id}`)).toEqual(['invoice.created', 'agent.registered']);
    expect(await actions(`agent_id=${a1.agent.id}`)).toEqual(['client.created', 'invoice.created', 'agent.registered', 'agent.approved']);
    expect(await actions('action=agent.')).toEqual(['agent.registered', 'agent.approved', 'agent.registered', 'agent.approved']);
    expect(await actions('action=client.,invoice.status_changed')).toEqual(['client.created', 'invoice.status_changed']);
    expect(await actions(`entity_type=invoice&entity_id=${i1.id}`)).toEqual(['invoice.status_changed', 'invoice.created']);
    expect(await actions('since=2026-11-17T10:02:00Z&until=2026-11-17T10:03:00Z')).toEqual(['invoice.created', 'invoice.created']);

    // Paging: 3 + 3 + 2, no overlap, newest first.
    const seen: string[] = [];
    let before = '';
    for (let page = 0; page < 5; page++) {
      const res = await client.get(`/api/v1/activity?limit=3${before ? `&before=${before}` : ''}`, t);
      seen.push(...res.json.activity.map((e: ActivityEntry) => e.id));
      if (!res.json.hasMore) {
        expect(res.json.next).toBeNull();
        break;
      }
      before = res.json.next.before;
    }
    expect(seen).toHaveLength(8);
    expect([...seen].sort().reverse()).toEqual(seen);

    for (const bad of ['actor=robot', 'action=DROP TABLE', 'since=yesterday', 'limit=0', 'limit=999', 'before=x']) {
      expect((await client.get(`/api/v1/activity?${bad}`, t)).status, bad).toBe(400);
    }
  });

  it('keeps workspaces apart', async () => {
    const { client } = await scenario();
    const other = await createWorkspace(client);
    expect(await entries(client, other.token)).toEqual([]);
  });

  it('agents read only their own activity, and only with activity:read', async () => {
    const { app, client, a1, a2 } = await scenario();
    // Beta has no activity:read.
    const denied = await client.get('/api/v1/activity', a2.api_key);
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('insufficient_scope');
    // Alpha sees exactly its own entries.
    const own = await entries(client, a1.api_key);
    expect(own.map((e) => e.action)).toEqual(['client.created', 'invoice.created', 'agent.registered']);
    expect(own.every((e) => e.actor.type === 'agent' && e.actor.agentId === a1.agent.id)).toBe(true);
    expect((await client.get('/api/v1/activity?actor=user', a1.api_key)).status).toBe(403);
    expect((await client.get(`/api/v1/activity?actor=agent:${a2.agent.id}`, a1.api_key)).status).toBe(403);
    expect((await client.get(`/api/v1/activity?agent_id=${a2.agent.id}`, a1.api_key)).status).toBe(403);
    expect((await client.get(`/api/v1/agents/${a2.agent.id}/activity`, a1.api_key)).status).toBe(403);
    expect((await client.get(`/api/v1/agents/${a1.agent.id}/activity`, a1.api_key)).json.activity).toHaveLength(3);
    // MCP: get_my_activity is listed only with the scope and returns own entries.
    const alpha = await mcpClient(app, a1.api_key);
    const result = parse(await alpha.callTool({ name: 'get_my_activity', arguments: { action: 'invoice.' } }));
    expect(result.activity.map((e: ActivityEntry) => e.action)).toEqual(['invoice.created']);
    await alpha.close();
    const beta = await mcpClient(app, a2.api_key);
    expect((await beta.listTools()).tools.map((x) => x.name)).not.toContain('get_my_activity');
    await beta.close();
  });
});

describe('activity log: retention and deletion', () => {
  it('prunes by row count and by age in the daily scheduled job, per the operator settings', async () => {
    const { client, clock, deps } = setup();
    await deps.settings.set('activity.maxRowsPerWorkspace', 100, { id: null, email: null, type: 'system' });
    await deps.settings.set('activity.retentionDays', 30, { id: null, email: null, type: 'system' });
    const ws = await createWorkspace(client);
    const other = await createWorkspace(client);
    for (let i = 0; i < 103; i++) await client.post('/api/v1/clients', { name: `C${i}` }, ws.token);
    await client.post('/api/v1/clients', { name: 'Other' }, other.token);
    // Nothing is pruned on write.
    expect(await rows(ws.workspace.id)).toHaveLength(103);
    const run = () => runScheduledJobs(deps, { cron: '43 3 * * *', scheduledTime: clock.now.getTime() });
    expect(await run()).toEqual([{ name: 'activity.retention', ok: true }]);
    const kept = await rows(ws.workspace.id);
    expect(kept).toHaveLength(100);
    expect(kept[0].entity_label).toBe('C3');
    expect(await rows(other.workspace.id)).toHaveLength(1);
    clock.advance(31 * 24 * 3_600_000);
    await client.post('/api/v1/clients', { name: 'Fresh' }, ws.token);
    await run();
    expect((await rows(ws.workspace.id)).map((r) => r.entity_label)).toEqual(['Fresh']);
    expect(await rows(other.workspace.id)).toHaveLength(0);
    await deps.settings.reset('activity.maxRowsPerWorkspace', { id: null, email: null, type: 'system' });
    await deps.settings.reset('activity.retentionDays', { id: null, email: null, type: 'system' });
  });

  it('the retention job is in the registry with a configured cron and defaults from ACTIVITY_RETENTION', () => {
    expect(JOBS.map((j) => j.name)).toContain('activity.retention');
    expect(CRON_SCHEDULES).toContain('43 3 * * *');
    expect(SETTINGS['activity.retentionDays'].default).toBe(ACTIVITY_RETENTION.days);
    expect(SETTINGS['activity.maxRowsPerWorkspace'].default).toBe(ACTIVITY_RETENTION.maxRows);
  });

  it('deleting the workspace deletes its activity', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    await client.post('/api/v1/clients', { name: 'Gone' }, ws.token);
    expect(await rows(ws.workspace.id)).toHaveLength(1);
    expect((await client.del('/api/v1/workspace', ws.token)).status).toBe(204);
    expect(await rows(ws.workspace.id)).toHaveLength(0);
  });
});

describe('activity log: a logging failure never fails the request', () => {
  it('atomic and background paths succeed and report the error when the activity table is unusable', async () => {
    const { client, errors } = setup();
    const ws = await createWorkspace(client);
    const agent = await connectAgent(client, ws.token, ALL);
    await d1.db.exec('ALTER TABLE activity RENAME TO activity_broken');
    try {
      const inv = await client.post('/api/v1/invoices', sampleInvoice(), agent.api_key);
      expect(inv.status).toBe(201);
      expect((await client.patch(`/api/v1/invoices/${inv.json.invoice.id}`, { dueDate: '2026-12-01' }, agent.api_key)).status).toBe(200);
      expect((await client.post(`/api/v1/invoices/${inv.json.invoice.id}/mark-sent`, undefined, agent.api_key)).status).toBe(200);
      expect((await client.post('/api/v1/clients', { name: 'Still works' }, agent.api_key)).status).toBe(201);
      expect((await client.put('/api/v1/settings', { fromName: 'Still' }, ws.token)).status).toBe(200);
      expect((await client.get(`/api/v1/invoices/${inv.json.invoice.id}/pdf`, agent.api_key)).status).toBe(200);
      expect((await client.del(`/api/v1/invoices/${inv.json.invoice.id}`, agent.api_key)).status).toBe(204);
      expect((await client.del(`/api/v1/agents/${agent.agent.id}`, ws.token)).status).toBe(204);
      // The writes really happened.
      expect((await client.get(`/api/v1/invoices/${inv.json.invoice.id}`, ws.token)).status).toBe(410);
      expect((await client.get('/api/v1/settings', ws.token)).json.settings.fromName).toBe('Still');
      await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(8), { timeout: 3000 });
      expect(errors.every((e) => String(e).includes('activity'))).toBe(true);
    } finally {
      await d1.db.exec('ALTER TABLE activity_broken RENAME TO activity');
    }
  });
});
