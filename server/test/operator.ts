/**
 * Operator-console test helpers: an app with operator deps, a cookie-aware
 * client, and fakes for WorkOS and GitHub at the fetch boundary (no network).
 */
import { createApp } from '../app';
import { defaultDeps, type AppConfig, type AppDeps } from '../deps';
import { telemetryOf } from '../operator';
import { BASE, TestClock, readPublicAsset } from './helpers';

export const INITIAL_PASSWORD = 'initial-Password-For-Tests-0123456789';
export const WORKOS_API_KEY = 'sk_test_operator_key_1234567890';
export const WORKOS_CLIENT_ID = 'client_test_operator';
export const GITHUB_TOKEN = 'github_pat_test_token_ABCDEFGHIJ';

export interface FakeUser {
  id: string;
  email: string;
  emailVerified?: boolean;
}

/** In-memory WorkOS User Management: authorize → code (bound to PKCE challenge) → authenticate. */
export function fakeWorkos() {
  const codes = new Map<string, { user: FakeUser; challenge: string; redirectUri: string }>();
  const calls: { method: string; url: string; body?: unknown; auth?: string | null }[] = [];
  let counter = 0;
  const fake = {
    calls,
    /** What the hosted AuthKit page does after the user signs in: returns the callback URL. */
    async completeAuthorize(authorizationUrl: string, user: FakeUser): Promise<{ code: string; state: string; callback: string }> {
      const url = new URL(authorizationUrl);
      const code = `code_${++counter}`;
      codes.set(code, { user, challenge: url.searchParams.get('code_challenge')!, redirectUri: url.searchParams.get('redirect_uri')! });
      const state = url.searchParams.get('state')!;
      const cb = new URL(url.searchParams.get('redirect_uri')!);
      cb.searchParams.set('code', code);
      cb.searchParams.set('state', state);
      return { code, state, callback: cb.pathname + cb.search };
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const text = req.method === 'POST' ? await req.text() : undefined;
      calls.push({ method: req.method, url: req.url, body: text ? JSON.parse(text) : undefined, auth: req.headers.get('authorization') });
      if (url.hostname !== 'api.workos.com') return new Response('not found', { status: 404 });
      if (url.pathname === '/user_management/users') {
        return req.headers.get('authorization') === `Bearer ${WORKOS_API_KEY}`
          ? Response.json({ object: 'list', data: [] })
          : Response.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (url.pathname.startsWith('/sso/jwks/')) {
        return url.pathname.endsWith(WORKOS_CLIENT_ID) ? Response.json({ keys: [] }) : Response.json({ message: 'Not found' }, { status: 404 });
      }
      if (url.pathname === '/user_management/authenticate' && req.method === 'POST') {
        const body = JSON.parse(text!) as Record<string, string>;
        if (body.client_secret !== WORKOS_API_KEY || body.client_id !== WORKOS_CLIENT_ID) return Response.json({ error: 'invalid_client' }, { status: 401 });
        const entry = codes.get(body.code);
        if (!entry) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier ?? '')));
        let b = '';
        for (const x of digest) b += String.fromCharCode(x);
        const challenge = btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        if (challenge !== entry.challenge) return Response.json({ error: 'invalid_grant', error_description: 'PKCE' }, { status: 400 });
        codes.delete(body.code);
        return Response.json({
          user: { object: 'user', id: entry.user.id, email: entry.user.email, email_verified: entry.user.emailVerified ?? true, first_name: null, last_name: null },
          access_token: 'eyJ.fake.token',
          refresh_token: 'refresh_fake',
          authentication_method: 'Passkey',
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch,
  };
  return fake;
}

/** GitHub Actions double: records dispatches, lists runs. */
export function fakeGithub() {
  const dispatches: { url: string; body: unknown; auth: string | null; version: string | null }[] = [];
  return {
    dispatches,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (req.headers.get('authorization') !== `Bearer ${GITHUB_TOKEN}`) return Response.json({ message: 'Bad credentials' }, { status: 401 });
      const m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)\/(dispatches|runs)$/.exec(url.pathname);
      if (!m) return Response.json({ message: 'Not Found' }, { status: 404 });
      if (m[4] === 'dispatches' && req.method === 'POST') {
        dispatches.push({ url: req.url, body: await req.json(), auth: req.headers.get('authorization'), version: req.headers.get('x-github-api-version') });
        return new Response(null, { status: 204 });
      }
      return Response.json({
        total_count: dispatches.length,
        workflow_runs: dispatches.map((_, i) => ({
          id: 1000 + i,
          status: 'queued',
          conclusion: null,
          created_at: '2026-11-17T10:00:00Z',
          updated_at: '2026-11-17T10:00:00Z',
          html_url: `https://github.com/${m[1]}/${m[2]}/actions/runs/${1000 + i}`,
          head_sha: 'abc123',
          head_branch: 'main',
          event: 'workflow_dispatch',
          display_title: 'Deploy',
          actor: { login: 'operator' },
        })),
      });
    }) as typeof fetch,
  };
}

/** Routes outbound fetches by host to the given fakes. */
export function routeFetch(routes: Record<string, typeof fetch>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    const handler = routes[host];
    if (!handler) throw new Error(`Unexpected network call to ${host}`);
    return handler(input, init);
  }) as typeof fetch;
}

