import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createWorkspace, connectAgent, startD1, TestClock } from '../test/helpers';
import { GLOBAL_DELAY } from './auth';
import {
  INITIAL_PASSWORD,
  WORKOS_API_KEY,
  WORKOS_CLIENT_ID,
  browser,
  buildOperatorApp,
  completeSetup,
  fakeWorkos,
  routeFetch,
  signIn,
} from '../test/operator';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

/** Each test starts from an empty operator state. */
async function resetOperator() {
  await d1.db.batch(
    [
      'DELETE FROM operator_sessions',
      'DELETE FROM operators',
      'DELETE FROM operator_oauth_states',
      'DELETE FROM operator_login_attempts',
      'DELETE FROM operator_settings',
      'DELETE FROM operator_audit',
      'DELETE FROM operator_state',
      'DELETE FROM workspace_suspensions',
      'DELETE FROM workspaces',
    ].map((sql) => d1.db.prepare(sql)),
  );
}

function setup(opts: Parameters<typeof buildOperatorApp>[1] = {}) {
  const workos = fakeWorkos();
  const built = buildOperatorApp(d1.db, { fetch: routeFetch({ 'api.workos.com': workos.fetch }), ...opts });
  return { ...built, workos };
}

beforeEach(resetOperator);

describe('operator console availability', () => {
  it('is disabled with a clear 503 when INITIAL_PASSWORD is unset (no default password)', async () => {
    const { app } = setup({ initialPassword: '' });
    const b = browser(app);
    for (const [method, path, body] of [
      ['GET', '/api/operator/status'],
      ['POST', '/api/operator/bootstrap/login', { password: '' }],
      ['POST', '/api/operator/bootstrap/login', { password: 'admin' }],
      ['GET', '/api/operator/overview'],
    ] as const) {
      const res = await b.call(method, path, { body });
      expect(res.status, path).toBe(503);
      expect(res.json.error.code).toBe('operator_not_configured');
      expect(res.json.error.message).toMatch(/not configured/);
    }
  });

  it('reports the bootstrap phase on first run and sends noindex', async () => {
    const { app } = setup();
    const res = await browser(app).get('/api/operator/status');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ phase: 'bootstrap', encryptionLocked: false });
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('bootstrap login', () => {
  it('accepts INITIAL_PASSWORD and issues a setup-only, HttpOnly/Secure/Strict session cookie', async () => {
    const { app } = setup();
    const b = browser(app);
    const res = await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json.kind).toBe('setup');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Secure-mi_op_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/operator/);
    expect((await b.get('/api/operator/session')).json.kind).toBe('setup');
  });

  it('rejects a wrong password with a generic error and audits it', async () => {
    const { app } = setup();
    const res = await browser(app).post('/api/operator/bootstrap/login', { password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.json.error).toEqual({ code: 'invalid_credentials', message: 'Invalid credentials.' });
    const audit = await d1.db.prepare("SELECT action FROM operator_audit WHERE action = 'bootstrap.login_failed'").all();
    expect(audit.results).toHaveLength(1);
  });

  it('locks out an IP after 5 failures with exponential backoff, even for the right password', async () => {
    const clock = new TestClock();
    const { app } = setup({ clock });
    const b = browser(app);
    const h = { headers: { 'cf-connecting-ip': '203.0.113.7' } };
    for (let i = 0; i < 5; i++) expect((await b.post('/api/operator/bootstrap/login', { password: `bad${i}` }, h)).status).toBe(401);
    const locked = await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, h);
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('too_many_attempts');
    expect(Number(locked.headers.get('retry-after'))).toBe(60);
    // Another IP is unaffected.
    expect((await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, { headers: { 'cf-connecting-ip': '198.51.100.1' } })).status).toBe(200);
    // After the lock expires, five more failures lock for twice as long.
    clock.advance(61_000);
    for (let i = 0; i < 5; i++) await b.post('/api/operator/bootstrap/login', { password: `bad${i}` }, h);
    const again = await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, h);
    expect(again.status).toBe(429);
    expect(Number(again.headers.get('retry-after'))).toBe(120);
  });

  // Security fix L5: this used to be a hard global lock after 25 failures, which anyone could trigger to lock
  // the operator out of bootstrap and recovery. Across IPs, attempts are now slowed down, never refused.
  it('slows guessing across IPs down with a growing delay, but never locks the operator out', async () => {
    const delays: number[] = [];
    const { app } = setup({ sleep: async (ms) => void delays.push(ms) });
    const b = browser(app);
    for (let i = 0; i < GLOBAL_DELAY.threshold + 25; i++) {
      await b.post('/api/operator/bootstrap/login', { password: 'bad' }, { headers: { 'cf-connecting-ip': `192.0.${Math.floor(i / 200)}.${i % 200}` } });
    }
    expect(delays.length).toBe(25);
    expect(delays[0]).toBe(GLOBAL_DELAY.baseMs);
    expect(delays[delays.length - 1]).toBe(GLOBAL_DELAY.baseMs * 4);
    const res = await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, { headers: { 'cf-connecting-ip': '198.51.100.200' } });
    expect(res.status).toBe(200);
    expect(delays.length).toBe(26);
  });

  it('counts concurrent failures atomically (none is lost)', async () => {
    const { app } = setup();
    const b = browser(app);
    const h = { headers: { 'cf-connecting-ip': '203.0.113.99' } };
    await Promise.all(Array.from({ length: 4 }, (_, i) => b.post('/api/operator/bootstrap/login', { password: `bad${i}` }, h)));
    const row = await d1.db.prepare("SELECT failures FROM operator_login_attempts WHERE key = 'bootstrap:ip:203.0.113.99'").first<{ failures: number }>();
    expect(row?.failures).toBe(4);
    const g = await d1.db.prepare("SELECT failures FROM operator_login_attempts WHERE key = 'bootstrap:global'").first<{ failures: number }>();
    expect(g?.failures).toBe(4);
    // The fifth locks the IP.
    expect((await b.post('/api/operator/bootstrap/login', { password: 'bad' }, h)).status).toBe(401);
    expect((await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, h)).status).toBe(429);
  });

  it('refuses cross-origin login attempts', async () => {
    const { app } = setup();
    const res = await browser(app).post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD }, { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('csrf_failed');
  });
});

