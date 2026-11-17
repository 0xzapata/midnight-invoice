import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { safeReturnTo, deviceLabelFromUserAgent } from '../shared/accounts';
import { api, connectAgent, countingLimiter, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';
import { browser, buildOperatorApp } from './test/operator';
import { accountsApp, alice, bearer, bob, signInUser, type App } from './test/accounts';
import { allowAll } from './deps';
import { runScheduledJobs } from './scheduled';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const TABLES = [
  'activity', 'user_oauth_states', 'user_sessions', 'workspace_tokens', 'workspace_members', 'users',
  'operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit',
  'operator_state', 'telemetry_rollups', 'telemetry_errors', 'workspace_suspensions', 'workspace_activity', 'agents', 'clients', 'invoices', 'workspaces',
];
beforeEach(async () => {
  await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const DAY = 86_400_000;
const count = async (sql: string, ...params: unknown[]) => (await d1.db.prepare(sql).bind(...params).first<{ n: number }>())!.n;
const tools = (token: string, app: App) => api(app).post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token, { accept: 'application/json, text/event-stream' });

function setCookieOf(headers: Headers, name: string): string | undefined {
  return headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

describe('safeReturnTo (open-redirect safe)', () => {
  it('keeps allowlisted same-origin paths and known parameters only', () => {
    expect(safeReturnTo('/agents/approve?code=WDJB-MJHT')).toBe('/agents/approve?code=WDJB-MJHT');
    expect(safeReturnTo('/?tab=settings')).toBe('/?tab=settings');
    expect(safeReturnTo('/account')).toBe('/account');
    for (const evil of [
      'https://evil.example',
      '//evil.example/agents',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      '/agents/../../evil',
      '/%2F%2Fevil.example',
      '/agents?next=https://evil.example',
      '/agents/approve?code=<script>',
      '/?tab=settings#https://evil.example',
      '/ agents',
      '/agents\n',
      '/admin',
      '',
      undefined,
      42,
      `/${'a'.repeat(300)}`,
    ]) {
      expect(safeReturnTo(evil), String(evil)).toBe('/?tab=settings');
    }
  });

  it('labels devices from the user agent', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari on macOS');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36')).toBe('Chrome on Linux');
    expect(deviceLabelFromUserAgent(null)).toBe('Browser');
  });
});

describe('availability', () => {
  it('is off by default: config says disabled and every other route is a clean 404', async () => {
    const { app } = await accountsApp(d1.db, { enable: false });
    const b = browser(app);
    expect((await b.get('/api/account/config')).json).toEqual({ enabled: false, requiredForNewWorkspaces: false });
    for (const [method, path] of [['GET', '/api/account/session'], ['POST', '/api/account/auth/start'], ['GET', '/api/account/auth/callback?state=x&code=y'], ['GET', '/api/account/devices'], ['POST', '/api/account/workspace']] as const) {
      const res = await b.call(method, path, { body: method === 'POST' ? {} : undefined });
      expect(res.status, path).toBe(404);
      expect(res.json.error.code).toBe('accounts_disabled');
    }
    // A browser can always detach itself: sign-out stays reachable (nothing to sign out here).
    expect((await b.post('/api/account/sign-out', undefined)).status).toBe(401);
    // Anonymous workspaces are unaffected.
    expect((await api(app).post('/api/v1/workspaces')).status).toBe(201);
  });

  it('is unavailable (503, config disabled) when the operator console or WorkOS is not configured', async () => {
    // No INITIAL_PASSWORD: no encrypted store, so no WorkOS credentials.
    const bare = buildOperatorApp(d1.db, { initialPassword: '' });
    await bare.deps.settings.set('accounts.enabled', true, { type: 'system', id: null, email: null });
    const b = browser(bare.app);
    expect((await b.get('/api/account/config')).json.enabled).toBe(false);
    const start = await b.post('/api/account/auth/start', {});
    expect(start.status).toBe(503);
    expect(start.json.error.code).toBe('accounts_unavailable');
    const cb = await b.get('/api/account/auth/callback?state=x&code=y');
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toBe('/account/connect?error=accounts_unavailable');

    // Operator set up, then the WorkOS API key removed.
    await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
    const { app, operator } = await accountsApp(d1.db);
    expect((await browser(app).get('/api/account/config')).json.enabled).toBe(true);
    expect((await operator.del('/api/operator/settings/workos.apiKey')).status).toBe(200);
    expect((await browser(app).get('/api/account/config')).json.enabled).toBe(false);
    expect((await browser(app).post('/api/account/auth/start', {})).status).toBe(503);
  });
});

