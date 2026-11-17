/**
 * Sending invoices by email: POST /invoices/:id/send, GET /invoices/:id/emails
 * and the MCP tool, against a real local D1 with the provider (Resend) faked
 * at the fetch boundary. No network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Scope } from '../shared/api';
import { createApp } from './app';
import { defaultDeps, type AppDeps } from './deps';
import { api, BASE, connectAgent, createWorkspace, readPublicAsset, sampleInvoice, startD1, TestClock } from './test/helpers';
import { extractPdfText, pdfStreams } from './test/pdf-text';
import { INVOICE_PALETTES } from '@/components/invoice/invoiceTheme';
import { composeInvoiceEmail, isDeliverableEmail } from '../shared/email-template';
import { buildOperatorApp, completeSetup, fakeWorkos, routeFetch } from './test/operator';
import { groupOf } from './operator/telemetry';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});
beforeEach(async () => {
  await d1.db.batch(['operator_settings', 'email_counters'].map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const RESEND_KEY = 're_test_key_0123456789abcdef';
const FROM = 'invoices@mail.midnightinvoice.app';
const CLIENT = 'billing@acme-client.io';
const OWNER = 'studio@midnight-studio.io';

interface ResendCall {
  url: string;
  headers: Record<string, string>;
  body: {
    from: string;
    to: string[];
    cc?: string[];
    reply_to?: string;
    subject: string;
    text: string;
    html: string;
    attachments: { filename: string; content: string; content_type: string }[];
  };
}

/** Records every request; answers like Resend (200 { id }) unless told otherwise. */
function fakeResend() {
  const calls: ResendCall[] = [];
  const state = { respond: (n: number): Response => Response.json({ id: `re_msg_${n}` }) };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({ url: req.url, headers: Object.fromEntries(req.headers.entries()), body: JSON.parse(await req.text()) });
    return state.respond(calls.length);
  }) as typeof fetch;
  return { calls, fetch: fetchFn, state };
}

const SYSTEM = { id: null, email: null, type: 'system' as const };