describe('setup-only session', () => {
  it('cannot reach any dashboard endpoint', async () => {
    const { app } = setup();
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    for (const [method, path] of [
      ['GET', '/api/operator/overview'],
      ['GET', '/api/operator/telemetry'],
      ['GET', '/api/operator/workspaces'],
      ['GET', '/api/operator/agents'],
      ['GET', '/api/operator/settings'],
      ['PUT', '/api/operator/settings/maintenance.enabled'],
      ['POST', '/api/operator/runtime/reload'],
      ['GET', '/api/operator/deployments'],
      ['POST', '/api/operator/deployments/redeploy'],
      ['GET', '/api/operator/audit'],
      ['GET', '/api/operator/security'],
      ['POST', '/api/operator/operators'],
      ['POST', '/api/operator/security/rotate-dek'],
    ] as const) {
      const res = await b.call(method, path, { body: method === 'GET' ? undefined : { value: true } });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error.code).toBe('operator_forbidden');
    }
  });

  it('expires after its absolute lifetime', async () => {
    const clock = new TestClock();
    const { app } = setup({ clock });
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    for (let i = 0; i < 3; i++) {
      clock.advance(10 * 60_000);
      if (i < 2) expect((await b.get('/api/operator/setup')).status).toBe(200);
    }
    expect((await b.get('/api/operator/setup')).status).toBe(401);
  });

  it('expires after 15 minutes idle', async () => {
    const clock = new TestClock();
    const { app } = setup({ clock });
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    clock.advance(16 * 60_000);
    expect((await b.get('/api/operator/setup')).status).toBe(401);
  });
});

