import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Scope } from '../shared/api';
import { api, BASE, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';

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
  return { app, client: api(app) };
}

async function freshWorkspace() {
  const { app, client } = setup();
  const ws = await createWorkspace(client);
  return { app, client, token: ws.token };
}

const GLOBEX = { name: 'Globex Corporation', email: 'ap@globex.example', address: '1 Globex Way\nSpringfield' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('clients CRUD', () => {
  it('creates, reads, replaces, patches and soft-deletes with revisions and ETags', async () => {
    const { client, token } = await freshWorkspace();
    const created = await client.post('/api/v1/clients', { ...GLOBEX, defaultCurrency: 'EUR', paymentTermsDays: 30 }, token);
    expect(created.status).toBe(201);
    const c = created.json.client;
    expect(created.headers.get('etag')).toBe('"1"');
    expect(created.headers.get('location')).toBe(`/api/v1/clients/${c.id}`);
    expect(c).toMatchObject({
      ...GLOBEX,
      defaultCurrency: 'EUR',
      defaultTaxRate: null,
      paymentTermsDays: 30,
      notes: '',
      archivedAt: null,
      revision: 1,
      deletedAt: null,
      createdBy: { type: 'user' },
      invoiceCount: 0,
    });
    expect((await client.get(`/api/v1/clients/${c.id}`, token)).json.client).toEqual(c);

    // PATCH keeps other fields; If-Match guards it.
    const patched = await client.patch(`/api/v1/clients/${c.id}`, { notes: 'Pays late' }, token, { 'if-match': '"1"' });
    expect(patched.status).toBe(200);
    expect(patched.json.client).toMatchObject({ ...GLOBEX, notes: 'Pays late', revision: 2, paymentTermsDays: 30 });
    const stale = await client.patch(`/api/v1/clients/${c.id}`, { notes: 'x' }, token, { 'if-match': '"1"' });
    expect(stale.status).toBe(412);
    expect(stale.json.error.details.currentRevision).toBe(2);

    // Archive / unarchive is a field, not a delete.
    const archived = await client.patch(`/api/v1/clients/${c.id}`, { archivedAt: '2026-11-17T12:00:00+01:00' }, token);
    expect(archived.json.client.archivedAt).toBe('2026-11-17T11:00:00.000Z');
    expect((await client.get('/api/v1/clients', token)).json.clients).toHaveLength(1);

    // PUT replaces the whole body (omitted optional fields reset).
    const replaced = await client.put(`/api/v1/clients/${c.id}`, { name: 'Globex' }, token, { 'if-match': '"3"' });
    expect(replaced.status).toBe(200);
    expect(replaced.json.client).toMatchObject({ name: 'Globex', email: '', notes: '', paymentTermsDays: null, archivedAt: null, revision: 4, createdAt: c.createdAt });

    // Soft delete → 410 afterwards, idempotent, final.
    expect((await client.del(`/api/v1/clients/${c.id}`, token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.del(`/api/v1/clients/${c.id}`, token)).status).toBe(204);
    expect((await client.del(`/api/v1/clients/${c.id}`, token)).status).toBe(204);
    const gone = await client.get(`/api/v1/clients/${c.id}`, token);
    expect(gone.status).toBe(410);
    expect((await client.put(`/api/v1/clients/${c.id}`, GLOBEX, token)).status).toBe(410);
    expect((await client.patch(`/api/v1/clients/${c.id}`, { name: 'x' }, token)).status).toBe(410);
    expect((await client.get(`/api/v1/clients/${uuid(99)}`, token)).status).toBe(404);
    expect((await client.del(`/api/v1/clients/${uuid(99)}`, token)).status).toBe(404);
  });

  it('PUT creates with a client-chosen id (If-None-Match: * = create only) and keeps createdAt', async () => {
    const { client, token } = await freshWorkspace();
    const id = uuid(1);
    const res = await client.put(`/api/v1/clients/${id}`, { ...GLOBEX, createdAt: '2026-01-02T03:04:05.000Z' }, token, { 'if-none-match': '*' });
    expect(res.status).toBe(201);
    expect(res.json.client).toMatchObject({ id, createdAt: '2026-01-02T03:04:05.000Z', revision: 1 });
    expect((await client.put(`/api/v1/clients/${id}`, GLOBEX, token, { 'if-none-match': '*' })).status).toBe(412);
    expect((await client.put(`/api/v1/clients/${uuid(2)}`, GLOBEX, token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.put(`/api/v1/clients/not-a-uuid`, GLOBEX, token)).status).toBe(400);
    expect((await client.put(`/api/v1/clients/${id}`, { ...GLOBEX, id: uuid(3) }, token)).status).toBe(400);
  });

  it('validates input', async () => {
    const { client, token } = await freshWorkspace();
    const bad = await client.post(
      '/api/v1/clients',
      { name: ' ', email: 'nope', defaultCurrency: 'XXX', defaultTaxRate: 101, paymentTermsDays: 1.5 },
      token,
    );
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('validation_failed');
    expect(bad.json.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['defaultCurrency', 'defaultTaxRate', 'email', 'name', 'paymentTermsDays']);
  });
});

describe('clients listing', () => {
  it('searches name or email case-insensitively, treating LIKE wildcards literally', async () => {
    const { client, token } = await freshWorkspace();
    for (const c of [GLOBEX, { name: 'Initech', email: 'billing@initech.example' }, { name: 'Umbrella 100%', email: '' }, { name: 'Hooli', email: 'ap@GLOBEX-partner.example' }]) {
      expect((await client.post('/api/v1/clients', c, token)).status).toBe(201);
    }
    const names = async (q: string) =>
      ((await client.get(`/api/v1/clients?q=${encodeURIComponent(q)}`, token)).json.clients as { name: string }[]).map((c) => c.name).sort();
    expect(await names('globex')).toEqual(['Globex Corporation', 'Hooli']);
    expect(await names('INITECH')).toEqual(['Initech']);
    expect(await names('%')).toEqual(['Umbrella 100%']);
    expect(await names('_')).toEqual([]);
    expect(await names('')).toHaveLength(4);
  });

  it('is a sync feed: updated_since (inclusive), keyset paging, tombstones only with include_deleted', async () => {
    const { client, token } = await freshWorkspace();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await client.post('/api/v1/clients', { name: `C${i}` }, token)).json.client.id);
    const first = await client.get('/api/v1/clients?limit=2', token);
    expect(first.json.clients).toHaveLength(2);
    expect(first.json.hasMore).toBe(true);
    const { updated_since, after_id } = first.json.next;
    const second = await client.get(`/api/v1/clients?limit=2&updated_since=${encodeURIComponent(updated_since)}&after_id=${after_id}`, token);
    expect(second.json.clients).toHaveLength(1);
    expect(second.json.hasMore).toBe(false);
    expect([...first.json.clients, ...second.json.clients].map((c: { id: string }) => c.id).sort()).toEqual([...ids].sort());

    const cursor = second.json.syncedAt;
    await client.del(`/api/v1/clients/${ids[0]}`, token);
    expect((await client.get(`/api/v1/clients?updated_since=${encodeURIComponent(cursor)}`, token)).json.clients).toEqual([]);
    const delta = await client.get(`/api/v1/clients?include_deleted=true&updated_since=${encodeURIComponent(cursor)}`, token);
    expect(delta.json.clients).toHaveLength(1);
    expect(delta.json.clients[0]).toMatchObject({ id: ids[0], revision: 2 });
    expect(delta.json.clients[0].deletedAt).not.toBeNull();
    expect(delta.json.clients[0]).not.toHaveProperty('invoiceCount');
    expect((await client.get('/api/v1/clients?after_id=x', token)).status).toBe(400);
  });
});

describe('scopes and isolation', () => {
  it('requires clients:read / clients:write; existing agents keep exactly their scopes', async () => {
    const { client, token } = await freshWorkspace();
    const c = (await client.post('/api/v1/clients', GLOBEX, token)).json.client;
    const invoiceAgent = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read']);
    expect(invoiceAgent.agent.scopes).not.toContain('clients:read');
    const me = await client.get('/api/v1/agents/me', invoiceAgent.api_key);
    expect(me.json.agent.scopes).toEqual(['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read']);
    const denied = await client.get('/api/v1/clients', invoiceAgent.api_key);
    expect(denied.status).toBe(403);
    expect(denied.json.error.details.requiredScope).toBe('clients:read');
    // Billing a client needs clients:read too.
    const bill = await client.post('/api/v1/invoices', { clientId: c.id, lineItems: sampleInvoice().lineItems, fromName: 'S' }, invoiceAgent.api_key);
    expect(bill.status).toBe(403);
    expect(bill.json.error.details.requiredScope).toBe('clients:read');

    const reader = await connectAgent(client, token, ['clients:read']);
    const listed = await client.get('/api/v1/clients', reader.api_key);
    expect(listed.status).toBe(200);
    // No invoices:read → no invoice counts.
    expect(listed.json.clients[0]).not.toHaveProperty('invoiceCount');
    expect((await client.post('/api/v1/clients', GLOBEX, reader.api_key)).status).toBe(403);
    expect((await client.del(`/api/v1/clients/${c.id}`, reader.api_key)).status).toBe(403);

    const writer = await connectAgent(client, token, ['clients:write']);
    expect((await client.get('/api/v1/clients', writer.api_key)).status).toBe(403);
    const made = await client.post('/api/v1/clients', { name: 'Agent Co' }, writer.api_key);
    expect(made.status).toBe(201);
    expect(made.json.client.createdBy).toMatchObject({ type: 'agent', agentId: writer.agent.id });
    expect((await client.del(`/api/v1/clients/${made.json.client.id}`, writer.api_key)).status).toBe(204);
  });

  it('workspace A can neither read nor reference workspace B’s clients', async () => {
    const { client } = setup();
    const a = await createWorkspace(client);
    const b = await createWorkspace(client);
    const bClient = (await client.post('/api/v1/clients', GLOBEX, b.token)).json.client;
    expect((await client.get(`/api/v1/clients/${bClient.id}`, a.token)).status).toBe(404);
    expect((await client.get('/api/v1/clients', a.token)).json.clients).toEqual([]);
    expect((await client.get(`/api/v1/clients?q=globex`, a.token)).json.clients).toEqual([]);
    expect((await client.patch(`/api/v1/clients/${bClient.id}`, { name: 'Hijack' }, a.token)).status).toBe(404);
    expect((await client.del(`/api/v1/clients/${bClient.id}`, a.token)).status).toBe(404);
    // Same id in A is a different client.
    expect((await client.put(`/api/v1/clients/${bClient.id}`, { name: 'A’s own' }, a.token)).status).toBe(201);
    expect((await client.get(`/api/v1/clients/${bClient.id}`, b.token)).json.client.name).toBe(GLOBEX.name);

    const c2 = (await client.post('/api/v1/clients', { name: 'Only in B' }, b.token)).json.client;
    const ref = await client.post('/api/v1/invoices', { clientId: c2.id, fromName: 'A', lineItems: sampleInvoice().lineItems }, a.token);
    expect(ref.status).toBe(400);
    expect(ref.json.error.details).toEqual([{ path: 'clientId', message: 'No client with this id exists in this workspace' }]);
  });

  it('deleting the workspace deletes its clients', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const c = (await client.post('/api/v1/clients', GLOBEX, ws.token)).json.client;
    expect((await client.del('/api/v1/workspace', ws.token)).status).toBe(204);
    const row = await d1.db.prepare('SELECT COUNT(*) AS n FROM clients WHERE id = ?').bind(c.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('invoices billed to a saved client (clientId)', () => {
  const SETTINGS = { fromName: 'Studio', fromEmail: '', fromAddress: '', paymentDetails: 'IBAN', notes: '', taxRate: 19, currency: 'USD' };

  async function withClient(extra: Record<string, unknown> = {}) {
    const w = await freshWorkspace();
    await w.client.put('/api/v1/settings', SETTINGS, w.token);
    const c = (await w.client.post('/api/v1/clients', { ...GLOBEX, ...extra }, w.token)).json.client;
    return { ...w, c };
  }

  it('fills to-fields from the client and currency/tax/due date from its defaults before settings', async () => {
    const { client, token, c } = await withClient({ defaultCurrency: 'EUR', defaultTaxRate: 7, paymentTermsDays: 30 });
    const res = await client.post('/api/v1/invoices', { clientId: c.id, issueDate: '2026-11-17', lineItems: [{ description: 'Consulting', quantity: 10, price: 100 }] }, token);
    expect(res.status).toBe(201);
    expect(res.json.invoice).toMatchObject({
      clientId: c.id,
      toName: GLOBEX.name,
      toAddress: GLOBEX.address,
      toEmail: GLOBEX.email,
      currency: 'EUR',
      taxRate: 7,
      dueDate: '2026-12-17',
      fromName: 'Studio',
      paymentDetails: 'IBAN',
      total: 1070,
    });
    expect((await client.get(`/api/v1/clients/${c.id}`, token)).json.client.invoiceCount).toBe(1);
  });

  it('explicit fields win over the client; the client wins over settings; settings fill the rest', async () => {
    const { client, token, c } = await withClient({ defaultTaxRate: 0 });
    const res = await client.post(
      '/api/v1/invoices',
      { clientId: c.id, toName: 'Globex EMEA', toEmail: '', currency: 'GBP', dueDate: '', lineItems: sampleInvoice().lineItems },
      token,
    );
    expect(res.json.invoice).toMatchObject({ toName: 'Globex EMEA', toEmail: '', toAddress: GLOBEX.address, currency: 'GBP', taxRate: 0, dueDate: '' });
    // A client without defaults: settings apply.
    const plain = (await client.post('/api/v1/clients', { name: 'Plain' }, token)).json.client;
    const res2 = await client.post('/api/v1/invoices', { clientId: plain.id, lineItems: sampleInvoice().lineItems }, token);
    expect(res2.json.invoice).toMatchObject({ toName: 'Plain', currency: 'USD', taxRate: 19, dueDate: '' });
  });

  it('snapshots: editing or deleting the client never rewrites the invoice', async () => {
    const { client, token, c } = await withClient();
    const inv = (await client.post('/api/v1/invoices', { clientId: c.id, lineItems: sampleInvoice().lineItems }, token)).json.invoice;
    await client.patch(`/api/v1/clients/${c.id}`, { address: 'New address' }, token);
    expect((await client.get(`/api/v1/invoices/${inv.id}`, token)).json.invoice).toMatchObject({ toAddress: GLOBEX.address, revision: 1 });
    await client.del(`/api/v1/clients/${c.id}`, token);
    // The unchanged reference stays valid: the invoice can still be edited (PATCH and full PUT).
    const edited = await client.patch(`/api/v1/invoices/${inv.id}`, { notes: 'still fine' }, token);
    expect(edited.status).toBe(200);
    expect(edited.json.invoice).toMatchObject({ clientId: c.id, toAddress: GLOBEX.address });
    const { subtotal: _s, taxAmount: _t, total: _total, ...body } = edited.json.invoice;
    expect((await client.put(`/api/v1/invoices/${inv.id}`, body, token)).status).toBe(200);
    // But a deleted client cannot be newly referenced.
    const fresh = await client.post('/api/v1/invoices', { clientId: c.id, lineItems: sampleInvoice().lineItems }, token);
    expect(fresh.status).toBe(400);
    expect(fresh.json.error.details[0]).toMatchObject({ path: 'clientId', message: expect.stringContaining('deleted') });
  });

  it('PATCH to another client refills omitted to-fields only; null unlinks', async () => {
    const { client, token, c } = await withClient({ defaultCurrency: 'EUR' });
    const other = (await client.post('/api/v1/clients', { name: 'Initech', address: 'Austin', email: 'ap@initech.example', defaultCurrency: 'JPY' }, token)).json.client;
    const inv = (await client.post('/api/v1/invoices', { clientId: c.id, lineItems: sampleInvoice().lineItems }, token)).json.invoice;
    expect(inv.currency).toBe('EUR');
    const moved = (await client.patch(`/api/v1/invoices/${inv.id}`, { clientId: other.id, toEmail: 'custom@initech.example' }, token)).json.invoice;
    expect(moved).toMatchObject({ clientId: other.id, toName: 'Initech', toAddress: 'Austin', toEmail: 'custom@initech.example', currency: 'EUR' });
    const unlinked = (await client.patch(`/api/v1/invoices/${inv.id}`, { clientId: null }, token)).json.invoice;
    expect(unlinked).not.toHaveProperty('clientId');
    expect(unlinked.toName).toBe('Initech');
    expect((await client.patch(`/api/v1/invoices/${inv.id}`, { clientId: uuid(77) }, token)).status).toBe(400);
  });

  it('without clientId or toName the invoice is rejected with a clear error; malformed ids are 400', async () => {
    const { client, token } = await withClient();
    const res = await client.post('/api/v1/invoices', { lineItems: sampleInvoice().lineItems }, token);
    expect(res.status).toBe(400);
    expect(res.json.error.details).toEqual(expect.arrayContaining([{ path: 'toName', message: 'Client name/company is required' }]));
    const bad = await client.post('/api/v1/invoices', { clientId: 'globex', lineItems: sampleInvoice().lineItems }, token);
    expect(bad.status).toBe(400);
    expect(bad.json.error.details[0].path).toBe('clientId');
    // Invoices without clientId are unchanged by this feature.
    const plain = await client.post('/api/v1/invoices', sampleInvoice(), token);
    expect(plain.status).toBe(201);
    expect(plain.json.invoice).not.toHaveProperty('clientId');
  });

  it('PUT with a new invoice id references a client uploaded first (browser sync order)', async () => {
    const { client, token } = await withClient();
    const clientId = uuid(10);
    const invoiceId = uuid(11);
    const early = await client.put(`/api/v1/invoices/${invoiceId}`, { ...sampleInvoice(), clientId }, token, { 'if-none-match': '*' });
    expect(early.status).toBe(400);
    expect((await client.put(`/api/v1/clients/${clientId}`, GLOBEX, token, { 'if-none-match': '*' })).status).toBe(201);
    const ok = await client.put(`/api/v1/invoices/${invoiceId}`, { ...sampleInvoice(), clientId }, token, { 'if-none-match': '*' });
    expect(ok.status).toBe(201);
    expect(ok.json.invoice).toMatchObject({ clientId, toName: 'Acme Corp' });
  });
});

describe('MCP client tools', () => {
  async function mcpClient(app: ReturnType<typeof buildApp>['app'], token: string) {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'clients-test', version: '1.0.0' });
    await c.connect(transport);
    return c;
  }
  const parse = (result: { content?: unknown }) => JSON.parse((result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!.text!);

  it('lists only the client tools the scopes allow, with annotations', async () => {
    const { app, client, token } = await freshWorkspace();
    const scopesFor = async (scopes: Scope[]) => {
      const { api_key } = await connectAgent(client, token, scopes);
      const mcp = await mcpClient(app, api_key);
      const tools = (await mcp.listTools()).tools;
      await mcp.close();
      return tools;
    };
    expect((await scopesFor(['invoices:read'])).map((t) => t.name)).not.toContain('list_clients');
    const read = await scopesFor(['clients:read']);
    expect(read.map((t) => t.name).sort()).toEqual(['get_client', 'list_clients']);
    expect(read.find((t) => t.name === 'list_clients')!.annotations).toMatchObject({ readOnlyHint: true });
    const write = await scopesFor(['clients:write']);
    expect(write.map((t) => t.name).sort()).toEqual(['create_client', 'delete_client', 'update_client']);
    expect(write.find((t) => t.name === 'delete_client')!.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(write.find((t) => t.name === 'create_client')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const all = await scopesFor(['invoices:write', 'clients:read']);
    const create = all.find((t) => t.name === 'create_invoice')!;
    expect(create.description).toMatch(/look it up with list_clients first/);
    expect(JSON.stringify(create.inputSchema)).toContain('never invent an address');
  });

  it('an agent finds a client, bills it by clientId, then updates and deletes it', async () => {
    const { app, client, token } = await freshWorkspace();
    await client.put('/api/v1/settings', { fromName: 'Studio', fromEmail: '', fromAddress: '', paymentDetails: '', notes: '', taxRate: 0, currency: 'USD' }, token);
    const { api_key } = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'clients:read', 'clients:write']);
    const mcp = await mcpClient(app, api_key);

    const created = parse(await mcp.callTool({ name: 'create_client', arguments: { ...GLOBEX, defaultCurrency: 'EUR', paymentTermsDays: 14 } })).client;
    expect(created).toMatchObject({ name: GLOBEX.name, createdBy: { type: 'agent' } });
    const found = parse(await mcp.callTool({ name: 'list_clients', arguments: { query: 'globex' } }));
    expect(found.clients.map((c: { id: string }) => c.id)).toEqual([created.id]);
    expect(parse(await mcp.callTool({ name: 'get_client', arguments: { id: created.id } })).client.email).toBe(GLOBEX.email);

    const inv = await mcp.callTool({
      name: 'create_invoice',
      arguments: { clientId: created.id, issueDate: '2026-11-17', lineItems: [{ description: 'Consulting', quantity: 10, price: 120 }] },
    });
    expect(inv.isError).toBeFalsy();
    expect(parse(inv).invoice).toMatchObject({ clientId: created.id, toName: GLOBEX.name, toAddress: GLOBEX.address, currency: 'EUR', dueDate: '2026-12-01', total: 1200 });

    const unknown = await mcp.callTool({ name: 'create_invoice', arguments: { clientId: uuid(5), lineItems: [{ description: 'x', quantity: 1, price: 1 }] } });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown).error.details[0].path).toBe('clientId');

    const updated = parse(await mcp.callTool({ name: 'update_client', arguments: { id: created.id, notes: 'VIP', expected_revision: 1 } })).client;
    expect(updated).toMatchObject({ notes: 'VIP', revision: 2, invoiceCount: 1 });
    const stale = await mcp.callTool({ name: 'update_client', arguments: { id: created.id, notes: 'x', expected_revision: 1 } });
    expect(parse(stale).error.code).toBe('precondition_failed');
    expect(parse(await mcp.callTool({ name: 'delete_client', arguments: { id: created.id } }))).toEqual({ deleted: true, id: created.id });
    expect(parse(await mcp.callTool({ name: 'get_client', arguments: { id: created.id } })).error.code).toBe('gone');
    await mcp.close();
  });
});

describe('invoices by saved client and status (both features together)', () => {
  it('GET /invoices?client_id= filters by the exact reference and combines with status filters', async () => {
    const { client, token } = await freshWorkspace();
    const globex = (await client.post('/api/v1/clients', GLOBEX, token)).json.client;
    const initech = (await client.post('/api/v1/clients', { name: 'Initech' }, token)).json.client;
    const lineItems = sampleInvoice().lineItems;
    const a = (await client.post('/api/v1/invoices', { clientId: globex.id, fromName: 'S', lineItems }, token)).json.invoice;
    const b = (await client.post('/api/v1/invoices', { clientId: globex.id, fromName: 'S', lineItems, status: 'sent' }, token)).json.invoice;
    // Same name typed by hand but not linked: not part of client_id results.
    await client.post('/api/v1/invoices', { toName: GLOBEX.name, fromName: 'S', lineItems }, token);
    await client.post('/api/v1/invoices', { clientId: initech.id, fromName: 'S', lineItems }, token);

    const ids = async (qs: string) => ((await client.get(`/api/v1/invoices?${qs}`, token)).json.invoices as { id: string }[]).map((i) => i.id).sort();
    expect(await ids(`client_id=${globex.id}`)).toEqual([a.id, b.id].sort());
    expect(await ids(`client_id=${globex.id.toUpperCase()}`)).toEqual([a.id, b.id].sort());
    expect(await ids(`client_id=${globex.id}&status=sent`)).toEqual([b.id]);
    expect(await ids(`client_id=${uuid(404)}`)).toEqual([]);
    expect((await client.get('/api/v1/invoices?client_id=globex', token)).status).toBe(400);
    // Status changes keep the client reference.
    const paid = await client.post(`/api/v1/invoices/${b.id}/mark-paid`, {}, token);
    expect(paid.json.invoice).toMatchObject({ status: 'paid', clientId: globex.id });
    expect((await client.get(`/api/v1/clients/${globex.id}`, token)).json.client.invoiceCount).toBe(2);
  });

  it('an agent bills a saved client over MCP, filters list_invoices by client_id and marks the invoice sent and paid', async () => {
    const { app, client, token } = await freshWorkspace();
    await client.put('/api/v1/settings', { fromName: 'Studio', fromEmail: '', fromAddress: '', paymentDetails: '', notes: '', taxRate: 0, currency: 'USD' }, token);
    const c = (await client.post('/api/v1/clients', { ...GLOBEX, paymentTermsDays: 30 }, token)).json.client;
    await client.post('/api/v1/invoices', sampleInvoice(), token);
    const { api_key } = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'clients:read']);
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${api_key}` } },
    });
    const mcp = new Client({ name: 'clients-status-test', version: '1.0.0' });
    await mcp.connect(transport);
    const parse = (r: { content?: unknown }) => JSON.parse((r.content as { type: string; text?: string }[]).find((x) => x.type === 'text')!.text!);

    const inv = parse(await mcp.callTool({ name: 'create_invoice', arguments: { clientId: c.id, lineItems: [{ description: 'Hours', quantity: 10, price: 100 }] } })).invoice;
    expect(inv).toMatchObject({ clientId: c.id, toName: GLOBEX.name, status: 'draft' });
    const listed = parse(await mcp.callTool({ name: 'list_invoices', arguments: { client_id: c.id } }));
    expect(listed.invoices.map((i: { id: string }) => i.id)).toEqual([inv.id]);
    expect(parse(await mcp.callTool({ name: 'set_invoice_status', arguments: { id: inv.id, status: 'sent' } })).invoice.status).toBe('sent');
    const paid = parse(await mcp.callTool({ name: 'set_invoice_status', arguments: { id: inv.id, status: 'paid' } })).invoice;
    expect(paid).toMatchObject({ status: 'paid', clientId: c.id, toAddress: GLOBEX.address });
    expect(parse(await mcp.callTool({ name: 'list_invoices', arguments: { client_id: c.id, status: ['sent'] } })).invoices).toEqual([]);
    await mcp.close();
  });
});