async function setup(opts: { settings?: Record<string, unknown>; key?: string | null; clock?: TestClock } = {}) {
  const resend = fakeResend();
  const clock = opts.clock ?? new TestClock();
  const logged: unknown[] = [];
  const deps: AppDeps = defaultDeps({
    db: d1.db,
    readAsset: readPublicAsset,
    clock: clock.fn,
    logError: (_m, e) => logged.push(e),
    operator: { vars: { RESEND_API_KEY: opts.key === null ? undefined : (opts.key ?? RESEND_KEY) }, telemetryFlushDelayMs: 0 },
    email: { fetch: resend.fetch },
  });
  const settings = { 'email.fromAddress': FROM, ...opts.settings };
  for (const [key, value] of Object.entries(settings)) await deps.settings.set(key, value, SYSTEM);
  const app = createApp(deps);
  const client = api(app);
  const ws = await createWorkspace(client);
  await client.put('/api/v1/settings', { fromName: 'Midnight Studio', fromEmail: OWNER }, ws.token);
  const invoice = async (overrides: Record<string, unknown> = {}, token = ws.token) => {
    const res = await client.post('/api/v1/invoices', sampleInvoice({ toEmail: CLIENT, fromEmail: OWNER, dueDate: '2026-12-01', ...overrides }), token);
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    return res.json.invoice as { id: string; invoiceNumber: string; status: string };
  };
  const send = (id: string, body?: unknown, token = ws.token, headers?: Record<string, string>) =>
    client.post(`/api/v1/invoices/${id}/send`, body, token, headers);
  return { app, client, ws, deps, resend, clock, logged, invoice, send };
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const fill = (hex: string) => `${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).join(' ')} scn`;

describe('POST /invoices/:id/send', () => {
  it('sends the invoice through Resend with the PDF attached, From fixed by the server and Reply-To = sender', async () => {
    const { send, invoice, resend } = await setup();
    const inv = await invoice();
    const res = await send(inv.id);
    expect(res.status).toBe(200);
    expect(resend.calls).toHaveLength(1);
    const call = resend.calls[0];
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.headers.authorization).toBe(`Bearer ${RESEND_KEY}`);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['idempotency-key']).toBe(`invoice-email/${res.json.email.id}`);
    expect(call.body.from).toBe(`"Midnight Studio via Midnight Invoice" <${FROM}>`);
    expect(call.body.reply_to).toBe(OWNER);
    expect(call.body.to).toEqual([CLIENT]);
    expect(call.body.cc).toBeUndefined();
    expect(call.body.subject).toBe(`Invoice ${inv.invoiceNumber} from Midnight Studio`);
    expect(call.body.text).toContain('Hi Acme Corp,');
    expect(call.body.text).toContain('$300.00');
    expect(call.body.text).toContain('Due date: Dec 1, 2026');
    expect(call.body.html).toContain('Amount due');

    const [attachment] = call.body.attachments;
    expect(attachment).toMatchObject({ filename: `${inv.invoiceNumber}.pdf`, content_type: 'application/pdf' });
    const pdf = decode(attachment.content);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(extractPdfText(pdf)).toContain(inv.invoiceNumber);
    // Emailed PDFs default to the light theme (setting email.pdfTheme).
    expect(pdfStreams(pdf).some((s) => s.includes(fill(INVOICE_PALETTES.light.background)))).toBe(true);

    expect(res.json.email).toMatchObject({ to: CLIENT, cc: [], status: 'sent', error: null, sentBy: { type: 'user' }, statusChanged: true });
    expect(res.json.replayed).toBe(false);
  });

  it('marks a draft as sent (explicit in the response); a resend of a sent or paid invoice keeps its status', async () => {
    const { send, invoice, client, ws, clock } = await setup({ settings: { 'email.cooldownMinutes': 0 } });
    const inv = await invoice();
    expect(inv.status).toBe('draft');
    const first = await send(inv.id);
    expect(first.json).toMatchObject({ statusChanged: true, invoice: { status: 'sent', sentAt: '2026-11-17' } });
    expect(first.headers.get('etag')).toBe(`"${first.json.invoice.revision}"`);

    clock.advance(60_000);
    const again = await send(inv.id);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ statusChanged: false, invoice: { status: 'sent', revision: first.json.invoice.revision } });

    await client.post(`/api/v1/invoices/${inv.id}/mark-paid`, {}, ws.token);
    const paid = await send(inv.id);
    expect(paid.json).toMatchObject({ statusChanged: false, invoice: { status: 'paid' } });
  });

  it('refuses void invoices', async () => {
    const { send, invoice, client, ws, resend } = await setup();
    const inv = await invoice();
    await client.post(`/api/v1/invoices/${inv.id}/void`, {}, ws.token);
    const res = await send(inv.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('invalid_status_transition');
    expect(resend.calls).toHaveLength(0);
  });

  it('answers 503 email_not_configured without a key, without a From address, or when turned off', async () => {
    for (const opts of [{ key: null }, { settings: { 'email.fromAddress': '' } }, { settings: { 'email.enabled': false } }]) {
      const { send, invoice, client, ws, resend } = await setup(opts);
      const inv = await invoice();
      const res = await send(inv.id);
      expect(res.status).toBe(503);
      expect(res.json.error.code).toBe('email_not_configured');
      expect(resend.calls).toHaveLength(0);
      const history = await client.get(`/api/v1/invoices/${inv.id}/emails`, ws.token);
      expect(history.json.delivery.configured).toBe(false);
    }
  });

  it('lets the workspace token override the recipient and add cc; rejects undeliverable or injected addresses', async () => {
    const { send, invoice, resend } = await setup({ settings: { 'email.cooldownMinutes': 0 } });
    const inv = await invoice();
    const ok = await send(inv.id, { to: 'accounts@other-client.io', cc: ['partner@studio-partner.io'], ccMe: true });
    expect(ok.status).toBe(200);
    expect(resend.calls[0].body.to).toEqual(['accounts@other-client.io']);
    expect(resend.calls[0].body.cc).toEqual(['partner@studio-partner.io', OWNER]);

    for (const to of ['nobody@example.com', 'a@b', 'x@test.test', 'victim@acme-client.io\r\nBcc: spam@list.io', '"Name" <a@b.io>', 'a@[127.0.0.1]']) {
      const res = await send(inv.id, { to });
      expect(res.status, to).toBe(400);
      expect(res.json.error.code).toBe('validation_failed');
    }
    expect((await send(inv.id, { cc: ['a@x.io', 'b@x.io', 'c@x.io', 'd@x.io'] })).status).toBe(400);
    // Unknown fields (from, replyTo, html, bcc…) are rejected, not ignored.
    for (const extra of [{ from: 'ceo@bank.com' }, { replyTo: 'x@y.io' }, { html: '<b>hi</b>' }, { bcc: ['x@y.io'] }]) {
      expect((await send(inv.id, extra)).status).toBe(400);
    }
    expect(resend.calls).toHaveLength(1);
  });

  it('rejects CR/LF and control characters in the subject and the sender name (header injection)', async () => {
    const { send, invoice, resend } = await setup();
    const inv = await invoice();
    for (const subject of ['Hello\r\nBcc: spam@list.io', 'Hi\nthere', 'tab\u0000null', 'line sep']) {
      const res = await send(inv.id, { subject });
      expect(res.status, JSON.stringify(subject)).toBe(400);
      expect(res.json.error.details[0].path).toBe('subject');
    }
    const evil = await invoice({ fromName: 'Evil\r\nBcc: spam@list.io' });
    const res = await send(evil.id);
    expect(res.status).toBe(400);
    expect(res.json.error.details[0].path).toBe('fromName');
    expect(resend.calls).toHaveLength(0);
  });

  it('sends custom subject/message as plain text and escapes them (and invoice text) in the HTML part', async () => {
    const { send, invoice, resend } = await setup();
    const inv = await invoice({ toName: '<b>Acme</b> & "Co"', fromName: 'Studio "Q" \\ <x>' });
    const message = 'Hello <script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">pay</a> & thanks';
    const res = await send(inv.id, { subject: 'Your <i>invoice</i> & receipt', message });
    expect(res.status).toBe(200);
    const { html, text, subject, from } = resend.calls[0].body;
    expect(subject).toBe('Your <i>invoice</i> & receipt');
    expect(text).toContain(message);
    expect(html).not.toMatch(/<(script|img|a|i|b)[\s>]/i);
    expect(html).toContain('Hello &lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;pay&lt;/a&gt; &amp; thanks');
    expect(html).toContain('<title>Your &lt;i&gt;invoice&lt;/i&gt; &amp; receipt</title>');
    expect(html).toContain('Studio &quot;Q&quot; \\ &lt;x&gt;');
    // Quotes and backslashes in the display name are escaped inside the quoted string.
    expect(from).toBe(`"Studio \\"Q\\" \\\\ <x> via Midnight Invoice" <${FROM}>`);
    expect((await send(inv.id, { message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await send(inv.id, { subject: 's'.repeat(201) })).status).toBe(400);
  });

  it('enforces the per-invoice cooldown (429 + Retry-After) and lets it pass after the window', async () => {
    const { send, invoice, clock, resend } = await setup();
    const inv = await invoice();
    expect((await send(inv.id)).status).toBe(200);
    clock.advance(4 * 60_000);
    const early = await send(inv.id);
    expect(early.status).toBe(429);
    expect(early.json.error.details).toMatchObject({ reason: 'invoice_cooldown', retryAfterSeconds: 360 });
    expect(early.headers.get('retry-after')).toBe('360');
    clock.advance(6 * 60_000);
    expect((await send(inv.id)).status).toBe(200);
    expect(resend.calls).toHaveLength(2);
  });

  it('enforces workspace hourly/daily caps and the site-wide daily cap with D1 counters', async () => {
    const hourly = await setup({ settings: { 'email.cooldownMinutes': 0, 'email.workspaceHourlyLimit': 2 } });
    const a = await hourly.invoice();
    expect((await hourly.send(a.id)).status).toBe(200);
    expect((await hourly.send(a.id)).status).toBe(200);
    const third = await hourly.send(a.id);
    expect(third.status).toBe(429);
    expect(third.json.error.details).toMatchObject({ reason: 'workspace_hourly_limit', limit: 2, retryAfterSeconds: 3600 });
    // Rejected sends do not use up the budget of the next hour.
    hourly.clock.advance(60 * 60_000);
    expect((await hourly.send(a.id)).status).toBe(200);
    expect(hourly.resend.calls).toHaveLength(3);

    await d1.db.prepare('DELETE FROM email_counters').run();
    const global = await setup({ settings: { 'email.cooldownMinutes': 0, 'email.globalDailyCap': 1 } });
    const b = await global.invoice();
    expect((await global.send(b.id)).status).toBe(200);
    const capped = await global.send(b.id);
    expect(capped.status).toBe(429);
    expect(capped.json.error.details.reason).toBe('site_daily_cap');
  });

  it('makes retries idempotent with Idempotency-Key and rejects reusing a key for another request', async () => {
    const { send, invoice, resend, client, ws } = await setup();
    const inv = await invoice();
    const key = { 'idempotency-key': 'send-inv-1-attempt' };
    const first = await send(inv.id, { message: 'Hi' }, ws.token, key);
    const retry = await send(inv.id, { message: 'Hi' }, ws.token, key);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200); // not stopped by the cooldown: it is the same request
    expect(retry.json).toMatchObject({ replayed: true, statusChanged: true, email: { id: first.json.email.id } });
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(resend.calls).toHaveLength(1);
    const other = await send(inv.id, { message: 'Different' }, ws.token, key);
    expect(other.status).toBe(409);
    expect(other.json.error.code).toBe('idempotency_conflict');
    expect((await send(inv.id, {}, ws.token, { 'idempotency-key': 'bad key with spaces' })).status).toBe(400);
    const history = await client.get(`/api/v1/invoices/${inv.id}/emails`, ws.token);
    expect(history.json.emails).toHaveLength(1);
  });

  it('records provider failures, surfaces them, keeps the draft status, and retries a failed key under the same provider key', async () => {
    const { send, invoice, resend, client, ws } = await setup();
    const inv = await invoice();
    resend.state.respond = () =>
      Response.json({ statusCode: 403, name: 'validation_error', message: 'The mail.midnightinvoice.app domain is not verified.' }, { status: 403 });
    const key = { 'idempotency-key': 'k-42' };
    const failed = await send(inv.id, {}, ws.token, key);
    expect(failed.status).toBe(502);
    expect(failed.json.error).toMatchObject({
      code: 'email_send_failed',
      details: { reason: 'provider_rejected', retryable: false, email: { status: 'failed', error: { code: 'provider_rejected' } } },
    });
    expect(failed.json.error.message).toMatch(/domain is not verified/);
    const current = await client.get(`/api/v1/invoices/${inv.id}`, ws.token);
    expect(current.json.invoice.status).toBe('draft');

    const history = await client.get(`/api/v1/invoices/${inv.id}/emails`, ws.token);
    expect(history.json.emails[0]).toMatchObject({ status: 'failed', error: { code: 'provider_rejected' }, to: CLIENT });

    resend.state.respond = (n) => Response.json({ id: `re_msg_${n}` });
    const retried = await send(inv.id, {}, ws.token, key);
    expect(retried.status).toBe(200);
    expect(retried.json).toMatchObject({ replayed: false, statusChanged: true, email: { id: failed.json.error.details.email.id, status: 'sent' } });
    expect(resend.calls.map((c) => c.headers['idempotency-key'])).toEqual([
      `invoice-email/${retried.json.email.id}`,
      `invoice-email/${retried.json.email.id}`,
    ]);
    expect((await client.get(`/api/v1/invoices/${inv.id}/emails`, ws.token)).json.emails).toHaveLength(1);

    // Network failure: unknown outcome, retryable, never leaks the key.
    const inv2 = await invoice();
    resend.state.respond = () => {
      throw new TypeError('fetch failed');
    };
    const down = await send(inv2.id);
    expect(down.status).toBe(502);
    expect(down.json.error.details).toMatchObject({ reason: 'provider_unreachable', retryable: true });
    expect(JSON.stringify(down.json)).not.toContain(RESEND_KEY);
  });

  it('isolates workspaces', async () => {
    const { send, invoice, client, resend } = await setup();
    const inv = await invoice();
    const other = await createWorkspace(client);
    expect((await send(inv.id, {}, other.token)).status).toBe(404);
    expect((await client.get(`/api/v1/invoices/${inv.id}/emails`, other.token)).status).toBe(404);
    expect(resend.calls).toHaveLength(0);
  });

  it('deletes the email log with the workspace', async () => {
    const { send, invoice, client, ws } = await setup();
    const inv = await invoice();
    await send(inv.id);
    await client.del('/api/v1/workspace', ws.token);
    const left = await d1.db.prepare('SELECT COUNT(*) AS n FROM email_messages WHERE workspace_id = ?').bind(ws.workspace.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe('agents and invoices:send', () => {
  it('is not granted to existing agents: they get 403 insufficient_scope', async () => {
    const { send, invoice, client, ws } = await setup();
    const inv = await invoice();
    const { api_key, agent } = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read', 'clients:read', 'clients:write']);
    expect(agent.scopes).not.toContain('invoices:send');
    const res = await send(inv.id, {}, api_key);
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: 'insufficient_scope', details: { requiredScope: 'invoices:send' } });
  });

  it('lets an agent send only to the invoice’s user-entered toEmail, cc only the workspace email, within per-agent limits', async () => {
    const { send, invoice, client, ws, resend } = await setup({ settings: { 'email.cooldownMinutes': 0, 'email.agentHourlyLimit': 2 } });
    const { api_key } = await connectAgent(client, ws.token, ['invoices:send', 'invoices:write']);
    const inv = await invoice(); // created by the user: CLIENT was entered by the user

    const override = await send(inv.id, { to: 'attacker@evil-mail.io' }, api_key);
    expect(override.status).toBe(403);
    expect(override.json.error).toMatchObject({ code: 'recipient_not_allowed', details: { reason: 'agent_recipient_override' } });
    const cc = await send(inv.id, { cc: ['attacker@evil-mail.io'] }, api_key);
    expect(cc.json.error).toMatchObject({ code: 'recipient_not_allowed', details: { reason: 'agent_cc_not_allowed' } });

    const ok = await send(inv.id, { to: CLIENT.toUpperCase(), ccMe: true }, api_key);
    expect(ok.status).toBe(200);
    expect(ok.json.email.sentBy).toMatchObject({ type: 'agent', agentName: 'Test Agent' });
    expect(resend.calls[0].body.cc).toEqual([OWNER]);

    // An address the agent typed itself (its own invoice, or its edit of the user's) is refused.
    const own = await invoice({ toEmail: 'new-client@fresh-domain.io' }, api_key);
    const unconfirmed = await send(own.id, {}, api_key);
    expect(unconfirmed.json.error).toMatchObject({ code: 'recipient_not_allowed', details: { reason: 'address_not_confirmed_by_user' } });
    const hijack = await invoice();
    await client.patch(`/api/v1/invoices/${hijack.id}`, { toEmail: 'attacker@evil-mail.io' }, api_key);
    expect((await send(hijack.id, {}, api_key)).json.error.details.reason).toBe('address_not_confirmed_by_user');
    // …until the user confirms it, e.g. by saving it as a client.
    await client.post('/api/v1/clients', { name: 'Fresh', email: 'new-client@fresh-domain.io' }, ws.token);
    expect((await send(own.id, {}, api_key)).status).toBe(200);

    const limited = await send(inv.id, {}, api_key);
    expect(limited.status).toBe(429);
    expect(limited.json.error.details.reason).toBe('agent_hourly_limit');
    // The user is not limited by the agent's budget.
    expect((await send(inv.id)).status).toBe(200);
  });
});

describe('MCP send_invoice_email', () => {
  async function mcp(app: ReturnType<typeof createApp>, token: string) {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'email-test', version: '1.0.0' });
    await client.connect(transport);
    return client;
  }
  const parse = (result: { content?: unknown }) => JSON.parse((result.content as { type: string; text: string }[])[0].text);

  it('is listed only with invoices:send, annotated as an open-world, non-idempotent write that needs user confirmation', async () => {
    const { app, client, ws } = await setup();
    const without = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write']);
    const plain = await mcp(app, without.api_key);
    expect((await plain.listTools()).tools.map((t) => t.name)).not.toContain('send_invoice_email');
    await plain.close();

    const scopes: Scope[] = ['invoices:send'];
    const withSend = await connectAgent(client, ws.token, scopes);
    const agent = await mcp(app, withSend.api_key);
    const tool = (await agent.listTools()).tools.find((t) => t.name === 'send_invoice_email')!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(tool.description).toMatch(/confirm with the user/i);
    expect(tool.description).toMatch(/client email on file/);
    expect(tool.description).toMatch(/Requires scope invoices:send/);
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).not.toContain('to');
    await agent.close();
  });

  it('sends with only invoices:send, reports the status change, and returns rule violations as tool errors', async () => {
    const { app, client, ws, invoice, resend } = await setup();
    const inv = await invoice();
    const { api_key } = await connectAgent(client, ws.token, ['invoices:send']);
    const agent = await mcp(app, api_key);
    const result = await agent.callTool({ name: 'send_invoice_email', arguments: { id: inv.id, message: 'As discussed.', idempotency_key: 'mcp-1' } });
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ statusChanged: true, invoice: { status: 'sent' }, email: { status: 'sent', sentBy: { type: 'agent' } } });
    const replay = await agent.callTool({ name: 'send_invoice_email', arguments: { id: inv.id, message: 'As discussed.', idempotency_key: 'mcp-1' } });
    expect(parse(replay).replayed).toBe(true);
    expect(resend.calls).toHaveLength(1);

    const cooldown = await agent.callTool({ name: 'send_invoice_email', arguments: { id: inv.id } });
    expect(cooldown.isError).toBe(true);
    expect(parse(cooldown).error).toMatchObject({ code: 'rate_limited', details: { reason: 'invoice_cooldown' } });
    await agent.close();
  });
});