describe('sign-in callback', () => {
  it('runs the full AuthKit flow: exact redirect URI, PKCE S256, browser-bound state, secure cookies', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const b = browser(app);
    const start = await b.post('/api/account/auth/start', { intent: 'sign-up', returnTo: '/agents/approve?code=WDJB-MJHT', loginHint: 'alice@example.com' });
    expect(start.status).toBe(200);
    const url = new URL(start.json.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://api.workos.com/user_management/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('http://app.test/api/account/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('screen_hint')).toBe('sign-up');
    expect(url.searchParams.get('login_hint')).toBe('alice@example.com');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const nonceCookie = setCookieOf(start.headers, '__Secure-mi_user_oauth')!;
    expect(nonceCookie).toMatch(/Path=\/api\/account\/auth/);
    expect(nonceCookie).toMatch(/HttpOnly/);
    expect(nonceCookie).toMatch(/Secure/);
    expect(nonceCookie).toMatch(/SameSite=Lax/);
    // The state is stored hashed only; the verifier never leaves the server.
    expect(await count('SELECT COUNT(*) AS n FROM user_oauth_states WHERE state_hash = ?', url.searchParams.get('state'))).toBe(0);

    const { callback } = await workos.completeAuthorize(start.json.authorizationUrl, alice);
    const cb = await b.get(callback);
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toBe(`/account/connect?return_to=${encodeURIComponent('/agents/approve?code=WDJB-MJHT')}`);
    const sessionCookie = setCookieOf(cb.headers, '__Secure-mi_user_session')!;
    expect(sessionCookie).toMatch(/Path=\/api\/account(;|$)/);
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/SameSite=Strict/);
    // Neither the session id nor any token is in the redirect URL.
    expect(cb.headers.get('location')).not.toMatch(/mi_ws_|session|code=code_/);
    const exchange = workos.calls.find((c) => c.url.endsWith('/user_management/authenticate') && (c.body as { code: string }).code === new URL(callback, 'http://x').searchParams.get('code'));
    expect(exchange?.body).toMatchObject({ grant_type: 'authorization_code', client_id: 'client_test_operator', code_verifier: expect.any(String) });

    const s = await b.get('/api/account/session');
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ user: { email: 'alice@example.com' }, workspace: null, csrfToken: expect.any(String) });
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE workos_user_id = ?', alice.id)).toBe(1);
  });

  it('rejects a wrong state, a callback in another browser, replays and expired states', async () => {
    const clock = new TestClock();
    const { app, workos } = await accountsApp(d1.db, { clock });
    const b = browser(app);
    const start = await b.post('/api/account/auth/start', {});
    const { callback, code, state } = await workos.completeAuthorize(start.json.authorizationUrl, alice);

    const wrong = await b.get(`/api/account/auth/callback?code=${code}&state=${'x'.repeat(43)}`);
    expect(wrong.headers.get('location')).toBe('/account/connect?error=invalid_state');
    // A forged callback does not cancel the real sign-in in progress (nonce cookie kept).
    expect(b.jar.has('__Secure-mi_user_oauth')).toBe(true);

    // Same callback URL opened in a browser that did not start the sign-in.
    const other = browser(app);
    expect((await other.get(callback)).headers.get('location')).toBe('/account/connect?error=invalid_state');
    // The state was consumed by that attempt: single use, so the real browser cannot reuse it either.
    expect((await b.get(callback)).headers.get('location')).toBe('/account/connect?error=invalid_state');
    expect(b.jar.has('__Secure-mi_user_session')).toBe(false);

    // Replayed authorization code with a fresh state: WorkOS refuses (codes are single use).
    const start2 = await b.post('/api/account/auth/start', {});
    const r2 = await workos.completeAuthorize(start2.json.authorizationUrl, alice);
    expect((await b.get(r2.callback)).headers.get('location')).toMatch(/^\/account\/connect\?return_to=/);
    const start3 = await b.post('/api/account/auth/start', {});
    const s3 = new URL(start3.json.authorizationUrl).searchParams.get('state')!;
    expect((await b.get(`/api/account/auth/callback?code=${r2.code}&state=${s3}`)).headers.get('location')).toBe('/account/connect?error=authorization_failed');
    // And replaying the whole completed callback is refused.
    expect((await b.get(r2.callback)).headers.get('location')).toBe('/account/connect?error=invalid_state');

    // Expired state (10 minutes).
    const start4 = await b.post('/api/account/auth/start', {});
    const r4 = await workos.completeAuthorize(start4.json.authorizationUrl, alice);
    clock.advance(11 * 60_000);
    expect((await b.get(r4.callback)).headers.get('location')).toBe('/account/connect?error=invalid_state');
    void state;
  });

  it('refuses unverified emails (flag from WorkOS or email_verification_required) and creates no account', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const unverified = await signInUser(app, workos, { id: 'user_unverified', email: 'new@example.com', emailVerified: false });
    expect(unverified.location).toBe('/account/connect?error=email_not_verified');
    expect(unverified.session.status).toBe(401);
    workos.pendingVerification.add('user_pending');
    const pending = await signInUser(app, workos, { id: 'user_pending', email: 'pending@example.com' });
    expect(pending.location).toBe('/account/connect?error=email_not_verified');
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });

  it('never redirects outside the app (return_to allowlist)', async () => {
    const { app, workos } = await accountsApp(d1.db);
    for (const evil of ['https://evil.example/x', '//evil.example', '/\\evil.example', '/agents?next=//evil.example']) {
      const { location } = await signInUser(app, workos, alice, browser(app), evil);
      expect(location).toBe(`/account/connect?return_to=${encodeURIComponent('/?tab=settings')}`);
    }
  });

  it('uses the WorkOS user id as identity and follows email changes', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const first = await signInUser(app, workos, alice);
    const again = await signInUser(app, workos, { id: alice.id, email: 'Alice.New@Example.com' });
    expect(again.session.json.user.id).toBe(first.session.json.user.id);
    expect(again.session.json.user.email).toBe('alice.new@example.com');
    // A different WorkOS user who claims the old email is a different account (email never links identities).
    const impostor = await signInUser(app, workos, { id: 'user_other', email: 'alice@example.com' });
    expect(impostor.session.json.user.id).not.toBe(first.session.json.user.id);
  });

  it('rate limits the auth endpoints', async () => {
    const limiter = countingLimiter(3);
    const { app } = await accountsApp(d1.db, { overrides: { rateLimiters: { create: limiter, poll: allowAll } } });
    const b = browser(app);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await b.post('/api/account/auth/start', {})).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await b.get('/api/account/auth/callback?state=x&code=y')).headers.get('location')).toBe('/account/connect?error=rate_limited');
    expect(limiter.calls.every((k) => k.startsWith('account-auth:') || k.startsWith('operator-'))).toBe(true);
  });
});

