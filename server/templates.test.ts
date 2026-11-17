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
  const clock = new TestClock(new Date('2026-03-05T10:00:00.000Z'));
  const { app } = buildApp(d1.db, { clock: clock.fn });
  return { app, client: api(app) };
}

async function freshWorkspace() {
  const { app, client } = setup();
  const ws = await createWorkspace(client);
  return { app, client, token: ws.token };
}

const SETTINGS = { fromName: 'Studio', fromEmail: 'me@studio.example', fromAddress: 'Studio St 1', paymentDetails: 'IBAN DE00', notes: 'Settings notes', taxRate: 19, currency: 'USD' };
const RETAINER = {
  name: 'Monthly retainer',
  description: 'Design retainer, billed on the 1st',
  lineItems: [
    { description: 'Retainer {{prev_month_name}} {{prev_month_year}}', quantity: 1, price: 2000 },
    { description: 'Hosting {{quarter}}/{{year}}', quantity: 1, price: 50 },
  ],
  notes: 'Invoice {{invoice_number}} for {{client_name}}',
  invoiceNamePattern: 'Retainer {{month_name}} {{year}}',
  paymentTermsDays: 14,
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('templates CRUD', () => {
  it('creates, reads, replaces, patches and soft-deletes with revisions and ETags', async () => {
    const { client, token } = await freshWorkspace();
    const created = await client.post('/api/v1/templates', RETAINER, token);
    expect(created.status).toBe(201);
    const t = created.json.template;
    expect(created.headers.get('etag')).toBe('"1"');
    expect(created.headers.get('location')).toBe(`/api/v1/templates/${t.id}`);
    expect(t).toMatchObject({
      name: RETAINER.name,
      description: RETAINER.description,
      clientId: null,
      taxRate: null,
      currency: null,
      paymentDetails: '',
      paymentTermsDays: 14,
      archivedAt: null,
      revision: 1,
      deletedAt: null,
      createdBy: { type: 'user' },
    });
    expect(t.lineItems).toHaveLength(2);
    expect(t.lineItems[0]).toMatchObject({ id: expect.any(String), description: RETAINER.lineItems[0].description, quantity: 1, price: 2000 });
    expect((await client.get(`/api/v1/templates/${t.id}`, token)).json.template).toEqual(t);

    const patched = await client.patch(`/api/v1/templates/${t.id}`, { taxRate: 7, lineItems: [{ description: 'Only line', quantity: 2, price: 10 }] }, token, { 'if-match': '"1"' });
    expect(patched.status).toBe(200);
    expect(patched.json.template).toMatchObject({ taxRate: 7, revision: 2, notes: RETAINER.notes });
    expect(patched.json.template.lineItems.map((l: { description: string }) => l.description)).toEqual(['Only line']);
    const stale = await client.patch(`/api/v1/templates/${t.id}`, { taxRate: 8 }, token, { 'if-match': '"1"' });
    expect(stale.status).toBe(412);
    expect(stale.json.error.details.currentRevision).toBe(2);

    const archived = await client.patch(`/api/v1/templates/${t.id}`, { archivedAt: '2026-03-05T12:00:00+01:00' }, token);
    expect(archived.json.template.archivedAt).toBe('2026-03-05T11:00:00.000Z');

    const replaced = await client.put(`/api/v1/templates/${t.id}`, { name: 'Bare' }, token, { 'if-match': '"3"' });
    expect(replaced.status).toBe(200);
    expect(replaced.json.template).toMatchObject({ name: 'Bare', lineItems: [], notes: '', paymentTermsDays: null, archivedAt: null, revision: 4, createdAt: t.createdAt });

    expect((await client.del(`/api/v1/templates/${t.id}`, token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.del(`/api/v1/templates/${t.id}`, token)).status).toBe(204);
    expect((await client.del(`/api/v1/templates/${t.id}`, token)).status).toBe(204);
    expect((await client.get(`/api/v1/templates/${t.id}`, token)).status).toBe(410);
    expect((await client.put(`/api/v1/templates/${t.id}`, { name: 'x' }, token)).status).toBe(410);
    expect((await client.patch(`/api/v1/templates/${t.id}`, { name: 'x' }, token)).status).toBe(410);
    expect((await client.post(`/api/v1/templates/${t.id}/instantiate`, {}, token)).status).toBe(410);
    expect((await client.get(`/api/v1/templates/${uuid(99)}`, token)).status).toBe(404);
    expect((await client.get('/api/v1/templates/not-a-uuid', token)).status).toBe(400);
  });

  it('PUT creates with a client-chosen id (If-None-Match: * = create only) and keeps createdAt and line ids', async () => {
    const { client, token } = await freshWorkspace();
    const id = uuid(1);
    const res = await client.put(
      `/api/v1/templates/${id}`,
      { name: 'Synced', lineItems: [{ id: 'line-a', description: 'A', quantity: 1, price: 1 }], createdAt: '2026-01-02T03:04:05.000Z' },
      token,
      { 'if-none-match': '*' },
    );
    expect(res.status).toBe(201);
    expect(res.json.template).toMatchObject({ id, createdAt: '2026-01-02T03:04:05.000Z', revision: 1, lineItems: [{ id: 'line-a' }] });
    expect((await client.put(`/api/v1/templates/${id}`, { name: 'x' }, token, { 'if-none-match': '*' })).status).toBe(412);
    expect((await client.put(`/api/v1/templates/${uuid(2)}`, { name: 'x' }, token, { 'if-match': '"1"' })).status).toBe(412);
    expect((await client.put(`/api/v1/templates/${id}`, { name: 'x', id: uuid(3) }, token)).status).toBe(400);
  });

  it('validates input', async () => {
    const { client, token } = await freshWorkspace();
    const bad = await client.post(
      '/api/v1/templates',
      { name: ' ', currency: 'XXX', taxRate: 101, paymentTermsDays: 1.5, clientId: 'globex', lineItems: [{ description: '', quantity: -1, price: 1 }] },
      token,
    );
    expect(bad.status).toBe(400);
    expect(bad.json.error.details.map((d: { path: string }) => d.path).sort()).toEqual(
      ['clientId', 'currency', 'lineItems.0.description', 'lineItems.0.quantity', 'name', 'paymentTermsDays', 'taxRate'].sort(),
    );
    const dupLines = await client.post('/api/v1/templates', { name: 'x', lineItems: [{ id: 'a', description: 'A', quantity: 1, price: 1 }, { id: 'a', description: 'B', quantity: 1, price: 1 }] }, token);
    expect(dupLines.status).toBe(400);
    const unknownClient = await client.post('/api/v1/templates', { name: 'x', clientId: uuid(5) }, token);
    expect(unknownClient.status).toBe(400);
    expect(unknownClient.json.error.details[0].path).toBe('clientId');
  });

  it('lists as a sync feed and searches name or description', async () => {
    const { client, token } = await freshWorkspace();
    const ids: string[] = [];
    for (const t of [RETAINER, { name: 'Hourly consulting' }, { name: 'Workshop', description: 'Half-day RETAINER add-on' }, { name: '100% off' }]) {
      ids.push((await client.post('/api/v1/templates', t, token)).json.template.id);
    }
    const names = async (q: string) =>
      ((await client.get(`/api/v1/templates?q=${encodeURIComponent(q)}`, token)).json.templates as { name: string }[]).map((t) => t.name).sort();
    expect(await names('retainer')).toEqual(['Monthly retainer', 'Workshop']);
    expect(await names('%')).toEqual(['100% off']);
    expect(await names('_')).toEqual([]);

    const first = await client.get('/api/v1/templates?limit=3', token);
    expect(first.json.hasMore).toBe(true);
    const { updated_since, after_id } = first.json.next;
    const second = await client.get(`/api/v1/templates?limit=3&updated_since=${encodeURIComponent(updated_since)}&after_id=${after_id}`, token);
    expect([...first.json.templates, ...second.json.templates].map((t: { id: string }) => t.id).sort()).toEqual([...ids].sort());
    const cursor = second.json.syncedAt;
    await client.del(`/api/v1/templates/${ids[0]}`, token);
    expect((await client.get(`/api/v1/templates?updated_since=${encodeURIComponent(cursor)}`, token)).json.templates).toEqual([]);
    const delta = await client.get(`/api/v1/templates?include_deleted=true&updated_since=${encodeURIComponent(cursor)}`, token);
    expect(delta.json.templates).toHaveLength(1);
    expect(delta.json.templates[0]).toMatchObject({ id: ids[0], revision: 2, deletedAt: expect.any(String) });
  });
});

describe('creating an invoice from a template (instantiate)', () => {
  async function withSettings() {
    const w = await freshWorkspace();
    await w.client.put('/api/v1/settings', SETTINGS, w.token);
    return w;
  }

  it('resolves placeholders against the issue date and fills from settings; the invoice is a draft snapshot', async () => {
    const { client, token } = await withSettings();
    const t = (await client.post('/api/v1/templates', RETAINER, token)).json.template;
    const res = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: 'Acme Corp', issueDate: '2026-01-10' }, token);
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/api/v1/invoices/${res.json.invoice.id}`);
    const inv = res.json.invoice;
    expect(inv).toMatchObject({
      status: 'draft',
      templateId: t.id,
      invoiceNumber: 'INV-0001',
      invoiceName: 'Retainer January 2026',
      issueDate: '2026-01-10',
      dueDate: '2026-01-24',
      toName: 'Acme Corp',
      fromName: 'Studio',
      paymentDetails: 'IBAN DE00',
      taxRate: 19,
      currency: 'USD',
      notes: 'Invoice INV-0001 for Acme Corp',
      subtotal: 2050,
    });
    // Year rollover: the previous month of January is December of last year.
    expect(inv.lineItems.map((l: { description: string }) => l.description)).toEqual(['Retainer December 2025', 'Hosting Q1/2026']);
    // Fresh line ids (nothing shared with the template).
    expect(inv.lineItems.map((l: { id: string }) => l.id)).not.toContain(t.lineItems[0].id);
    expect(res.json).toMatchObject({ template: { id: t.id, name: t.name, revision: 1 }, placeholders: { unknown: [], unresolved: [] }, warnings: [] });

    // Snapshot: editing or deleting the template never changes the invoice.
    await client.patch(`/api/v1/templates/${t.id}`, { lineItems: [{ description: 'Changed', quantity: 1, price: 1 }] }, token);
    await client.del(`/api/v1/templates/${t.id}`, token);
    const after = (await client.get(`/api/v1/invoices/${inv.id}`, token)).json.invoice;
    expect(after).toMatchObject({ revision: 1, templateId: t.id, subtotal: 2050 });
    // ...and the invoice stays editable.
    expect((await client.patch(`/api/v1/invoices/${inv.id}`, { notes: 'edited' }, token)).status).toBe(200);
  });

  it('precedence: explicit request > template > client defaults > workspace settings', async () => {
    const { client, token } = await withSettings();
    const globex = (
      await client.post('/api/v1/clients', { name: 'Globex', address: '1 Globex Way', email: 'ap@globex.example', defaultCurrency: 'EUR', defaultTaxRate: 7, paymentTermsDays: 30 }, token)
    ).json.client;
    const initech = (await client.post('/api/v1/clients', { name: 'Initech', defaultCurrency: 'JPY', paymentTermsDays: 45 }, token)).json.client;

    // Template sets the client and the tax rate, not the currency or terms.
    const t = (await client.post('/api/v1/templates', { name: 'Globex work', clientId: globex.id, taxRate: 0, lineItems: [{ description: 'Work for {{client_name}}', quantity: 1, price: 100 }] }, token)).json
      .template;
    const plain = (await client.post(`/api/v1/templates/${t.id}/instantiate`, { issueDate: '2026-03-01' }, token)).json.invoice;
    expect(plain).toMatchObject({
      clientId: globex.id,
      toName: 'Globex', // client
      toAddress: '1 Globex Way',
      taxRate: 0, // template beats client (7) and settings (19)
      currency: 'EUR', // client beats settings
      dueDate: '2026-03-31', // client terms (template has none)
      paymentDetails: 'IBAN DE00', // settings
      notes: '', // template has none; invoices do not take settings notes
    });
    expect(plain.lineItems[0].description).toBe('Work for Globex');

    // Template terms beat client terms; explicit values beat everything.
    await client.patch(`/api/v1/templates/${t.id}`, { paymentTermsDays: 10, currency: 'GBP' }, token);
    const termed = (await client.post(`/api/v1/templates/${t.id}/instantiate`, { issueDate: '2026-03-01' }, token)).json.invoice;
    expect(termed).toMatchObject({ dueDate: '2026-03-11', currency: 'GBP' });
    const explicit = (
      await client.post(
        `/api/v1/templates/${t.id}/instantiate`,
        {
          issueDate: '2026-03-01',
          clientId: initech.id,
          taxRate: 5,
          currency: 'CHF',
          dueDate: '',
          invoiceNumber: 'X-1',
          notes: 'Typed {{month}}',
          lineItems: [{ description: 'Custom {{year}}', quantity: 3, price: 10 }],
        },
        token,
      )
    ).json;
    expect(explicit.invoice).toMatchObject({ clientId: initech.id, toName: 'Initech', taxRate: 5, currency: 'CHF', dueDate: '', invoiceNumber: 'X-1', notes: 'Typed {{month}}', subtotal: 30 });
    // Request values are used verbatim (no placeholders resolved, none reported).
    expect(explicit.invoice.lineItems.map((l: { description: string }) => l.description)).toEqual(['Custom {{year}}']);
    expect(explicit.placeholders).toEqual({ unknown: [], unresolved: [] });

    // clientId: null bills no saved client even though the template has one.
    const noClient = await client.post(`/api/v1/templates/${t.id}/instantiate`, { clientId: null, toName: 'Walk-in' }, token);
    expect(noClient.status).toBe(201);
    expect(noClient.json.invoice).not.toHaveProperty('clientId');
    expect(noClient.json.invoice.lineItems[0].description).toBe('Work for Walk-in');
  });

  it('reports unknown and unresolved placeholders, leaving them visible', async () => {
    const { client, token } = await withSettings();
    const t = (
      await client.post('/api/v1/templates', { name: 'Odd', lineItems: [{ description: 'For {{client_name}} in {{Month}} {{ year }} {{constructor}} {{a.b}}', quantity: 1, price: 1 }] }, token)
    ).json.template;
    const res = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: '  ', issueDate: '2026-05-02' }, token);
    // A blank Bill To name is no value for {{client_name}}: it stays visible and is reported.
    expect(res.status).toBe(201);
    expect(res.json.invoice.lineItems[0].description).toBe('For {{client_name}} in {{Month}} 2026 {{constructor}} {{a.b}}');
    expect(res.json.placeholders).toEqual({ unknown: ['Month', 'constructor', 'a.b'], unresolved: ['client_name'] });
  });

  it('a deleted default client is skipped with a warning; an explicit unknown client is a 400; empty templates need lineItems', async () => {
    const { client, token } = await withSettings();
    const c = (await client.post('/api/v1/clients', { name: 'Gone Inc' }, token)).json.client;
    const t = (await client.post('/api/v1/templates', { name: 'T', clientId: c.id, lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, token)).json.template;
    await client.del(`/api/v1/clients/${c.id}`, token);
    // The template stays editable with its (unchanged) reference.
    expect((await client.patch(`/api/v1/templates/${t.id}`, { notes: 'n' }, token)).status).toBe(200);
    const res = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: 'Someone' }, token);
    expect(res.status).toBe(201);
    expect(res.json.invoice).not.toHaveProperty('clientId');
    expect(res.json.warnings).toEqual([expect.stringContaining('no longer exists')]);
    const bad = await client.post(`/api/v1/templates/${t.id}/instantiate`, { clientId: uuid(42) }, token);
    expect(bad.status).toBe(400);
    expect(bad.json.error.details[0].path).toBe('clientId');

    const empty = (await client.post('/api/v1/templates', { name: 'Empty' }, token)).json.template;
    const noLines = await client.post(`/api/v1/templates/${empty.id}/instantiate`, { toName: 'A' }, token);
    expect(noLines.status).toBe(400);
    expect(noLines.json.error.details[0]).toMatchObject({ path: 'lineItems' });
    expect((await client.post(`/api/v1/templates/${empty.id}/instantiate`, { toName: 'A', lineItems: [{ description: 'L', quantity: 1, price: 1 }] }, token)).status).toBe(201);
  });

  it('invoices accept templateId as a reference only (PUT for sync, PATCH null clears it)', async () => {
    const { client, token } = await withSettings();
    const res = await client.post('/api/v1/invoices', { ...sampleInvoice(), templateId: uuid(7) }, token);
    expect(res.status).toBe(201);
    expect(res.json.invoice.templateId).toBe(uuid(7));
    const cleared = await client.patch(`/api/v1/invoices/${res.json.invoice.id}`, { templateId: null }, token);
    expect(cleared.json.invoice).not.toHaveProperty('templateId');
    expect((await client.post('/api/v1/invoices', { ...sampleInvoice(), templateId: 'nope' }, token)).status).toBe(400);
  });
});

describe('template scopes and isolation', () => {
  it('requires templates:read / templates:write; instantiate needs invoices:write + templates:read; existing agents keep their scopes', async () => {
    const { client, token } = await freshWorkspace();
    await client.put('/api/v1/settings', SETTINGS, token);
    const t = (await client.post('/api/v1/templates', RETAINER, token)).json.template;

    const old = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'clients:read', 'clients:write']);
    expect((await client.get('/api/v1/agents/me', old.api_key)).json.agent.scopes).toEqual(['invoices:read', 'invoices:write', 'clients:read', 'clients:write']);
    const denied = await client.get('/api/v1/templates', old.api_key);
    expect(denied.status).toBe(403);
    expect(denied.json.error.details.requiredScope).toBe('templates:read');
    const noRead = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: 'A' }, old.api_key);
    expect(noRead.status).toBe(403);
    expect(noRead.json.error.details.requiredScope).toBe('templates:read');

    const reader = await connectAgent(client, token, ['templates:read']);
    expect((await client.get('/api/v1/templates', reader.api_key)).json.templates).toHaveLength(1);
    expect((await client.post('/api/v1/templates', { name: 'x' }, reader.api_key)).status).toBe(403);
    const noWrite = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: 'A' }, reader.api_key);
    expect(noWrite.status).toBe(403);
    expect(noWrite.json.error.details.requiredScope).toBe('invoices:write');

    const writer = await connectAgent(client, token, ['templates:write']);
    expect((await client.get(`/api/v1/templates/${t.id}`, writer.api_key)).status).toBe(403);
    const made = await client.post('/api/v1/templates', { name: 'Agent template' }, writer.api_key);
    expect(made.status).toBe(201);
    expect(made.json.template.createdBy).toMatchObject({ type: 'agent', agentId: writer.agent.id });
    // Setting a default client needs clients:read.
    const c = (await client.post('/api/v1/clients', { name: 'Globex' }, token)).json.client;
    const ref = await client.patch(`/api/v1/templates/${made.json.template.id}`, { clientId: c.id }, writer.api_key);
    expect(ref.status).toBe(403);
    expect(ref.json.error.details.requiredScope).toBe('clients:read');
    expect((await client.del(`/api/v1/templates/${made.json.template.id}`, writer.api_key)).status).toBe(204);

    // invoices:write + templates:read without invoices:read: {{invoice_number}} stays, with a warning.
    const maker = await connectAgent(client, token, ['invoices:write', 'templates:read']);
    const res = await client.post(`/api/v1/templates/${t.id}/instantiate`, { toName: 'Acme' }, maker.api_key);
    expect(res.status).toBe(201);
    expect(res.json.invoice.createdBy).toMatchObject({ type: 'agent', agentId: maker.agent.id });
    expect(res.json.invoice.notes).toBe('Invoice {{invoice_number}} for Acme');
    expect(res.json.warnings).toEqual([expect.stringContaining('invoices:read')]);
  });

  it('workspace A can neither read, change, instantiate nor reference workspace B’s templates or clients', async () => {
    const { client } = setup();
    const a = await createWorkspace(client);
    const b = await createWorkspace(client);
    const bTemplate = (await client.post('/api/v1/templates', RETAINER, b.token)).json.template;
    expect((await client.get(`/api/v1/templates/${bTemplate.id}`, a.token)).status).toBe(404);
    expect((await client.get('/api/v1/templates', a.token)).json.templates).toEqual([]);
    expect((await client.get('/api/v1/templates?q=retainer', a.token)).json.templates).toEqual([]);
    expect((await client.patch(`/api/v1/templates/${bTemplate.id}`, { name: 'Hijack' }, a.token)).status).toBe(404);
    expect((await client.del(`/api/v1/templates/${bTemplate.id}`, a.token)).status).toBe(404);
    expect((await client.post(`/api/v1/templates/${bTemplate.id}/instantiate`, { toName: 'x' }, a.token)).status).toBe(404);
    expect((await client.put(`/api/v1/templates/${bTemplate.id}`, { name: 'A’s own' }, a.token)).status).toBe(201);
    expect((await client.get(`/api/v1/templates/${bTemplate.id}`, b.token)).json.template.name).toBe(RETAINER.name);
    const bClient = (await client.post('/api/v1/clients', { name: 'Only in B' }, b.token)).json.client;
    const ref = await client.post('/api/v1/templates', { name: 'x', clientId: bClient.id }, a.token);
    expect(ref.status).toBe(400);
  });

  it('deleting the workspace deletes its templates', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const t = (await client.post('/api/v1/templates', RETAINER, ws.token)).json.template;
    expect((await client.del('/api/v1/workspace', ws.token)).status).toBe(204);
    const row = await d1.db.prepare('SELECT COUNT(*) AS n FROM templates WHERE id = ?').bind(t.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('MCP template tools', () => {
  async function mcpClient(app: ReturnType<typeof buildApp>['app'], token: string) {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'templates-test', version: '1.0.0' });
    await c.connect(transport);
    return c;
  }
  const parse = (result: { content?: unknown }) => JSON.parse((result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!.text!);

  it('lists only the template tools the scopes allow, with annotations and steering descriptions', async () => {
    const { app, client, token } = await freshWorkspace();
    const toolsFor = async (scopes: Scope[]) => {
      const { api_key } = await connectAgent(client, token, scopes);
      const mcp = await mcpClient(app, api_key);
      const tools = (await mcp.listTools()).tools;
      await mcp.close();
      return tools;
    };
    const templateTools = (tools: { name: string }[]) => tools.map((t) => t.name).filter((n) => n.includes('template')).sort();
    expect(templateTools(await toolsFor(['invoices:read', 'invoices:write', 'clients:read']))).toEqual([]);
    const read = await toolsFor(['templates:read']);
    expect(templateTools(read)).toEqual(['get_template', 'list_templates']);
    expect(read.find((t) => t.name === 'list_templates')!.description).toMatch(/create_invoice_from_template instead of building the invoice by hand/);
    expect(read.find((t) => t.name === 'list_templates')!.annotations).toMatchObject({ readOnlyHint: true });
    const write = await toolsFor(['templates:write']);
    expect(templateTools(write)).toEqual(['create_template', 'delete_template', 'update_template']);
    expect(write.find((t) => t.name === 'delete_template')!.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
    const both = await toolsFor(['templates:read', 'invoices:write']);
    const inst = both.find((t) => t.name === 'create_invoice_from_template')!;
    expect(inst.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(inst.description).toMatch(/preferred way/);
    expect(inst.description).toMatch(/Requires scope invoices:write/);
    // create_invoice does not offer templateId (that would not apply a template).
    expect(JSON.stringify(both.find((t) => t.name === 'create_invoice')!.inputSchema)).not.toContain('templateId');
  });

  it('an agent creates a template, finds it and creates an invoice from it', async () => {
    const { app, client, token } = await freshWorkspace();
    await client.put('/api/v1/settings', SETTINGS, token);
    const globex = (await client.post('/api/v1/clients', { name: 'Globex', defaultCurrency: 'EUR' }, token)).json.client;
    const { api_key } = await connectAgent(client, token, ['invoices:read', 'invoices:write', 'clients:read', 'templates:read', 'templates:write']);
    const mcp = await mcpClient(app, api_key);

    const created = parse(await mcp.callTool({ name: 'create_template', arguments: { ...RETAINER, clientId: globex.id } })).template;
    expect(created).toMatchObject({ name: RETAINER.name, clientId: globex.id, createdBy: { type: 'agent' } });
    const found = parse(await mcp.callTool({ name: 'list_templates', arguments: { query: 'retainer' } }));
    expect(found.templates.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(parse(await mcp.callTool({ name: 'get_template', arguments: { id: created.id } })).template.name).toBe(RETAINER.name);

    const res = await mcp.callTool({ name: 'create_invoice_from_template', arguments: { id: created.id, issueDate: '2026-11-01' } });
    expect(res.isError).toBeFalsy();
    const out = parse(res);
    expect(out.invoice).toMatchObject({
      status: 'draft',
      templateId: created.id,
      clientId: globex.id,
      toName: 'Globex',
      currency: 'EUR',
      invoiceName: 'Retainer November 2026',
      dueDate: '2026-11-15',
      createdBy: { type: 'agent' },
    });
    expect(out.invoice.lineItems[0].description).toBe('Retainer October 2026');
    expect(out.invoice.notes).toBe(`Invoice ${out.invoice.invoiceNumber} for Globex`);

    const updated = parse(await mcp.callTool({ name: 'update_template', arguments: { id: created.id, taxRate: 0, expected_revision: 1 } })).template;
    expect(updated).toMatchObject({ taxRate: 0, revision: 2 });
    const stale = await mcp.callTool({ name: 'update_template', arguments: { id: created.id, taxRate: 1, expected_revision: 1 } });
    expect(parse(stale).error.code).toBe('precondition_failed');
    expect(parse(await mcp.callTool({ name: 'delete_template', arguments: { id: created.id } }))).toEqual({ deleted: true, id: created.id });
    expect(parse(await mcp.callTool({ name: 'create_invoice_from_template', arguments: { id: created.id } })).error.code).toBe('gone');
    await mcp.close();
  });
});