describe('settings registry and secrets', () => {
  it('reads the provider key through the registry (env fallback) and never returns it from the API', async () => {
    const { send, invoice, client, ws, resend } = await setup({ key: null, settings: {} });
    const inv = await invoice();
    expect((await send(inv.id)).status).toBe(503);
    const history = await client.get(`/api/v1/invoices/${inv.id}/emails`, ws.token);
    expect(history.json.delivery).toEqual({
      configured: false,
      fromAddress: FROM,
      fromName: 'Midnight Invoice',
      pdfTheme: 'light',
      cooldownMinutes: 10,
    });
    expect(resend.calls).toHaveLength(0);
    const configured = await setup();
    const inv2 = await configured.invoice();
    const sent = await configured.send(inv2.id);
    expect(JSON.stringify(sent.json)).not.toContain(RESEND_KEY);
    const list = await configured.client.get(`/api/v1/invoices/${inv2.id}/emails`, configured.ws.token);
    expect(JSON.stringify(list.json)).not.toContain(RESEND_KEY);
    expect(list.json.delivery.configured).toBe(true);
  });

  it('follows operator settings changes at runtime: theme, reply-to policy, From name', async () => {
    const { send, invoice, resend } = await setup({ settings: { 'email.pdfTheme': 'dark', 'email.replyTo': 'none', 'email.fromName': 'Acme Billing' } });
    const inv = await invoice();
    expect((await send(inv.id)).status).toBe(200);
    const body = resend.calls[0].body;
    expect(body.reply_to).toBeUndefined();
    expect(body.from).toBe(`"Midnight Studio via Acme Billing" <${FROM}>`);
    const pdf = decode(body.attachments[0].content);
    expect(pdfStreams(pdf).some((s) => s.includes(fill(INVOICE_PALETTES.dark.background)))).toBe(true);
  });
});