describe('sessions', () => {
  it('expires on idle and absolute timeouts', async () => {
    const clock = new TestClock();
    const { app, workos } = await accountsApp(d1.db, { clock });
    const { b } = await signInUser(app, workos, alice);
    clock.advance(13 * DAY);
    expect((await b.get('/api/account/session')).status).toBe(200);
    clock.advance(14 * DAY + 1);
    expect((await b.get('/api/account/session')).status).toBe(401);

    const { b: b2 } = await signInUser(app, workos, alice);
    for (let i = 0; i < 3; i++) {
      clock.advance(10 * DAY);
      expect((await b2.get('/api/account/session')).status).toBe(i < 2 ? 200 : 401);
    }
  });

  it('issues a new session id on every sign-in and revokes the old one (no fixation)', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const before = b.jar.get('__Secure-mi_user_session')!;
    await signInUser(app, workos, alice, b);
    const after = b.jar.get('__Secure-mi_user_session')!;
    expect(after).not.toBe(before);
    const stale = browser(app);
    stale.jar.set('__Secure-mi_user_session', before);
    expect((await stale.get('/api/account/session')).status).toBe(401);
    expect((await b.get('/api/account/session')).status).toBe(200);
    // A planted (unsigned) cookie is never accepted.
    const planted = browser(app);
    planted.jar.set('__Secure-mi_user_session', `${'A'.repeat(43)}.${'B'.repeat(32)}`);
    expect((await planted.get('/api/account/session')).status).toBe(401);
  });

  it('requires CSRF token and same origin on cookie-authenticated mutations', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const noToken = await b.post('/api/account/workspace', {}, { noCsrf: true });
    expect(noToken.status).toBe(403);
    expect(noToken.json.error.code).toBe('csrf_failed');
    expect((await b.post('/api/account/workspace', {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await b.post('/api/account/workspace', {}, { noOrigin: true, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await b.post('/api/account/workspace', {}, { headers: { 'x-csrf-token': 'forged' } })).status).toBe(403);
    expect((await b.post('/api/account/sign-out-everywhere', { keepThisDevice: false }, { noCsrf: true })).status).toBe(403);
    expect((await b.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: true }, noCsrf: true })).status).toBe(403);
    expect((await browser(app).post('/api/account/auth/start', {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_members')).toBe(0);
    expect((await b.post('/api/account/workspace', {})).status).toBe(201);
  });

  it('keeps operator sessions and user sessions apart in both directions', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const opCookie = operator.jar.get('__Secure-mi_op_session')!;
    // An operator signed in to the console is not signed in to an account.
    expect((await operator.get('/api/account/session')).status).toBe(401);
    // The operator signing in as a user gets a separate account; the console session is unaffected.
    const { b: user } = await signInUser(app, workos, { id: 'user_operator', email: 'operator@example.com' });
    const userCookie = user.jar.get('__Secure-mi_user_session')!;
    expect((await user.get('/api/operator/session')).status).toBe(401);

    const swapped = browser(app);
    swapped.jar.set('__Secure-mi_op_session', `full.${userCookie}`);
    expect((await swapped.get('/api/operator/session')).status).toBe(401);
    const swapped2 = browser(app);
    swapped2.jar.set('__Secure-mi_user_session', opCookie.split('.').slice(1).join('.'));
    expect((await swapped2.get('/api/account/session')).status).toBe(401);
    expect((await operator.get('/api/operator/session')).status).toBe(200);
    // A user session is never accepted by the public API either.
    expect((await user.get('/api/v1/invoices')).status).toBe(401);
  });
});

describe('workspaces and device tokens', () => {
  it('creates a workspace for a new account; the device token works for REST and MCP, with no recovery key', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const created = await b.post('/api/account/workspace', {});
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ workspace: { recoveryKeyEnabled: false }, token: expect.stringMatching(/^mi_ws_/), deviceId: expect.any(String) });
    const token = created.json.token as string;
    const client = api(app);
    expect((await client.post('/api/v1/invoices', sampleInvoice(), token)).status).toBe(201);
    expect((await client.get('/api/v1/workspace', token)).json.workspace.id).toBe(created.json.workspace.id);
    expect((await tools(token, app)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_tokens WHERE token_hash = ?', token)).toBe(0); // hashed only
    expect((await b.post('/api/account/workspace', {})).status).toBe(409);
    expect((await b.get('/api/account/session')).json.workspace).toMatchObject({ id: created.json.workspace.id, recoveryKeyEnabled: false });
  });

  it('claims an anonymous workspace: the browser gets its own token, the recovery key keeps working', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    await client.post('/api/v1/invoices', sampleInvoice({ toName: 'Claimed Co' }), ws.token);
    const { b } = await signInUser(app, workos, alice);
    expect((await b.post('/api/account/workspace/claim', {})).status).toBe(400);
    expect((await b.post('/api/account/workspace/claim', {}, { headers: bearer('mi_ws_notarealtokennotarealtokennotarealtok12') })).status).toBe(401);
    const claim = await b.post('/api/account/workspace/claim', {}, { headers: bearer(ws.token) });
    expect(claim.status).toBe(200);
    expect(claim.json.workspace).toMatchObject({ id: ws.workspace.id, recoveryKeyEnabled: true });
    expect(claim.json.token).not.toBe(ws.token);
    const list = await client.get('/api/v1/invoices', claim.json.token);
    expect(list.json.invoices.map((i: { toName: string }) => i.toName)).toEqual(['Claimed Co']);
    expect((await client.get('/api/v1/invoices', ws.token)).status).toBe(200);
    // Claiming again / by someone else is refused.
    expect((await b.post('/api/account/workspace/claim', {}, { headers: bearer(ws.token) })).json.error.code).toBe('workspace_exists');
    const { b: bobB } = await signInUser(app, workos, bob);
    expect((await bobB.post('/api/account/workspace/claim', {}, { headers: bearer(ws.token) })).json.error.code).toBe('workspace_owned');
    expect((await bobB.post('/api/account/workspace/claim', {}, { headers: bearer(claim.json.token) })).json.error.code).toBe('workspace_owned');
    // An account that already has a workspace cannot claim a second one (one account <-> one workspace).
    const other = await createWorkspace(client);
    expect((await b.post('/api/account/workspace/claim', {}, { headers: bearer(other.token) })).json.error.code).toBe('workspace_exists');
  });

  it('connects a new device to the account workspace, re-binds its own token and replaces foreign ones', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b: a } = await signInUser(app, workos, alice);
    const wsA = (await a.post('/api/account/workspace', {})).json;
    await client.post('/api/v1/invoices', sampleInvoice({ toName: 'From A' }), wsA.token);

    const { b, session } = await signInUser(app, workos, alice);
    expect(session.json.workspace.id).toBe(wsA.workspace.id);
    const conn = await b.post('/api/account/workspace/connect', {});
    expect(conn.status).toBe(200);
    expect(conn.json.token).not.toBe(wsA.token);
    expect((await client.get('/api/v1/invoices', conn.json.token)).json.invoices[0].toName).toBe('From A');
    // Signing in again in B and presenting its token keeps that token.
    await signInUser(app, workos, alice, b);
    const again = await b.post('/api/account/workspace/connect', {}, { headers: bearer(conn.json.token) });
    expect(again.json).toMatchObject({ token: conn.json.token, deviceId: conn.json.deviceId, reused: true });
    // Connecting without presenting it mints a new one and revokes the one this session held.
    const fresh = await b.post('/api/account/workspace/connect', {});
    expect(fresh.json.token).not.toBe(conn.json.token);
    expect((await client.get('/api/v1/invoices', conn.json.token)).status).toBe(401);

    // Bob signs in in the same browser and presents alice's device token: it is revoked (replaced here).
    const { b: c } = await signInUser(app, workos, bob);
    await c.post('/api/account/workspace', {});
    const bobConn = await c.post('/api/account/workspace/connect', {}, { headers: bearer(fresh.json.token) });
    expect(bobConn.json.reused).toBeUndefined();
    expect((await client.get('/api/v1/invoices', fresh.json.token)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', bobConn.json.token)).json.invoices).toEqual([]);
    // No workspace yet → 409 no_workspace.
    const { b: d } = await signInUser(app, workos, { id: 'user_dora', email: 'dora@example.com' });
    expect((await d.post('/api/account/workspace/connect', {})).json.error.code).toBe('no_workspace');
  });

  it('revokes devices: the token stops working for REST and MCP, agents keep working', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b: a } = await signInUser(app, workos, alice);
    const wsA = (await a.post('/api/account/workspace', {})).json;
    const agent = await connectAgent(client, wsA.token, ['invoices:read']);
    const { b } = await signInUser(app, workos, alice);
    const devB = (await b.post('/api/account/workspace/connect', {})).json;

    const devices = (await a.get('/api/account/devices')).json.devices;
    expect(devices).toHaveLength(2);
    expect(devices.find((d: { id: string }) => d.id === wsA.deviceId)).toMatchObject({ current: true, signedIn: true });
    expect((await a.del(`/api/account/devices/${devB.deviceId}`)).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devB.token)).status).toBe(401);
    expect((await tools(devB.token, app)).status).toBe(401);
    expect((await b.get('/api/account/session')).status).toBe(401); // B is signed out too
    expect((await client.get('/api/v1/invoices', agent.api_key)).status).toBe(200);
    expect((await tools(agent.api_key, app)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', wsA.token)).status).toBe(200);
    expect((await a.del(`/api/account/devices/${devB.deviceId}`)).status).toBe(404);
  });

  it('signs out this browser (cookie or device token), other devices, or everywhere', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b: a } = await signInUser(app, workos, alice);
    const wsA = (await a.post('/api/account/workspace', {})).json;
    const { b } = await signInUser(app, workos, alice);
    const devB = (await b.post('/api/account/workspace/connect', {})).json;
    const { b: c } = await signInUser(app, workos, alice);
    const devC = (await c.post('/api/account/workspace/connect', {})).json;

    expect((await a.post('/api/account/sign-out-everywhere', { keepThisDevice: true })).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devB.token)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', devC.token)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', wsA.token)).status).toBe(200);
    expect((await a.get('/api/account/session')).status).toBe(200);

    // Sign out with an expired session: the device token alone is enough to revoke itself.
    const { b: d } = await signInUser(app, workos, alice);
    const devD = (await d.post('/api/account/workspace/connect', {})).json;
    const loose = browser(app);
    expect((await loose.post('/api/account/sign-out', undefined, { headers: bearer(devD.token) })).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devD.token)).status).toBe(401);
    expect((await loose.post('/api/account/sign-out', undefined)).status).toBe(401);

    const out = await a.post('/api/account/sign-out-everywhere', { keepThisDevice: false });
    expect(out.status).toBe(204);
    expect((await client.get('/api/v1/invoices', wsA.token)).status).toBe(401);
    expect((await a.get('/api/account/session')).status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM workspace_tokens WHERE revoked_at IS NULL')).toBe(0);
  });

  it('applies operator suspension to device tokens', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const ws = (await b.post('/api/account/workspace', {})).json;
    expect((await operator.post(`/api/operator/workspaces/${ws.workspace.id}/suspend`, {})).status).toBe(200);
    const res = await api(app).get('/api/v1/invoices', ws.token);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('workspace_suspended');
  });

  it('keeps workspaces isolated between accounts', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b: a } = await signInUser(app, workos, alice);
    const wsA = (await a.post('/api/account/workspace', {})).json;
    await client.post('/api/v1/invoices', sampleInvoice({ toName: 'Alice only' }), wsA.token);
    const { b: bb } = await signInUser(app, workos, bob);
    const wsB = (await bb.post('/api/account/workspace', {})).json;
    expect((await client.get('/api/v1/invoices', wsB.token)).json.invoices).toEqual([]);
    expect((await bb.del(`/api/account/devices/${wsA.deviceId}`)).status).toBe(404);
    expect((await client.get('/api/v1/invoices', wsA.token)).status).toBe(200);
    expect((await bb.get('/api/account/devices')).json.devices.map((d: { id: string }) => d.id)).toEqual([wsB.deviceId]);
  });

  it('rotates and disables the recovery key', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    const { b } = await signInUser(app, workos, alice);
    const claim = (await b.post('/api/account/workspace/claim', {}, { headers: bearer(ws.token) })).json;
    const rotated = await b.post('/api/account/recovery-key/rotate', {});
    expect(rotated.json.recoveryKey).toMatch(/^mi_ws_/);
    expect((await client.get('/api/v1/invoices', ws.token)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', rotated.json.recoveryKey)).status).toBe(200);
    expect((await b.post('/api/account/recovery-key/disable', {})).json.workspace.recoveryKeyEnabled).toBe(false);
    expect((await client.get('/api/v1/invoices', rotated.json.recoveryKey)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', claim.token)).status).toBe(200);
    expect((await b.get('/api/account/session')).json.workspace.recoveryKeyEnabled).toBe(false);
  });
});

describe('require an account for new workspaces', () => {
  it('blocks anonymous workspace creation only when accounts are on and the setting is set', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const client = api(app);
    expect((await client.post('/api/v1/workspaces')).status).toBe(201);
    expect((await operator.put('/api/operator/settings/accounts.requiredForNewWorkspaces', { value: true })).status).toBe(200);
    expect((await browser(app).get('/api/account/config')).json).toEqual({ enabled: true, requiredForNewWorkspaces: true });
    const blocked = await client.post('/api/v1/workspaces');
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe('account_required');
    const { b } = await signInUser(app, workos, alice);
    expect((await b.post('/api/account/workspace', {})).status).toBe(201);
    expect((await operator.put('/api/operator/settings/registration.workspacesOpen', { value: false })).status).toBe(200);
    const { b: b2 } = await signInUser(app, workos, bob);
    expect((await b2.post('/api/account/workspace', {})).json.error.code).toBe('registration_closed');
    expect((await operator.put('/api/operator/settings/accounts.enabled', { value: false })).status).toBe(200);
    expect((await client.post('/api/v1/workspaces')).json.error.code).toBe('registration_closed');
  });
});