export interface OperatorAppOptions {
  initialPassword?: string;
  encryptionKey?: string;
  clock?: TestClock;
  fetch?: typeof fetch;
  config?: Partial<AppConfig>;
  overrides?: Partial<Omit<AppDeps, 'db' | 'config' | 'operator'>>;
  /** Records the delays of bootstrap/recovery attempts instead of waiting (security fix L5). */
  sleep?: (ms: number) => Promise<void>;
}

export function buildOperatorApp(db: D1Database, opts: OperatorAppOptions = {}) {
  const logged: { message: string; error: unknown }[] = [];
  const clock = opts.clock ?? new TestClock();
  const deps = defaultDeps({
    db,
    readAsset: readPublicAsset,
    clock: clock.fn,
    logError: (message, error) => logged.push({ message, error }),
    config: opts.config,
    operator: {
      initialPassword: opts.initialPassword === undefined ? INITIAL_PASSWORD : opts.initialPassword || undefined,
      encryptionKey: opts.encryptionKey,
      fetch: opts.fetch,
      telemetryFlushDelayMs: 0,
      sleep: opts.sleep ?? (async () => undefined),
      build: { sha: 'deadbeef1234', time: '2026-11-17T09:00:00.000Z' },
      versionMetadata: { id: 'ver-1', tag: 'v1', timestamp: '2026-11-17T09:00:00Z' },
    },
    ...opts.overrides,
  });
  const app = createApp(deps);
  return { app, deps, clock, logged, telemetry: telemetryOf(app)! };
}

type App = ReturnType<typeof createApp>;

/** A browser-like client: keeps cookies, sends Origin, adds the CSRF header once known. */
export function browser(app: App) {
  const jar = new Map<string, string>();
  let csrf: string | null = null;
  const responses: { url: string; status: number; text: string; headers: Headers }[] = [];
  const call = async (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; noCsrf?: boolean; noOrigin?: boolean } = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (!opts.noOrigin) headers.origin ??= BASE;
    if (csrf && !opts.noCsrf) headers['x-csrf-token'] ??= csrf;
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await app.request(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
      if (value === '' || (maxAge && Number(maxAge.split('=')[1]) <= 0)) jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    const text = await res.text();
    let json: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped response bodies in tests
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (json && typeof json.csrfToken === 'string') csrf = json.csrfToken;
    responses.push({ url: path, status: res.status, text, headers: res.headers });
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    jar,
    responses,
    get csrf() {
      return csrf;
    },
    set csrf(v: string | null) {
      csrf = v;
    },
    call,
    get: (p: string, h?: Record<string, string>) => call('GET', p, { headers: h }),
    post: (p: string, body?: unknown, o: { headers?: Record<string, string>; noCsrf?: boolean; noOrigin?: boolean } = {}) => call('POST', p, { body, ...o }),
    put: (p: string, body?: unknown) => call('PUT', p, { body }),
    del: (p: string, body?: unknown) => call('DELETE', p, { body }),
    /** Refreshes the CSRF token from /session. */
    async session() {
      return call('GET', '/api/operator/session');
    },
  };
}

export type Browser = ReturnType<typeof browser>;

/** Runs the whole first-run wizard and returns the signed-in browser. */
export async function completeSetup(app: App, workos: ReturnType<typeof fakeWorkos>, user: FakeUser = { id: 'user_op1', email: 'owner@example.com' }) {
  const b = browser(app);
  const login = await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
  if (login.status !== 200) throw new Error(`bootstrap login failed: ${login.status} ${login.text}`);
  const enc = await b.post('/api/operator/setup/encryption', { mode: 'generate' });
  if (enc.status !== 200) throw new Error(`encryption failed: ${enc.status} ${enc.text}`);
  const recoveryKey = enc.json.recoveryKey as string;
  const confirm = await b.post('/api/operator/setup/encryption/confirm', { saved: true });
  if (confirm.status !== 200) throw new Error(`confirm failed: ${confirm.status} ${confirm.text}`);
  const wo = await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: WORKOS_CLIENT_ID });
  if (wo.status !== 200) throw new Error(`workos failed: ${wo.status} ${wo.text}`);
  const start = await b.post('/api/operator/setup/identity', {});
  if (start.status !== 200) throw new Error(`identity failed: ${start.status} ${start.text}`);
  const { callback } = await workos.completeAuthorize(start.json.authorizationUrl, user);
  const cb = await b.get(callback);
  if (cb.status !== 303 || cb.headers.get('location') !== '/operator') throw new Error(`callback failed: ${cb.status} ${cb.headers.get('location')}`);
  const s = await b.session();
  if (s.status !== 200 || s.json.kind !== 'full') throw new Error(`session failed: ${s.status} ${s.text}`);
  return { browser: b, recoveryKey, user };
}

/** Signs an existing operator in through AuthKit (after setup). */
export async function signIn(app: App, workos: ReturnType<typeof fakeWorkos>, user: FakeUser) {
  const b = browser(app);
  const start = await b.post('/api/operator/auth/login');
  if (start.status !== 200) return { browser: b, status: start.status, location: null as string | null };
  const { callback } = await workos.completeAuthorize(start.json.authorizationUrl, user);
  const cb = await b.get(callback);
  if (cb.headers.get('location') === '/operator') await b.session();
  return { browser: b, status: cb.status, location: cb.headers.get('location') };
}
