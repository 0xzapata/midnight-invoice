/**
 * User accounts × email: a signed-in browser's per-device workspace token is
 * "the user" for the email rules exactly like the original workspace token
 * (the D1 triggers and the send rules key on the actor type, which a device
 * token gives as `user`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, connectAgent, sampleInvoice, startD1 } from './test/helpers';
import { accountsApp, alice, signInUser } from './test/accounts';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const TABLES = [
  'email_messages', 'email_confirmed_recipients', 'invoice_sender_review', 'email_counters',
  'activity', 'user_oauth_states', 'user_sessions', 'workspace_tokens', 'workspace_members', 'users',
  'operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit',
  'operator_state', 'telemetry_rollups', 'telemetry_errors', 'workspace_suspensions', 'workspace_activity',
  'agent_registrations', 'agents', 'clients', 'invoices', 'templates', 'workspace_settings', 'workspaces',
];
beforeEach(async () => {
  await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const CLIENT = 'billing@acme-client.io';
const OWNER = 'studio@midnight-studio.io';

function fakeResend() {
  const calls: { to: string[]; cc?: string[] }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(JSON.parse(await req.text()));
    return Response.json({ id: `re_msg_${calls.length}` });
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

async function setup() {
  const resend = fakeResend();
  const built = await accountsApp(d1.db, { overrides: { email: { fetch: resend.fetch } } as never });
  const { app, workos, operator } = built;
  for (const [key, value] of [['resend.apiKey', 're_test_key_0123456789abcdef'], ['email.fromAddress', 'invoices@mail.example.org'], ['email.cooldownMinutes', 0]] as const) {
    const res = await operator.put(`/api/operator/settings/${key}`, { value });
    if (res.status !== 200) throw new Error(`${key}: ${res.status} ${res.text}`);
  }
  const { b } = await signInUser(app, workos, alice);
  const dev = (await b.post('/api/account/workspace', {})).json as { token: string };
  const client = api(app);
  await client.put('/api/v1/settings', { fromName: 'Midnight Studio', fromEmail: OWNER }, dev.token);
  const { api_key } = await connectAgent(client, dev.token, ['invoices:send', 'invoices:write']);
  const invoice = async (token: string, overrides: Record<string, unknown> = {}) => {
    const res = await client.post('/api/v1/invoices', sampleInvoice({ toEmail: CLIENT, fromEmail: OWNER, ...overrides }), token);
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    return res.json.invoice as { id: string };
  };
  const send = (id: string, token: string, body: unknown = {}) => client.post(`/api/v1/invoices/${id}/send`, body, token);
  return { ...built, resend, client, dev, agentKey: api_key, invoice, send };
}

describe('a device token is "the user" for email', () => {
  it('confirms recipient addresses it saves, like the original workspace token', async () => {
    const { client, dev, agentKey, invoice, send } = await setup();
    // The agent typed this address itself: not confirmed.
    const own = await invoice(agentKey, { toEmail: 'new-client@fresh-domain.io' });
    expect((await send(own.id, agentKey)).json.error).toMatchObject({ code: 'recipient_not_allowed', details: { reason: 'address_not_confirmed_by_user' } });
    // Saving it as a client from the signed-in browser (device token) confirms it.
    expect((await client.post('/api/v1/clients', { name: 'Fresh', email: 'new-client@fresh-domain.io' }, dev.token)).status).toBe(201);
    expect((await send(own.id, agentKey)).status).toBe(200);
    // So does entering it on an invoice saved from the device.
    const typed = await invoice(dev.token, { toEmail: 'other@typed-by-user.io' });
    expect((await send(typed.id, agentKey)).status).toBe(200);
  });

  it('clears the sender review when the user saves the invoice from a device', async () => {
    const { client, dev, agentKey, invoice, send } = await setup();
    const inv = await invoice(dev.token);
    await client.patch(`/api/v1/invoices/${inv.id}`, { paymentDetails: 'IBAN XX00 ATTACKER' }, agentKey);
    expect((await send(inv.id, agentKey)).json.error).toMatchObject({ code: 'invoice_needs_review', details: { fields: ['paymentDetails'] } });
    expect((await client.patch(`/api/v1/invoices/${inv.id}`, { notes: 'Reviewed' }, dev.token)).status).toBe(200);
    expect((await send(inv.id, agentKey)).status).toBe(200);
  });

  it('sends as the user from a device: recipient override allowed, attributed to "You"', async () => {
    const { dev, invoice, send, resend, client } = await setup();
    const inv = await invoice(dev.token);
    const res = await send(inv.id, dev.token, { to: 'accounts@other-client.io', ccMe: true });
    expect(res.status).toBe(200);
    expect(res.json.email).toMatchObject({ to: 'accounts@other-client.io', sentBy: { type: 'user' }, status: 'sent' });
    expect(resend.calls[0].to).toEqual(['accounts@other-client.io']);
    const log = await client.get('/api/v1/activity?limit=50', dev.token);
    const emailed = log.json.activity.find((e: { action: string }) => e.action === 'invoice.emailed');
    expect(emailed.actor).toEqual({ type: 'user' });
  });

  it('deleting the account together with its workspace removes email and template rows', async () => {
    const { app, workos, dev, invoice, send, client } = await setup();
    const inv = await invoice(dev.token);
    expect((await send(inv.id, dev.token)).status).toBe(200);
    expect((await client.post('/api/v1/templates', { name: 'Monthly retainer', lineItems: [{ description: 'Retainer', quantity: 1, price: 900 }] }, dev.token)).status).toBe(201);
    const count = async (t: string) => (await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
    for (const t of ['email_messages', 'email_confirmed_recipients', 'templates']) expect(await count(t), t).toBeGreaterThan(0);
    const { b } = await signInUser(app, workos, alice);
    const del = await b.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: true } });
    expect(del.json.deletedWorkspace).toBe(true);
    for (const t of ['email_messages', 'email_confirmed_recipients', 'invoice_sender_review', 'templates', 'invoices', 'clients', 'workspace_tokens']) {
      expect(await count(t), t).toBe(0);
    }
  });
});