describe('wizard', () => {
  it('walks encryption → confirm → WorkOS → identity in order', async () => {
    const { app } = setup();
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    expect((await b.get('/api/operator/setup')).json.step).toBe('encryption');
    // Steps out of order are refused.
    expect((await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: WORKOS_CLIENT_ID })).status).toBe(409);
    const enc = await b.post('/api/operator/setup/encryption', { mode: 'generate' });
    expect(enc.json.recoveryKey).toMatch(/^mi_mk_[A-Za-z0-9_-]{43}$/);
    const state = await b.get('/api/operator/setup');
    expect(state.json.step).toBe('encryption_confirm');
    expect(state.text).not.toContain(enc.json.recoveryKey);
    // Until confirmed, the key may be regenerated (the old one was never used).
    const enc2 = await b.post('/api/operator/setup/encryption', { mode: 'generate' });
    expect(enc2.json.recoveryKey).not.toBe(enc.json.recoveryKey);
    expect((await b.post('/api/operator/setup/encryption/confirm', { saved: false })).status).toBe(400);
    expect((await b.post('/api/operator/setup/encryption/confirm', { saved: true })).json.step).toBe('workos');
    // Once confirmed the key is never produced again.
    expect((await b.post('/api/operator/setup/encryption', { mode: 'generate' })).status).toBe(409);
    const st = await b.get('/api/operator/setup');
    expect(st.json.workos.redirectUri).toBe('http://app.test/api/operator/auth/callback');
  });

  it('enforces passphrase strength', async () => {
    const { app } = setup();
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    for (const weak of ['short', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'alllowercaseletters', INITIAL_PASSWORD]) {
      const res = await b.post('/api/operator/setup/encryption', { mode: 'passphrase', passphrase: weak });
      expect(res.status, weak).toBe(400);
    }
    const ok = await b.post('/api/operator/setup/encryption', { mode: 'passphrase', passphrase: 'Correct-Horse-Battery-Staple-42' });
    expect(ok.status).toBe(200);
    expect(ok.json.recoveryKey).toMatch(/^mi_mk_/);
  });

  it('validates WorkOS credentials with a real call before saving', async () => {
    const { app, workos } = setup();
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    await b.post('/api/operator/setup/encryption', { mode: 'generate' });
    await b.post('/api/operator/setup/encryption/confirm', { saved: true });
    const bad = await b.post('/api/operator/setup/workos', { apiKey: 'sk_test_wrong', clientId: WORKOS_CLIENT_ID });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/rejected the API key/);
    expect((await b.get('/api/operator/setup')).json.step).toBe('workos');
    const good = await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: WORKOS_CLIENT_ID });
    expect(good.status).toBe(200);
    expect(good.json.step).toBe('identity');
    expect(workos.calls.some((c) => c.url.includes('/user_management/users') && c.auth === `Bearer ${WORKOS_API_KEY}`)).toBe(true);
    const row = await d1.db.prepare("SELECT value, value_enc FROM operator_settings WHERE key = 'workos.apiKey'").first<{ value: string | null; value_enc: string }>();
    expect(row!.value).toBeNull();
    expect(row!.value_enc).not.toContain(WORKOS_API_KEY);
  });

  it('completes with AuthKit, binds the operator and disables the bootstrap login for good', async () => {
    const { app, workos } = setup();
    const { browser: b, user } = await completeSetup(app, workos);
    const s = await b.get('/api/operator/session');
    expect(s.json).toMatchObject({ kind: 'full', operator: { email: user.email } });
    const op = await d1.db.prepare('SELECT workos_user_id, email FROM operators').all();
    expect(op.results).toEqual([{ workos_user_id: user.id, email: user.email }]);
    expect((await b.get('/api/operator/status')).json.phase).toBe('ready');

    // Bootstrap password no longer works, from any browser.
    const fresh = browser(app);
    const res = await fresh.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.json.error.message).toMatch(/disabled/);
    // And the wizard cannot be re-entered, even by the operator.
    expect((await b.get('/api/operator/setup')).status).toBe(403);
    expect((await b.post('/api/operator/setup/encryption', { mode: 'generate' })).status).toBe(403);
    const audit = await d1.db.prepare("SELECT action FROM operator_audit WHERE action = 'bootstrap.completed'").all();
    expect(audit.results).toHaveLength(1);
  });

  it('revokes outstanding setup sessions when setup completes', async () => {
    const { app, workos } = setup();
    const other = browser(app);
    await other.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    await completeSetup(app, workos);
    expect((await other.get('/api/operator/setup')).status).toBe(401);
  });
});