describe('operator console', () => {
  it('lists accounts (metadata only, searchable by email) and disables / re-enables them', async () => {
    const { app, workos, operator, telemetry } = await accountsApp(d1.db);
    const client = api(app);
    const { b } = await signInUser(app, workos, alice);
    const ws = (await b.post('/api/account/workspace', {})).json;
    await client.post('/api/v1/invoices', sampleInvoice({ toName: 'SECRET CLIENT Ltd', notes: 'PRIVATE NOTE 42' }), ws.token);
    await client.post('/api/v1/clients', { name: 'Hidden Client GmbH', email: 'secret-ap@hidden.example' }, ws.token);
    await signInUser(app, workos, bob);
    await signInUser(app, workos, { id: 'user_x', email: 'x@example.com', emailVerified: false });

    const list = await operator.get('/api/operator/accounts');
    expect(list.status).toBe(200);
    expect(list.json.enabled).toBe(true);
    expect(list.json.accounts).toHaveLength(2);
    const a = list.json.accounts.find((x: { email: string }) => x.email === 'alice@example.com');
    expect(a).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      emailVerified: true,
      createdAt: expect.any(Number),
      lastSignInAt: expect.any(Number),
      workspaceId: ws.workspace.id,
      activeDevices: 1,
      disabled: false,
      disabledAt: null,
      disabledReason: null,
    });
    expect((await operator.get('/api/operator/accounts?q=ALI')).json.accounts.map((x: { email: string }) => x.email)).toEqual(['alice@example.com']);
    expect((await operator.get('/api/operator/accounts?q=%25')).json.accounts).toEqual([]);
    for (const path of ['/accounts', '/workspaces', '/audit', '/overview']) {
      const r = await operator.get(`/api/operator${path}`);
      for (const leak of ['SECRET CLIENT', 'PRIVATE NOTE', 'Hidden Client', 'secret-ap@hidden.example', ws.token]) {
        expect(r.text.includes(leak), `${path} leaked ${leak}`).toBe(false);
      }
    }

    // Disable: sessions and tokens die, sign-in is refused.
    expect((await operator.post(`/api/operator/accounts/${a.id}/disable`, { reason: 'abuse' })).status).toBe(200);
    expect((await client.get('/api/v1/invoices', ws.token)).status).toBe(401);
    expect((await b.get('/api/account/session')).status).toBe(401);
    expect((await signInUser(app, workos, alice)).location).toBe('/account/connect?error=account_disabled');
    expect((await operator.get('/api/operator/accounts?status=disabled')).json.accounts[0]).toMatchObject({ disabled: true, disabledReason: 'abuse', activeDevices: 0 });
    expect((await operator.post(`/api/operator/accounts/${a.id}/disable`, {})).status).toBe(409);
    expect((await operator.post(`/api/operator/accounts/${a.id}/enable`)).status).toBe(200);
    const back = await signInUser(app, workos, alice);
    expect(back.session.status).toBe(200);
    expect(back.session.json.workspace.id).toBe(ws.workspace.id);
    const actions = (await operator.get('/api/operator/audit?action=account')).json.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['account.enable', 'account.disable']);
    // A user session cannot reach the operator endpoints.
    expect((await back.b.get('/api/operator/accounts')).status).toBe(401);

    // Telemetry: an "Account sign-in" group with successes and failures.
    await telemetry.flush();
    const t = await operator.get('/api/operator/telemetry?range=1h');
    const group = t.json.groups.find((g: { group: string }) => g.group === 'Account sign-in');
    expect(group).toBeDefined();
    const metrics = t.json.metrics.filter((m: { group: string }) => m.group === 'Account sign-in').map((m: { name: string; count: number }) => [m.name, m.count]);
    expect(metrics).toEqual(expect.arrayContaining([['sign-in succeeded', 3], ['sign-in failed', 2]]));
  });
});

