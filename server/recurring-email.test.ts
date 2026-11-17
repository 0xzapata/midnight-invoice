/**
 * Recurring invoices × email (`autoAction: send_email`): the schedule's
 * invoice is generated, then emailed through the email feature's own send
 * use-case. Real local D1, the provider (Resend) faked at the fetch boundary,
 * a stepped clock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '../shared/api';
import type { RecurringSchedule } from '../shared/recurring';
import { createApp } from './app';
import { defaultDeps, type AppDeps } from './deps';
import { runRecurringGeneration } from './recurring/job';
import { recurringEmailKey, serviceEmailSender } from './recurring/autoActions';
import { systemContext } from './recurring/generate';
import { api, approveReview, connectAgent, createWorkspace, readPublicAsset, startD1, TestClock, type Api } from './test/helpers';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});
beforeEach(async () => {
  await d1.db.batch(['operator_settings', 'email_counters', 'recurring_runs', 'recurring_schedules'].map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const SYSTEM = { id: null, email: null, type: 'system' as const };
const CLIENT_EMAIL = 'billing@globex-corp.io';
const OWNER = 'studio@midnight-studio.io';
const FULL: Scope[] = ['recurring:read', 'recurring:write', 'invoices:read', 'invoices:write', 'templates:read', 'templates:write', 'clients:read', 'clients:write', 'invoices:send'];

interface ResendCall {
  headers: Record<string, string>;
  body: { to: string[]; subject: string; attachments: { filename: string; content_type: string }[] };
}

function fakeResend() {
  const calls: ResendCall[] = [];
  const state = { respond: (n: number): Response => Response.json({ id: `re_msg_${n}` }) };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({ headers: Object.fromEntries(req.headers.entries()), body: JSON.parse(await req.text()) });
    return state.respond(calls.length);
  }) as typeof fetch;
  return { calls, fetch: fetchFn, state };
}

async function setup(settings: Record<string, unknown> = {}) {
  const resend = fakeResend();
  const clock = new TestClock(new Date('2026-11-17T10:00:00.000Z'));
  const deps: AppDeps = defaultDeps({
    db: d1.db,
    readAsset: readPublicAsset,
    clock: clock.fn,
    logError: () => undefined,
    operator: { vars: { RESEND_API_KEY: 're_test_key_0123456789abcdef' } },
    email: { fetch: resend.fetch },
  });
  // Anonymous test workspaces: the account requirement (security fix M2, on by default) has its own tests in security-review.test.ts.
  for (const [key, value] of Object.entries({ 'email.fromAddress': 'invoices@mail.example.org', 'email.cooldownMinutes': 0, 'email.requireAccount': false, ...settings })) {
    await deps.settings.set(key, value, SYSTEM);
  }
  const app = createApp(deps);
  const client = api(app);
  const ws = await createWorkspace(client);
  const token = ws.token;
  await client.put('/api/v1/settings', { fromName: 'Midnight Studio', fromEmail: OWNER, fromAddress: '1 Night Lane', paymentDetails: 'IBAN USER 1', notes: '', taxRate: 0, currency: 'EUR' }, token);
  const globex = (await client.post('/api/v1/clients', { name: 'Globex', email: CLIENT_EMAIL }, token)).json.client;
  const template = (
    await client.post('/api/v1/templates', { name: 'Retainer', clientId: globex.id, lineItems: [{ description: 'Retainer {{month_name}}', quantity: 1, price: 1000 }], paymentTermsDays: 14 }, token)
  ).json.template;
  const run = () => runRecurringGeneration(deps, clock.now.getTime());
  const at = (iso: string) => {
    clock.now = new Date(iso);
  };
  const schedule = async (body: Record<string, unknown> = {}, as = token) =>
    client.post('/api/v1/recurring', { name: 'Globex monthly', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01', timezone: 'UTC', autoAction: 'send_email', ...body }, as);
  return { deps, app, client, token, ws, globex, template, resend, clock, run, at, schedule };
}

const get = async (client: Api, token: string, id: string) => (await client.get(`/api/v1/recurring/${id}`, token)).json.recurring as RecurringSchedule;
const invoicesOf = async (client: Api, token: string, id: string) => (await client.get(`/api/v1/invoices?recurring_id=${id}&include_deleted=true`, token)).json.invoices;
const activity = async (client: Api, token: string, action: string) =>
  (await client.get(`/api/v1/activity?action=${action}&limit=100`, token)).json.activity as { action: string; actor: { type: string }; entity: { id: string }; changes: Record<string, unknown> }[];

describe('send_email: who may turn it on, and when', () => {
  it('only the user, only with email set up, only to a client address the user entered', async () => {
    const s = await setup();
    const agent = await connectAgent(s.client, s.token, FULL);
    // Agents never, even with invoices:send.
    const byAgent = await s.schedule({}, agent.api_key);
    expect(byAgent.status).toBe(403);
    expect(byAgent.json.error.message).toMatch(/Only the user/);
    const mark = await s.schedule({ autoAction: 'mark_sent', name: 'Mark' }, agent.api_key);
    expect(mark.status).toBe(201);
    expect((await s.client.patch(`/api/v1/recurring/${mark.json.recurring.id}`, { autoAction: 'send_email' }, agent.api_key)).status).toBe(403);

    // A client email written by an agent is not confirmed.
    const agentClient = (await s.client.post('/api/v1/clients', { name: 'Agent Co', email: 'pay@agent-typed.io' }, agent.api_key)).json.client;
    const unconfirmed = await s.schedule({ clientId: agentClient.id });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.json.error.details[0].message).toMatch(/added by an agent/);
    const noEmail = (await s.client.post('/api/v1/clients', { name: 'No Mail Ltd' }, s.token)).json.client;
    expect((await s.schedule({ clientId: noEmail.id })).json.error.details[0].message).toMatch(/no email address/);

    // The user, with a confirmed address.
    const mine = await s.schedule();
    expect(mine.status).toBe(201);
    const id = mine.json.recurring.id;
    // Agents can then not change, resume or run it, but can pause it.
    expect((await s.client.patch(`/api/v1/recurring/${id}`, { name: 'Changed' }, agent.api_key)).status).toBe(403);
    expect((await s.client.post(`/api/v1/recurring/${id}/run-now`, undefined, agent.api_key)).status).toBe(403);
    expect((await s.client.post(`/api/v1/recurring/${id}/pause`, undefined, agent.api_key)).status).toBe(200);
    expect((await s.client.post(`/api/v1/recurring/${id}/resume`, undefined, agent.api_key)).status).toBe(403);
    expect((await s.client.post(`/api/v1/recurring/${id}/resume`, undefined, s.token)).status).toBe(200);
  });

  it('needs email to be configured (503 email_not_configured; the list says so for the app)', async () => {
    const s = await setup({ 'email.enabled': false });
    const res = await s.schedule();
    expect(res.status).toBe(503);
    expect(res.json.error).toMatchObject({ code: 'email_not_configured', details: { reason: 'Sending email is turned off on this server.' } });
    expect((await s.client.get('/api/v1/recurring', s.token)).json.email).toEqual({ configured: false, reason: 'Sending email is turned off on this server.' });
    await s.deps.settings.set('email.enabled', true, SYSTEM);
    expect((await s.client.get('/api/v1/recurring', s.token)).json.email).toEqual({ configured: true, reason: null });
    expect((await s.schedule()).status).toBe(201);
  });
});

describe('send_email: generation and delivery', () => {
  it('generates the invoice and emails it with the PDF; sent only once delivered; one invoice.emailed by the system', async () => {
    const s = await setup();
    const id = (await s.schedule()).json.recurring.id as string;
    s.at('2026-12-01T00:30:00.000Z');
    expect(await s.run()).toMatchObject({ generated: 1, failed: 0 });
    expect(s.resend.calls).toHaveLength(1);
    const call = s.resend.calls[0];
    expect(call.body.to).toEqual([CLIENT_EMAIL]);
    expect(call.body.attachments).toEqual([expect.objectContaining({ content_type: 'application/pdf', filename: expect.stringMatching(/^INV-0001.*\.pdf$/) })]);
    const [inv] = await invoicesOf(s.client, s.token, id);
    expect(inv).toMatchObject({ status: 'sent', sentAt: '2026-12-01', recurringId: id, createdBy: { type: 'system' }, updatedBy: { type: 'system', recurringName: 'Globex monthly' } });
    // Email history: the schedule sent it.
    const history = (await s.client.get(`/api/v1/invoices/${inv.id}/emails`, s.token)).json.emails;
    expect(history).toEqual([expect.objectContaining({ status: 'sent', to: CLIENT_EMAIL, statusChanged: true, sentBy: { type: 'system', recurringId: id, recurringName: 'Globex monthly' } })]);
    expect(call.headers['idempotency-key']).toBe(`invoice-email/${history[0].id}`);
    // Activity: invoice.created + one invoice.emailed (status change folded in), both by the system; no status_changed.
    const entries = (await s.client.get(`/api/v1/activity?entity_id=${inv.id}`, s.token)).json.activity;
    expect(entries.map((e: { action: string; actor: { type: string } }) => [e.action, e.actor.type])).toEqual([
      ['invoice.emailed', 'system'],
      ['invoice.created', 'system'],
    ]);
    expect(entries[0].changes).toMatchObject({ status: { from: 'draft', to: 'sent' }, recurring: { id, label: 'Globex monthly' } });
    expect((await get(s.client, s.token, id)).lastError).toBeNull();
    // Repeated runs never send again.
    await s.run();
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
  });

  it('a provider failure leaves a draft; only the send is retried (same key), and it goes out exactly once', async () => {
    const s = await setup();
    const id = (await s.schedule()).json.recurring.id as string;
    s.resend.state.respond = () => Response.json({ name: 'internal_server_error', message: 'boom' }, { status: 500 });
    s.at('2026-12-01T00:30:00.000Z');
    await s.run();
    let [inv] = await invoicesOf(s.client, s.token, id);
    expect(inv.status).toBe('draft');
    let state = await get(s.client, s.token, id);
    expect(state.lastError).toMatchObject({ code: 'email_failed', invoiceId: inv.id, period: '2026-12-01', attempts: 1, sendPending: true, nextAttemptAt: '2026-12-01T01:30:00.000Z' });
    expect(state).toMatchObject({ nextRunDate: '2027-01-01', retryAt: null, runCount: 1 });
    expect((await activity(s.client, s.token, 'invoice.email_failed'))[0]).toMatchObject({ actor: { type: 'system' }, entity: { id: inv.id } });

    // Not before nextAttemptAt.
    s.at('2026-12-01T01:00:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
    s.resend.state.respond = (n) => Response.json({ id: `re_msg_${n}` });
    s.at('2026-12-01T01:31:00.000Z');
    expect(await s.run()).toMatchObject({ emailRetries: 1, emailsSent: 1, generated: 0 });
    expect(s.resend.calls).toHaveLength(2);
    // Both attempts carried the same provider key: one message, retried.
    expect(s.resend.calls[1].headers['idempotency-key']).toBe(s.resend.calls[0].headers['idempotency-key']);
    [inv] = await invoicesOf(s.client, s.token, id);
    expect(inv.status).toBe('sent');
    expect((await invoicesOf(s.client, s.token, id)).length).toBe(1);
    state = await get(s.client, s.token, id);
    expect(state.lastError).toBeNull();
    const history = (await s.client.get(`/api/v1/invoices/${inv.id}/emails`, s.token)).json.emails;
    expect(history.map((e: { status: string }) => e.status)).toEqual(['sent']);
    await s.run();
    expect(s.resend.calls).toHaveLength(2);
  });

  it('never double-sends after a partial failure: same period key replays, and a delivered invoice clears the pending send', async () => {
    const s = await setup();
    const id = (await s.schedule()).json.recurring.id as string;
    s.at('2026-12-01T00:30:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
    const [inv] = await invoicesOf(s.client, s.token, id);
    // The send for this period again (as a retry would): replayed, nothing sent.
    const again = await serviceEmailSender.send(systemContext(s.deps, s.ws.workspace.id), { invoiceId: inv.id, schedule: { id, name: 'Globex monthly' }, period: '2026-12-01' });
    expect(again.replayed).toBe(true);
    expect(recurringEmailKey(id, '2026-12-01')).toBe(`internal:recurring/${id}/2026-12-01`); // security fix L1: a namespace clients cannot use
    // The email went out but recording that failed: the schedule still thinks it is pending.
    const pending = { code: 'email_failed', message: 'x', at: '2026-12-01T00:30:00.000Z', period: '2026-12-01', attempts: 1, invoiceId: inv.id, sendPending: true, nextAttemptAt: '2026-12-01T00:31:00.000Z' };
    await d1.db.prepare('UPDATE recurring_schedules SET last_error = ? WHERE id = ?').bind(JSON.stringify(pending), id).run();
    s.at('2026-12-01T02:00:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
    expect((await get(s.client, s.token, id)).lastError).toBeNull();
  });
});

describe('send_email: held for the user', () => {
  it('a template whose payment details an agent wrote last is held as "needs your review" until the user approves', async () => {
    const s = await setup();
    const id = (await s.schedule()).json.recurring.id as string;
    const agent = await connectAgent(s.client, s.token, FULL);
    expect((await s.client.patch(`/api/v1/templates/${s.template.id}`, { paymentDetails: 'IBAN ATTACKER 666' }, agent.api_key)).status).toBe(200);
    s.at('2026-12-01T00:30:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(0);
    const [inv] = await invoicesOf(s.client, s.token, id);
    expect(inv).toMatchObject({ status: 'draft', paymentDetails: 'IBAN ATTACKER 666' });
    const state = await get(s.client, s.token, id);
    expect(state.lastError).toMatchObject({ code: 'email_needs_review', sendPending: true, invoiceId: inv.id });
    // Security fix M1: the hold names what changed since the user approved automatic emailing.
    expect(state.lastError!.message).toMatch(/^Needs your review: Since you approved automatic emailing, the template was changed by an agent/);
    expect((await activity(s.client, s.token, 'recurring.run_failed'))[0]).toMatchObject({ actor: { type: 'system' }, changes: { reason: 'email_needs_review' } });

    // Saving the template unchanged approves nothing any more (security fixes L2/M1: a full-document save
    // carries the agent's values)…
    const t = (await s.client.get(`/api/v1/templates/${s.template.id}`, s.token)).json.template;
    expect((await s.client.put(`/api/v1/templates/${t.id}`, t, s.token)).status).toBe(200);
    s.at('2026-12-01T01:31:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(0);
    // …approving the invoice alone is not enough either (the template change is not approved)…
    expect((await approveReview(s.client, s.token, 'invoices', inv.id)).json.approved).toEqual(['paymentDetails']);
    s.at('2026-12-01T03:32:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(0);
    // …the user's re-approval of the schedule is: the held email goes out right away.
    expect((await s.client.post(`/api/v1/recurring/${id}/approve-email`, undefined, s.token)).json.emailed).toBe(true);
    expect(s.resend.calls).toHaveLength(1);
    expect((await invoicesOf(s.client, s.token, id))[0].status).toBe('sent');
  });

  it('a client address an agent changed is never emailed automatically', async () => {
    const s = await setup();
    const id = (await s.schedule()).json.recurring.id as string;
    const agent = await connectAgent(s.client, s.token, FULL);
    await s.client.patch(`/api/v1/clients/${s.globex.id}`, { email: 'payments@evil-payee.io' }, agent.api_key);
    s.at('2026-12-01T00:30:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(0);
    const [inv] = await invoicesOf(s.client, s.token, id);
    expect(inv).toMatchObject({ status: 'draft', toEmail: 'payments@evil-payee.io' });
    // Held first because the client changed since the user approved automatic emailing (security fix M1)…
    expect((await get(s.client, s.token, id)).lastError).toMatchObject({ code: 'email_needs_review', sendPending: true });
    // …and re-approving the schedule never confirms the agent's address: the recipient rule still holds it.
    expect((await s.client.post(`/api/v1/recurring/${id}/approve-email`, undefined, s.token)).json.emailed).toBe(false);
    expect(s.resend.calls).toHaveLength(0);
    expect((await get(s.client, s.token, id)).lastError).toMatchObject({ code: 'email_address_not_confirmed', sendPending: true });
  });
});

describe('send_email: limits', () => {
  it('counts against the workspace daily cap like the user’s own sends (never bypassed); retried after the window', async () => {
    const s = await setup({ 'email.workspaceDailyCap': 1 });
    const id = (await s.schedule()).json.recurring.id as string;
    // The user already used today's budget.
    const manual = (await s.client.post('/api/v1/invoices', { clientId: s.globex.id, lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, s.token)).json.invoice;
    s.at('2026-12-01T00:30:00.000Z');
    expect((await s.client.post(`/api/v1/invoices/${manual.id}/send`, {}, s.token)).status).toBe(200);
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
    const state = await get(s.client, s.token, id);
    expect(state.lastError).toMatchObject({ code: 'email_rate_limited', sendPending: true });
    // Retried once the daily window resets (UTC midnight).
    expect(Date.parse(state.lastError!.nextAttemptAt!)).toBeGreaterThanOrEqual(Date.parse('2026-12-02T00:00:00.000Z'));
    s.at('2026-12-02T00:10:00.000Z');
    await s.run();
    expect(s.resend.calls).toHaveLength(2);
    expect((await invoicesOf(s.client, s.token, id))[0].status).toBe('sent');
  });

  it('respects the site-wide daily cap', async () => {
    const s = await setup({ 'email.globalDailyCap': 1 });
    const other = await createWorkspace(s.client);
    await s.client.put('/api/v1/settings', { fromName: 'Other', fromEmail: '', fromAddress: '', paymentDetails: '', notes: '', taxRate: 0, currency: 'EUR' }, other.token);
    const inv = (await s.client.post('/api/v1/invoices', { toName: 'X', toEmail: 'x@other-client.io', lineItems: [{ description: 'x', quantity: 1, price: 1 }] }, other.token)).json.invoice;
    const id = (await s.schedule()).json.recurring.id as string;
    s.at('2026-12-01T00:30:00.000Z');
    expect((await s.client.post(`/api/v1/invoices/${inv.id}/send`, {}, other.token)).status).toBe(200);
    await s.run();
    expect(s.resend.calls).toHaveLength(1);
    expect((await get(s.client, s.token, id)).lastError).toMatchObject({ code: 'email_rate_limited', message: expect.stringMatching(/daily email limit/) });
  });
});