describe('AuthKit callback', () => {
  async function toIdentityStep() {
    const s = setup();
    const b = browser(s.app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    await b.post('/api/operator/setup/encryption', { mode: 'generate' });
    await b.post('/api/operator/setup/encryption/confirm', { saved: true });
    await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: WORKOS_CLIENT_ID });
    const start = await b.post('/api/operator/setup/identity', {});
    return { ...s, b, url: start.json.authorizationUrl as string };
  }

  it('sends PKCE S256, state and the redirect URI to AuthKit', async () => {
    const { url } = await toIdentityStep();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.workos.com/user_management/authorize');
    expect(u.searchParams.get('client_id')).toBe(WORKOS_CLIENT_ID);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('redirect_uri')).toBe('http://app.test/api/operator/auth/callback');
    expect(u.searchParams.get('provider')).toBe('authkit');
  });

  it('rejects an unknown or replayed state', async () => {
    const { b, workos, url } = await toIdentityStep();
    const { callback, code } = await workos.completeAuthorize(url, { id: 'user_x', email: 'x@example.com' });
    const forged = await b.get(`/api/operator/auth/callback?code=${code}&state=${'A'.repeat(43)}`);
    expect(forged.headers.get('location')).toBe('/operator?error=invalid_state');
    const ok = await b.get(callback);
    expect(ok.headers.get('location')).toBe('/operator');
    const replay = await b.get(callback);
    expect(replay.headers.get('location')).toBe('/operator?error=invalid_state');
  });

  it('rejects a callback in a browser that did not start the flow (nonce cookie)', async () => {
    const { app, workos, url } = await toIdentityStep();
    const { callback } = await workos.completeAuthorize(url, { id: 'user_x', email: 'x@example.com' });
    const attacker = browser(app);
    const res = await attacker.get(callback);
    expect(res.headers.get('location')).toBe('/operator?error=invalid_state');
    expect(await d1.db.prepare('SELECT COUNT(*) AS n FROM operators').first('n')).toBe(0);
  });

  it('fails when the PKCE verifier does not match (code exchanged with the stored verifier only)', async () => {
    const { b, workos, url } = await toIdentityStep();
    const tampered = new URL(url);
    tampered.searchParams.set('code_challenge', 'B'.repeat(43));
    const { callback } = await workos.completeAuthorize(tampered.toString(), { id: 'user_x', email: 'x@example.com' });
    const res = await b.get(callback);
    expect(res.headers.get('location')).toBe('/operator?error=authorization_failed');
  });

  it('rejects an expired state', async () => {
    const clock = new TestClock();
    const s = setup({ clock });
    const b = browser(s.app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    await b.post('/api/operator/setup/encryption', { mode: 'generate' });
    await b.post('/api/operator/setup/encryption/confirm', { saved: true });
    await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: WORKOS_CLIENT_ID });
    const start = await b.post('/api/operator/setup/identity', {});
    const { callback } = await s.workos.completeAuthorize(start.json.authorizationUrl, { id: 'u', email: 'u@example.com' });
    clock.advance(11 * 60_000);
    expect((await b.get(callback)).headers.get('location')).toBe('/operator?error=invalid_state');
  });

  it('passes an AuthKit error through as a generic failure', async () => {
    const { b, url } = await toIdentityStep();
    const state = new URL(url).searchParams.get('state');
    const res = await b.get(`/api/operator/auth/callback?error=access_denied&state=${state}`);
    expect(res.headers.get('location')).toBe('/operator?error=authorization_failed');
  });
});