describe('account deletion', () => {
  it('keeps the workspace with a fresh recovery key, or deletes it, and always removes sessions and tokens', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b } = await signInUser(app, workos, alice);
    const ws = (await b.post('/api/account/workspace', {})).json;
    await client.post('/api/v1/invoices', sampleInvoice(), ws.token);
    const { b: other } = await signInUser(app, workos, alice);
    const dev2 = (await other.post('/api/account/workspace/connect', {})).json;
    expect((await b.call('DELETE', '/api/account', { body: { confirm: 'wrong@example.com', deleteWorkspace: false } })).status).toBe(400);
    const kept = await b.call('DELETE', '/api/account', { body: { confirm: 'ALICE@example.com', deleteWorkspace: false } });
    expect(kept.status).toBe(200);
    expect(kept.json).toMatchObject({ deletedWorkspace: false, recoveryKey: expect.stringMatching(/^mi_ws_/) });
    expect((await client.get('/api/v1/invoices', kept.json.recoveryKey)).json.invoices).toHaveLength(1);
    for (const token of [ws.token, dev2.token]) expect((await client.get('/api/v1/invoices', token)).status).toBe(401);
    expect((await other.get('/api/account/session')).status).toBe(401);
    for (const table of ['users', 'user_sessions', 'workspace_tokens', 'workspace_members']) expect(await count(`SELECT COUNT(*) AS n FROM ${table}`), table).toBe(0);

    // Signing in again starts a fresh account; deleting it with its workspace removes everything.
    const { b: again } = await signInUser(app, workos, alice);
    const ws2 = (await again.post('/api/account/workspace/claim', {}, { headers: bearer(kept.json.recoveryKey) })).json;
    expect(ws2.workspace.id).toBe(ws.workspace.id);
    const gone = await again.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: true } });
    expect(gone.json).toEqual({ deletedWorkspace: true, recoveryKey: null });
    expect((await client.get('/api/v1/invoices', kept.json.recoveryKey)).status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM invoices WHERE workspace_id = ?', ws.workspace.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM workspaces')).toBe(0);
  });

  it('deleting the workspace from the API (device token) leaves the account signed in without a workspace', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const ws = (await b.post('/api/account/workspace', {})).json;
    expect((await api(app).del('/api/v1/workspace', ws.token)).status).toBe(204);
    expect((await b.get('/api/account/session')).json.workspace).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM workspace_tokens')).toBe(0);
    expect((await b.post('/api/account/workspace', {})).status).toBe(201);
  });
});

