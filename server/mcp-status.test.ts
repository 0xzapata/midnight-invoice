import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { api, BASE, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

async function mcpClient(app: ReturnType<typeof buildApp>['app'], token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'midnight-invoice-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  return client;
}

function parse(result: { content?: unknown }) {
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find((c) => c.type === 'text')!.text!);
}

async function setup() {
  const clock = new TestClock();
  const built = buildApp(d1.db, { clock: clock.fn });
  const client = api(built.app);
  const ws = await createWorkspace(client);
  const create = async (o: Record<string, unknown>) => (await client.post('/api/v1/invoices', sampleInvoice(o), ws.token)).json.invoice;
  return { app: built.app, client, ws, create };
}

describe('MCP status tools', () => {
  it('describes set_invoice_status and get_invoice_summary with scopes and annotations', async () => {
    const { app, client, ws } = await setup();
    const mcp = await mcpClient(app, ws.token);
    const tools = (await mcp.listTools()).tools;
    const set = tools.find((t) => t.name === 'set_invoice_status')!;
    expect(set.description).toMatch(/Requires scope invoices:write/);
    expect(set.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    expect(set.inputSchema).toMatchObject({
      required: expect.arrayContaining(['id', 'status']),
      properties: { status: { enum: ['draft', 'sent', 'paid', 'void'] } },
    });
    const summary = tools.find((t) => t.name === 'get_invoice_summary')!;
    expect(summary.description).toMatch(/Requires scope invoices:read/);
    expect(summary.annotations).toMatchObject({ readOnlyHint: true });
    const list = tools.find((t) => t.name === 'list_invoices')!;
    expect(Object.keys((list.inputSchema as { properties: object }).properties)).toEqual(
      expect.arrayContaining(['status', 'due_before', 'due_after', 'client']),
    );
    await mcp.close();

    // Scopes: a write-only agent cannot read the summary, a read-only one cannot change status.
    const writer = await connectAgent(client, ws.token, ['invoices:write']);
    const writerTools = (await (await mcpClient(app, writer.api_key)).listTools()).tools.map((t) => t.name);
    expect(writerTools).toContain('set_invoice_status');
    expect(writerTools).not.toContain('get_invoice_summary');
    const reader = await connectAgent(client, ws.token, ['invoices:read']);
    const readerMcp = await mcpClient(app, reader.api_key);
    expect((await readerMcp.listTools()).tools.map((t) => t.name)).not.toContain('set_invoice_status');
    const rejected = await readerMcp.callTool({ name: 'set_invoice_status', arguments: { id: 'x', status: 'paid' } }).then(
      (r) => r.isError === true,
      () => true,
    );
    expect(rejected).toBe(true);
  });

  it('lets an agent find overdue invoices, mark one paid and read the summary', async () => {
    const { app, client, ws, create } = await setup();
    const overdue = await create({ toName: 'Globex', status: 'sent', dueDate: '2026-11-01', currency: 'EUR' });
    await create({ toName: 'Initech', status: 'sent', dueDate: '2026-12-01', currency: 'EUR' });
    await create({ toName: 'Acme', currency: 'USD' });
    const agent = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write'], undefined, 'Bookkeeper');
    const mcp = await mcpClient(app, agent.api_key);

    const list = parse(await mcp.callTool({ name: 'list_invoices', arguments: { status: ['overdue'], client: 'glob' } }));
    expect(list.invoices.map((i: { id: string }) => i.id)).toEqual([overdue.id]);
    expect(list.invoices[0]).toMatchObject({ status: 'sent', isOverdue: true, daysOverdue: 16 });

    const before = parse(await mcp.callTool({ name: 'get_invoice_summary', arguments: {} }));
    expect(before.currencies.find((c: { currency: string }) => c.currency === 'EUR')).toMatchObject({
      overdue: { count: 1, total: 300 },
      outstanding: { count: 1, total: 300 },
    });
    expect(before.oldestOverdue[0]).toMatchObject({ id: overdue.id, daysOverdue: 16 });

    const paid = await mcp.callTool({ name: 'set_invoice_status', arguments: { id: overdue.id, status: 'paid', paid_at: '2026-11-16', expected_revision: 1 } });
    expect(paid.isError).toBeFalsy();
    expect(parse(paid)).toMatchObject({ changed: true, invoice: { status: 'paid', paidAt: '2026-11-16', revision: 2, updatedBy: { type: 'agent', agentName: 'Bookkeeper' } } });
    // Idempotent: same status again changes nothing.
    expect(parse(await mcp.callTool({ name: 'set_invoice_status', arguments: { id: overdue.id, status: 'paid' } }))).toMatchObject({ changed: false, invoice: { revision: 2 } });

    const after = parse(await mcp.callTool({ name: 'get_invoice_summary', arguments: { oldest_overdue_limit: 3 } }));
    expect(after.currencies.find((c: { currency: string }) => c.currency === 'EUR')).toMatchObject({
      overdue: { count: 0, total: 0 },
      paidThisMonth: { count: 1, total: 300 },
    });
    expect(after.oldestOverdue).toEqual([]);

    // Errors come back as tool errors with the REST body.
    const invalid = await mcp.callTool({ name: 'set_invoice_status', arguments: { id: overdue.id, status: 'draft' } });
    expect(invalid.isError).toBe(true);
    expect(parse(invalid).error).toMatchObject({ code: 'invalid_status_transition', details: { from: 'paid', to: 'draft', allowed: ['sent', 'void'] } });
    const stale = await mcp.callTool({ name: 'set_invoice_status', arguments: { id: overdue.id, status: 'void', expected_revision: 1 } });
    expect(parse(stale).error.code).toBe('precondition_failed');
  });
});