describe('full sessions', () => {
  it('enforce CSRF: header and same origin are required for state changes', async () => {
    const { app, workos } = setup();
    const { browser: b } = await completeSetup(app, workos);
    expect((await b.post('/api/operator/runtime/reload', undefined, { noCsrf: true })).json.error.code).toBe('csrf_failed');
    expect((await b.post('/api/operator/runtime/reload', undefined, { headers: { 'x-csrf-token': 'nope' } })).status).toBe(403);
    expect((await b.post('/api/operator/runtime/reload', undefined, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await b.post('/api/operator/runtime/reload', undefined, { noOrigin: true, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await b.post('/api/operator/runtime/reload')).status).toBe(200);
    // GETs need no token.
    expect((await b.call('GET', '/api/operator/overview', { noCsrf: true })).status).toBe(200);
  });

  it('expire when idle and at the absolute timeout', async () => {
    const clock = new TestClock();
    const s = setup({ clock });
    const { browser: b, user } = await completeSetup(s.app, s.workos);
    clock.advance(31 * 60_000);
    expect((await b.get('/api/operator/overview')).status).toBe(401);
    const again = await signIn(s.app, s.workos, user);
    for (let i = 0; i < 25; i++) {
      clock.advance(29 * 60_000);
      const res = await again.browser.get('/api/operator/overview');
      if (res.status === 401) {
        expect(i * 29).toBeGreaterThanOrEqual(11 * 60);
        return;
      }
    }
    throw new Error('session never hit the absolute timeout');
  });

  it('are revoked by sign-out and by revoking from the session list', async () => {
    const { app, workos } = setup();
    const { browser: b, user } = await completeSetup(app, workos);
    const second = await signIn(app, workos, user);
    const list = await b.get('/api/operator/security');
    expect(list.json.sessions).toHaveLength(2);
    const other = list.json.sessions.find((x: { current: boolean }) => !x.current);
    expect((await b.del(`/api/operator/sessions/${other.id}`)).status).toBe(204);
    expect((await second.browser.get('/api/operator/overview')).status).toBe(401);
    expect((await b.post('/api/operator/logout')).status).toBe(204);
    expect((await b.get('/api/operator/overview')).status).toBe(401);
  });

  it('reject a tampered cookie signature', async () => {
    const { app, workos } = setup();
    const { browser: b } = await completeSetup(app, workos);
    const v = b.jar.get('__Secure-mi_op_session')!;
    b.jar.set('__Secure-mi_op_session', v.slice(0, -2) + (v.endsWith('A') ? 'BB' : 'AA'));
    expect((await b.get('/api/operator/overview')).status).toBe(401);
  });
});

describe('credential separation', () => {
  it('operator endpoints never accept workspace tokens or agent keys', async () => {
    const { app, workos } = setup();
    const { browser: b } = await completeSetup(app, workos);
    const client = api(app);
    const ws = await createWorkspace(client);
    const agent = await connectAgent(client, ws.token, ['invoices:read']);
    for (const token of [ws.token, agent.api_key]) {
      const res = await client.get('/api/operator/overview', token);
      expect(res.status).toBe(401);
      // Even with a valid operator cookie, an Authorization header is refused.
      const mixed = await b.get('/api/operator/overview', { authorization: `Bearer ${token}` });
      expect(mixed.status).toBe(401);
    }
  });

  it('public API never accepts the operator session cookie', async () => {
    const { app, workos } = setup();
    const { browser: b } = await completeSetup(app, workos);
    for (const path of ['/api/v1/workspace', '/api/v1/invoices', '/api/v1/agents']) {
      const res = await b.get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe('allowlist', () => {
  it('admits invited operators by verified email, refuses others, and keeps the last operator', async () => {
    const { app, workos } = setup();
    const { browser: owner, user } = await completeSetup(app, workos);

    const denied = await signIn(app, workos, { id: 'user_stranger', email: 'stranger@example.com' });
    expect(denied.location).toBe('/operator?error=not_an_operator');

    expect((await owner.post('/api/operator/operators', { email: 'Second@Example.com' })).status).toBe(201);
    expect((await owner.post('/api/operator/operators', { email: 'second@example.com' })).status).toBe(409);
    const unverified = await signIn(app, workos, { id: 'user_2', email: 'second@example.com', emailVerified: false });
    expect(unverified.location).toBe('/operator?error=not_an_operator');
    const second = await signIn(app, workos, { id: 'user_2', email: 'second@example.com' });
    expect(second.location).toBe('/operator');
    const sec = await owner.get('/api/operator/security');
    expect(sec.json.operators.map((o: { email: string; pending: boolean }) => [o.email, o.pending])).toEqual([
      [user.email, false],
      ['second@example.com', false],
    ]);

    // Remove the second operator: their sessions end.
    const secondId = sec.json.operators[1].id;
    expect((await owner.del(`/api/operator/operators/${secondId}`)).status).toBe(204);
    expect((await second.browser.get('/api/operator/overview')).status).toBe(401);
    // The last operator cannot be removed.
    const res = await owner.del(`/api/operator/operators/${sec.json.operators[0].id}`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('last_operator');
  });
});

describe('INITIAL_PASSWORD strength (security fix L4)', () => {
  it('refuses to enable the console with an INITIAL_PASSWORD shorter than 24 characters', async () => {
    const { app } = setup({ initialPassword: 'correct-horse-battery' });
    const b = browser(app);
    for (const [method, path, body] of [
      ['GET', '/api/operator/status'],
      ['POST', '/api/operator/bootstrap/login', { password: 'correct-horse-battery' }],
    ] as const) {
      const res = await b.call(method, path, { body });
      expect(res.status, path).toBe(503);
      expect(res.json.error).toMatchObject({ code: 'operator_not_configured', details: { reason: 'initial_password_too_short' } });
      expect(res.json.error.message).toMatch(/shorter than 24 characters/);
    }
    // User accounts depend on the console's encrypted store: unavailable too.
    expect((await api(app).get('/api/account/config')).json).toMatchObject({ enabled: false });
  });
});