describe('email template and address checks', () => {
  it('refuses reserved and malformed addresses and accepts ordinary ones', () => {
    for (const ok of ['a@b.io', 'first.last+tag@sub.domain.co.uk', 'delivered@resend.dev']) expect(isDeliverableEmail(ok), ok).toBe(true);
    for (const bad of ['', 'a', 'a@b', 'a@example.com', 'a@x.example.org', 'a@host.local', 'a@x.test', 'a b@c.io', 'a@b.io\n', '.a@b.io', 'a..b@c.io', 'a@-b.io', `${'x'.repeat(65)}@b.io`]) {
      expect(isDeliverableEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('always includes the invoice facts and signs with the sender', () => {
    const mail = composeInvoiceEmail(
      { invoiceNumber: 'INV-0009', fromName: 'Studio', fromEmail: 's@studio.io', toName: '', currency: 'EUR', taxRate: 10, lineItems: [{ quantity: 1, price: 100 }], dueDate: '' },
      { message: 'Custom only.' },
    );
    expect(mail.subject).toBe('Invoice INV-0009 from Studio');
    expect(mail.text).toContain('Custom only.');
    expect(mail.text).toContain('Amount due: €110.00');
    expect(mail.text).not.toContain('Due date');
    expect(mail.text).toContain('Reply to this email to reach Studio');
  });
});

describe('operator console', () => {
  const OP_TABLES = [
    'operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit',
    'operator_state', 'telemetry_rollups', 'telemetry_errors',
  ];

  it('configures email in Settings (key encrypted, write-only), sends with it, and shows an Email telemetry group', async () => {
    await d1.db.batch(OP_TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
    const workos = fakeWorkos();
    const resend = fakeResend();
    const built = buildOperatorApp(d1.db, { fetch: routeFetch({ 'api.workos.com': workos.fetch }), overrides: { email: { fetch: resend.fetch } } });
    const { browser: b } = await completeSetup(built.app, workos);
    const key = 're_operator_console_key_ABCDEF987654';
    expect((await b.put('/api/operator/settings/resend.apiKey', { value: key })).status).toBe(200);
    expect((await b.put('/api/operator/settings/email.fromAddress', { value: FROM })).status).toBe(200);
    expect((await b.put('/api/operator/settings/email.fromName', { value: 'Bad\r\nName' })).status).toBe(400);
    const list = await b.get('/api/operator/settings');
    expect(list.text).not.toContain(key);
    expect(list.json.settings.find((s: { key: string }) => s.key === 'resend.apiKey')).toMatchObject({ group: 'Email', secret: true, isSet: true, last4: '7654', source: 'database' });
    expect(list.json.settings.filter((s: { group: string }) => s.group === 'Email').map((s: { key: string }) => s.key)).toEqual(
      expect.arrayContaining(['email.enabled', 'email.provider', 'email.fromAddress', 'email.fromName', 'email.replyTo', 'email.pdfTheme', 'email.globalDailyCap']),
    );
    const row = await d1.db.prepare(`SELECT value, value_enc FROM operator_settings WHERE key = 'resend.apiKey'`).first<{ value: string | null; value_enc: string }>();
    expect(row?.value).toBeNull();
    expect(row?.value_enc).not.toContain(key);

    const client = api(built.app);
    const ws = await createWorkspace(client);
    const inv = (await client.post('/api/v1/invoices', sampleInvoice({ toEmail: CLIENT, fromEmail: OWNER }), ws.token)).json.invoice;
    expect((await client.post(`/api/v1/invoices/${inv.id}/send`, {}, ws.token)).status).toBe(200);
    expect(resend.calls[0].headers.authorization).toBe(`Bearer ${key}`);
    await client.post(`/api/v1/invoices/${inv.id}/send`, {}, ws.token); // cooldown: a client error in the group

    await built.telemetry.flush();
    const t = (await b.get('/api/operator/telemetry?range=1h')).json;
    expect(t.groups.find((g: { group: string }) => g.group === 'Email')).toMatchObject({ requests: 2 });
    expect(groupOf('rest|GET /invoices/:id/emails').group).toBe('Email');
    expect(groupOf('mcp|tool send_invoice_email').group).toBe('Email');
  });
});
