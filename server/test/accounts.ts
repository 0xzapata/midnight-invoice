/**
 * User-account test helpers: an operator-configured app (wizard completed,
 * WorkOS faked at the fetch boundary) with accounts switched on, and
 * browser-like clients that sign users in through the fake AuthKit.
 */
import { browser, buildOperatorApp, completeSetup, fakeWorkos, routeFetch, type Browser, type FakeUser, type OperatorAppOptions } from './operator';

export type App = ReturnType<typeof buildOperatorApp>['app'];

/** WorkOS double that can also answer `email_verification_required` for chosen users. */
export function accountsWorkos() {
  const workos = fakeWorkos();
  const pendingVerification = new Set<string>();
  const codeUsers = new Map<string, FakeUser>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (new URL(req.url).pathname === '/user_management/authenticate' && req.method === 'POST') {
      const body = (await req.clone().json()) as { code?: string };
      const user = body.code ? codeUsers.get(body.code) : undefined;
      if (user && pendingVerification.has(user.id)) {
        return Response.json(
          { code: 'email_verification_required', message: 'Email ownership must be verified before authentication.', email: user.email, pending_authentication_token: 'pat_x' },
          { status: 403 },
        );
      }
    }
    return workos.fetch(req);
  }) as typeof fetch;
  return {
    ...workos,
    pendingVerification,
    fetch: fetchImpl,
    async completeAuthorize(url: string, user: FakeUser) {
      const r = await workos.completeAuthorize(url, user);
      codeUsers.set(r.code, user);
      return r;
    },
  };
}

export type AccountsWorkos = ReturnType<typeof accountsWorkos>;

export async function accountsApp(db: D1Database, opts: OperatorAppOptions & { enable?: boolean; workos?: AccountsWorkos } = {}) {
  const workos = opts.workos ?? accountsWorkos();
  const built = buildOperatorApp(db, { fetch: routeFetch({ 'api.workos.com': workos.fetch }), ...opts });
  const { browser: operator } = await completeSetup(built.app, workos, { id: 'user_operator', email: 'operator@example.com' });
  if (opts.enable !== false) {
    const res = await operator.put('/api/operator/settings/accounts.enabled', { value: true });
    if (res.status !== 200) throw new Error(`enable accounts failed: ${res.status} ${res.text}`);
  }
  return { ...built, workos, operator };
}

export const alice: FakeUser = { id: 'user_alice', email: 'alice@example.com' };
export const bob: FakeUser = { id: 'user_bob', email: 'bob@example.com' };

/** Runs start → AuthKit → callback in `b` (a fresh browser by default). */
export async function signInUser(app: App, workos: AccountsWorkos, user: FakeUser, b: Browser = browser(app), returnTo?: string) {
  const start = await b.post('/api/account/auth/start', returnTo === undefined ? {} : { returnTo });
  if (start.status !== 200) throw new Error(`start failed: ${start.status} ${start.text}`);
  const { callback } = await workos.completeAuthorize(start.json.authorizationUrl, user);
  const cb = await b.get(callback);
  const session = await b.get('/api/account/session');
  return { b, start, cb, location: cb.headers.get('location'), session };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