const activityOf = async (app: App, token: string) => {
  const res = await api(app).get('/api/v1/activity?limit=200', token);
  if (res.status !== 200) throw new Error(`activity failed: ${res.status} ${res.text}`);
  return res as {
    json: { activity: { action: string; actor: { type: string }; entity: { type: string; label: string } | null; changes: { counts?: Record<string, number> } | null }[] };
    text: string;
  };
};

describe('activity log', () => {
  it('records account events in the workspace log without tokens, session ids or emails', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    const { b } = await signInUser(app, workos, alice);
    const sessionId = b.jar.get('__Secure-mi_user_session')!.split('.')[0];
    const claim = (await b.post('/api/account/workspace/claim', {}, { headers: bearer(ws.token) })).json;
    const { b: b2 } = await signInUser(app, workos, alice);
    const dev2 = (await b2.post('/api/account/workspace/connect', {})).json;
    expect((await b.del(`/api/account/devices/${dev2.deviceId}`)).status).toBe(204);
    const { b: b3 } = await signInUser(app, workos, alice);
    await b3.post('/api/account/workspace/connect', {});
    expect((await b.post('/api/account/sign-out-everywhere', { keepThisDevice: true })).status).toBe(204);
    await b.post('/api/account/recovery-key/rotate', {});
    await b.post('/api/account/recovery-key/disable', {});
    await b.post('/api/account/recovery-key/disable', {}); // already off: not logged twice
    await b.post('/api/account/recovery-key/rotate', {});

    const log = await activityOf(app, claim.token);
    const actions = log.json.activity.map((e) => e.action).reverse();
    expect(actions).toEqual([
      'account.workspace_claimed',
      'account.device_signed_in',
      'account.device_signed_in',
      'account.device_revoked',
      'account.device_signed_in',
      'account.signed_out_other_devices',
      'account.recovery_key_rotated',
      'account.recovery_key_disabled',
      'account.recovery_key_created',
    ]);
    const signedIn = log.json.activity.find((e) => e.action === 'account.device_signed_in')!;
    expect(signedIn.entity).toMatchObject({ type: 'device', label: expect.any(String) });
    expect(log.json.activity.find((e) => e.action === 'account.signed_out_other_devices')!.changes).toEqual({ counts: { devices: 1 } });
    for (const leak of ['alice@example.com', claim.token, dev2.token, ws.token, 'mi_ws_', sessionId]) {
      expect(log.text.includes(leak), `activity leaked ${leak.slice(0, 12)}`).toBe(false);
    }

    // Deleting the account (workspace kept) and an operator disabling an account are logged too.
    const kept = (await b.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: false } })).json;
    expect((await activityOf(app, kept.recoveryKey)).json.activity[0].action).toBe('account.deleted');
    const { b: bobB } = await signInUser(app, workos, bob);
    const bobWs = (await bobB.post('/api/account/workspace', {})).json;
    expect((await activityOf(app, bobWs.token)).json.activity.map((e) => e.action).reverse()).toEqual(['account.workspace_created', 'account.device_signed_in']);
    const bobId = (await operator.get('/api/operator/accounts?q=bob')).json.accounts[0].id;
    await operator.post(`/api/operator/accounts/${bobId}/disable`, { reason: 'private operator note' });
    await operator.post(`/api/operator/accounts/${bobId}/enable`);
    const { b: bobAgain } = await signInUser(app, workos, bob);
    const bobDev = (await bobAgain.post('/api/account/workspace/connect', {})).json;
    const bobLog = await activityOf(app, bobDev.token);
    const disabled = bobLog.json.activity.find((e) => e.action === 'account.disabled')!;
    expect(disabled.actor).toEqual({ type: 'system' });
    expect(bobLog.text.includes('private operator note')).toBe(false);
  });
});

