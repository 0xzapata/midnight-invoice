import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Scope } from '../shared/api';
import { api, BASE, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1 } from './test/helpers';
import { extractPdfText } from './test/pdf-text';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const ALL: Scope[] = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'];

type Mode = 'legacy' | 'modern';

async function mcpClient(app: ReturnType<typeof buildApp>['app'], token: string, mode: Mode = 'legacy') {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: 'midnight-invoice-test', version: '1.0.0' },
    mode === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  await client.connect(transport);
  return client;
}

function setup() {
  const built = buildApp(d1.db);
  return { app: built.app, client: api(built.app), errors: built.errors };
}

function parse(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find((c) => c.type === 'text')!.text!);
}

describe.each<Mode>(['legacy', 'modern'])('MCP over Streamable HTTP (%s protocol)', (mode) => {
  it('initializes and lists exactly the tools allowed by the scopes', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);

    const full = await mcpClient(app, ws.token, mode);
    expect(full.getServerVersion()).toMatchObject({ name: 'midnight-invoice' });
    const allTools = (await full.listTools()).tools;
    expect(allTools.map((t) => t.name).sort()).toEqual([
      'create_client',
      'create_invoice',
      'delete_client',
      'delete_invoice',
      'get_client',
      'get_invoice',
      'get_invoice_pdf',
      'get_invoice_summary',
      'get_my_activity',
      'get_next_invoice_number',
      'get_settings',
      'list_clients',
      'list_invoices',
      'send_invoice_email',
      'set_invoice_status',
      'update_client',
      'update_invoice',
    ]);
    const create = allTools.find((t) => t.name === 'create_invoice')!;
    expect(create.description).toMatch(/Requires scope invoices:write/);
    // toName may be omitted when clientId names a saved client (the server fills it).
    expect(create.inputSchema).toMatchObject({ type: 'object', required: ['lineItems'] });
    expect(Object.keys((create.inputSchema as { properties: object }).properties)).toEqual(expect.arrayContaining(['toName', 'clientId']));
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(allTools.find((t) => t.name === 'delete_invoice')!.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(allTools.find((t) => t.name === 'list_invoices')!.annotations).toMatchObject({ readOnlyHint: true });
    await full.close();

    const { api_key } = await connectAgent(client, ws.token, ['invoices:read']);
    const readOnly = await mcpClient(app, api_key, mode);
    expect((await readOnly.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'get_invoice',
      'get_invoice_pdf',
      'get_invoice_summary',
      'get_next_invoice_number',
      'list_invoices',
    ]);
    // A hidden tool is rejected on call.
    const rejected = await readOnly.callTool({ name: 'create_invoice', arguments: sampleInvoice() }).then(
      (r) => ({ ok: true as const, r }),
      (e: Error) => ({ ok: false as const, e }),
    );
    if (rejected.ok) expect(rejected.r.isError).toBe(true);
    else expect(rejected.e.message).toMatch(/create_invoice|not found|unknown/i);
    expect((await client.get('/api/v1/invoices', ws.token)).json.invoices).toEqual([]);
    await readOnly.close();
  });

  it('runs the invoice tools end to end as an agent', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    await client.put('/api/v1/settings', { fromName: 'Studio', fromEmail: 'a@b.co', fromAddress: 'Here', paymentDetails: 'IBAN 1', notes: '', taxRate: 10, currency: 'EUR' }, ws.token);
    const { api_key, agent } = await connectAgent(client, ws.token, ALL, undefined, 'MCP Agent');
    const mcp = await mcpClient(app, api_key, mode);

    expect(parse(await mcp.callTool({ name: 'get_next_invoice_number', arguments: {} }))).toEqual({ invoiceNumber: 'INV-0001' });
    expect(parse(await mcp.callTool({ name: 'get_settings', arguments: {} })).settings.currency).toBe('EUR');

    const created = await mcp.callTool({
      name: 'create_invoice',
      arguments: { toName: 'Globex', lineItems: [{ description: 'Widgets', quantity: 10, price: 9.5 }] },
    });
    expect(created.isError).toBeFalsy();
    const inv = parse(created).invoice;
    expect(inv).toMatchObject({ invoiceNumber: 'INV-0001', fromName: 'Studio', currency: 'EUR', subtotal: 95, taxAmount: 9.5, total: 104.5 });
    expect(inv.createdBy).toEqual({ type: 'agent', agentId: agent.id, agentName: 'MCP Agent' });
    expect((created as { structuredContent?: unknown }).structuredContent).toMatchObject({ invoice: { id: inv.id } });

    const updated = parse(await mcp.callTool({ name: 'update_invoice', arguments: { id: inv.id, notes: 'Thanks!', expected_revision: 1 } })).invoice;
    expect(updated).toMatchObject({ notes: 'Thanks!', revision: 2 });
    const stale = await mcp.callTool({ name: 'update_invoice', arguments: { id: inv.id, notes: 'stale', expected_revision: 1 } });
    expect(stale.isError).toBe(true);
    expect(parse(stale).error.code).toBe('precondition_failed');

    const invalid = await mcp.callTool({ name: 'create_invoice', arguments: { toName: 'X', lineItems: [{ description: 'Y', quantity: 1, price: 1 }], currency: 'NOPE' } });
    expect(invalid.isError).toBe(true);

    expect(parse(await mcp.callTool({ name: 'get_invoice', arguments: { id: inv.id } })).invoice.notes).toBe('Thanks!');
    expect(parse(await mcp.callTool({ name: 'list_invoices', arguments: {} })).invoices).toHaveLength(1);

    const pdf = await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: inv.id } });
    const resource = (pdf.content as { type: string; resource?: { uri: string; mimeType: string; blob: string } }[]).find((c) => c.type === 'resource')!.resource!;
    expect(resource.mimeType).toBe('application/pdf');
    expect(resource.uri).toBe(`${BASE}/api/v1/invoices/${inv.id}/pdf`);
    const bytes = Uint8Array.from(atob(resource.blob), (ch) => ch.charCodeAt(0));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(extractPdfText(bytes)).toContain('Globex');

    const lightPdf = await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: inv.id, theme: 'light' } });
    expect(lightPdf.isError).toBeFalsy();
    const light = (lightPdf.content as { type: string; resource?: { uri: string } }[]).find((c) => c.type === 'resource')!.resource!;
    expect(light.uri).toBe(`${BASE}/api/v1/invoices/${inv.id}/pdf?theme=light`);
    const badTheme = await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: inv.id, theme: 'sepia' } });
    expect(badTheme.isError).toBe(true);

    expect(parse(await mcp.callTool({ name: 'delete_invoice', arguments: { id: inv.id } }))).toEqual({ deleted: true, id: inv.id });
    const gone = await mcp.callTool({ name: 'get_invoice', arguments: { id: inv.id } });
    expect(gone.isError).toBe(true);
    expect(parse(gone).error.code).toBe('gone');
    await mcp.close();
  });

  it('a revoked key is rejected on the next request', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { api_key, agent } = await connectAgent(client, ws.token, ['invoices:read']);
    const mcp = await mcpClient(app, api_key, mode);
    await mcp.listTools();
    await client.del(`/api/v1/agents/${agent.id}`, ws.token);
    await expect(mcp.listTools()).rejects.toThrow();
  });
});

describe('MCP HTTP surface', () => {
  it('requires a bearer token (401 + WWW-Authenticate) and only accepts POST', async () => {
    const { app } = setup();
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '0' } } };
    const unauth = await app.request(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(init),
    });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toMatch(/^Bearer /);
    const get = await app.request(`${BASE}/api/mcp`, { method: 'GET' });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });

  it('answers plain JSON-RPC (no SSE) to a hand-written 2025-style client', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const post = (body: unknown) =>
      app.request(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ws.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      });
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '0' } } });
    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toMatch(/application\/json/);
    expect(init.headers.get('mcp-session-id')).toBeNull();
    const initBody = (await init.json()) as { result: { serverInfo: { name: string }; capabilities: { tools?: unknown } } };
    expect(initBody.result.serverInfo.name).toBe('midnight-invoice');
    expect(initBody.result.capabilities.tools).toBeDefined();
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const ping = await (await post({ jsonrpc: '2.0', id: 2, method: 'ping' })).json();
    expect(ping).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    const call = (await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_next_invoice_number', arguments: {} } })).json()) as {
      result: { content: { text: string }[] };
    };
    expect(JSON.parse(call.result.content[0].text)).toEqual({ invoiceNumber: 'INV-0001' });
  });
});