describe('device status, last use and housekeeping', () => {
  it('tells the holder of a rejected device token why it stopped working', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const anon = browser(app);
    const status = async (token: string) => (await anon.call('GET', '/api/account/device-status', { headers: bearer(token) })).json.status;
    const { b } = await signInUser(app, workos, alice);
    const dev = (await b.post('/api/account/workspace', {})).json;
    const { b: b2 } = await signInUser(app, workos, alice);
    const dev2 = (await b2.post('/api/account/workspace/connect', {})).json;
    expect(await status(dev.token)).toBe('active');
    expect(await status('mi_ws_unknownunknownunknownunknownunknown1234')).toBe('unknown');
    await b.del(`/api/account/devices/${dev2.deviceId}`);
    expect(await status(dev2.token)).toBe('revoked');
    const id = (await operator.get('/api/operator/accounts')).json.accounts[0].id;
    await operator.post(`/api/operator/accounts/${id}/disable`, {});
    expect(await status(dev.token)).toBe('account_disabled');
    expect((await anon.call('GET', '/api/account/device-status')).status).toBe(400);
  });

  it('records device last use on successful bearer requests, throttled', async () => {
    const clock = new TestClock();
    const { app, workos } = await accountsApp(d1.db, { clock });
    const { b } = await signInUser(app, workos, alice);
    const dev = (await b.post('/api/account/workspace', {})).json;
    const lastUsed = async () => (await d1.db.prepare('SELECT last_used_at AS t FROM workspace_tokens WHERE id = ?').bind(dev.deviceId).first<{ t: number | null }>())!.t;
    const until = async (pred: (v: number | null) => boolean) => {
      for (let i = 0; i < 50; i++) {
        const v = await lastUsed();
        if (pred(v)) return v;
        await new Promise((r) => setTimeout(r, 20));
      }
      return lastUsed();
    };
    const settle = () => new Promise((r) => setTimeout(r, 150));
    expect(await lastUsed()).toBeNull();
    expect((await api(app).get('/api/v1/invoices', dev.token)).status).toBe(200);
    const first = await until((v) => v !== null);
    expect(first).toBe(clock.now.getTime());
    clock.advance(10_000);
    await api(app).get('/api/v1/invoices', dev.token);
    await settle();
    expect(await lastUsed()).toBe(first); // within the 60 s throttle
    clock.advance(61_000);
    await api(app).post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, dev.token, { accept: 'application/json, text/event-stream' });
    const second = await until((v) => v !== first);
    expect(second).toBe(clock.now.getTime());
    // Failed requests do not count.
    clock.advance(61_000);
    expect((await api(app).get('/api/v1/invoices/00000000-0000-4000-8000-000000000999', dev.token)).status).toBe(404);
    await settle();
    expect(await lastUsed()).toBe(second);
    expect((await b.get('/api/account/devices')).json.devices[0].lastUsedAt).toBe(second);
  });

  it('prunes expired sign-in states, ended sessions and long-revoked device tokens hourly', async () => {
    const clock = new TestClock();
    const { app, workos, deps } = await accountsApp(d1.db, { clock });
    const { b } = await signInUser(app, workos, alice);
    const dev = (await b.post('/api/account/workspace', {})).json;
    const { b: b2 } = await signInUser(app, workos, alice);
    const dev2 = (await b2.post('/api/account/workspace/connect', {})).json;
    await b.del(`/api/account/devices/${dev2.deviceId}`);
    await browser(app).post('/api/account/auth/start', {}); // an abandoned sign-in
    const n = (table: string) => count(`SELECT COUNT(*) AS n FROM ${table}`);
    expect(await n('user_oauth_states')).toBe(1);
    const run = () => runScheduledJobs(deps, { cron: '17 * * * *', scheduledTime: clock.now.getTime() });
    clock.advance(11 * 60_000);
    expect((await run()).find((r) => r.name === 'accounts.cleanup')).toEqual({ name: 'accounts.cleanup', ok: true });
    expect(await n('user_oauth_states')).toBe(0);
    expect(await n('workspace_tokens')).toBe(2); // the revoked one is kept for 30 days (sign-out reason)
    expect(await n('user_sessions')).toBe(2);
    clock.advance(31 * DAY);
    await run();
    expect(await n('workspace_tokens')).toBe(1);
    expect(await n('user_sessions')).toBe(0); // idle past the timeout
    expect((await api(app).get('/api/v1/invoices', dev.token)).status).toBe(200); // the active device keeps syncing
  });

  it('keeps device tokens working when accounts are turned off; sign-out and the operator warning still work', async () => {
    const { app, workos, operator } = await accountsApp(d1.db);
    const { b } = await signInUser(app, workos, alice);
    const dev = (await b.post('/api/account/workspace', {})).json;
    const { b: b2 } = await signInUser(app, workos, alice);
    const dev2 = (await b2.post('/api/account/workspace/connect', {})).json;
    expect((await operator.put('/api/operator/settings/accounts.enabled', { value: false })).status).toBe(200);
    expect((await browser(app).get('/api/account/config')).json.enabled).toBe(false);
    expect((await b.get('/api/account/session')).status).toBe(404);
    expect((await api(app).get('/api/v1/invoices', dev.token)).status).toBe(200);
    expect((await operator.get('/api/operator/accounts')).json).toMatchObject({ enabled: false, linkedWorkspaces: 1 });
    expect((await browser(app).post('/api/account/sign-out', undefined, { headers: bearer(dev2.token) })).status).toBe(204);
    expect((await api(app).get('/api/v1/invoices', dev2.token)).status).toBe(401);
    expect((await api(app).get('/api/v1/invoices', dev.token)).status).toBe(200);
  });
});
