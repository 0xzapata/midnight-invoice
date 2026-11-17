/**
 * Minimal typed WorkOS User Management (AuthKit) client over fetch.
 *
 * `@workos-inc/node` (v12) does ship a workerd build, but the console needs
 * three calls; this ~100-line client avoids ~550 KB of unminified SDK in the
 * Worker bundle and lets tests fake WorkOS at the fetch boundary.
 * Endpoints: GET /user_management/authorize (browser redirect),
 * POST /user_management/authenticate (code + PKCE verifier),
 * GET /user_management/users (credential check), GET /sso/jwks/:clientId (client check).
 */
import { OperatorError } from './errors';

export const WORKOS_API_BASE_URL = 'https://api.workos.com';

export interface WorkosUser {
  id: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
}

export interface WorkosClientOptions {
  apiKey: string;
  clientId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createWorkosClient(opts: WorkosClientOptions) {
  const base = (opts.baseUrl ?? WORKOS_API_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw OperatorError.upstream('WorkOS could not be reached.');
    }
  }

  return {
    authorizationUrl(p: { redirectUri: string; state: string; codeChallenge: string; screenHint?: 'sign-up' | 'sign-in'; loginHint?: string }): string {
      const url = new URL(`${base}/user_management/authorize`);
      url.searchParams.set('client_id', opts.clientId);
      url.searchParams.set('redirect_uri', p.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('provider', 'authkit');
      url.searchParams.set('state', p.state);
      url.searchParams.set('code_challenge', p.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      if (p.screenHint) url.searchParams.set('screen_hint', p.screenHint);
      if (p.loginHint) url.searchParams.set('login_hint', p.loginHint);
      return url.toString();
    },

    /** Exchanges an authorization code (confidential client + PKCE). */
    async authenticateWithCode(code: string, codeVerifier: string): Promise<{ user: WorkosUser; authenticationMethod: string | null }> {
      const res = await call('/user_management/authenticate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: opts.clientId,
          client_secret: opts.apiKey,
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw OperatorError.unauthenticated('WorkOS rejected the sign-in. Start again.');
      const body = (await res.json()) as {
        user?: { id?: unknown; email?: unknown; email_verified?: unknown; first_name?: unknown; last_name?: unknown };
        authentication_method?: unknown;
      };
      const u = body.user;
      if (!u || typeof u.id !== 'string' || typeof u.email !== 'string') throw OperatorError.upstream('Unexpected response from WorkOS.');
      return {
        user: {
          id: u.id,
          email: u.email.toLowerCase(),
          emailVerified: u.email_verified === true,
          firstName: typeof u.first_name === 'string' ? u.first_name : null,
          lastName: typeof u.last_name === 'string' ? u.last_name : null,
        },
        authenticationMethod: typeof body.authentication_method === 'string' ? body.authentication_method : null,
      };
    },

    /** Validates the API key and client ID with real (read-only) calls. Returns a list of problems. */
    async validateCredentials(): Promise<string[]> {
      const problems: string[] = [];
      const users = await call('/user_management/users?limit=1', { headers: { authorization: `Bearer ${opts.apiKey}`, accept: 'application/json' } });
      if (users.status === 401 || users.status === 403) problems.push('WorkOS rejected the API key.');
      else if (!users.ok) problems.push(`WorkOS returned ${users.status} for the API key check.`);
      const jwks = await call(`/sso/jwks/${encodeURIComponent(opts.clientId)}`, { headers: { accept: 'application/json' } });
      if (!jwks.ok) problems.push('WorkOS does not know this client ID.');
      return problems;
    },
  };
}

export type WorkosClient = ReturnType<typeof createWorkosClient>;

/** PKCE (RFC 7636) S256 pair. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = (u: Uint8Array) => {
    let s = '';
    for (const b of u) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const verifier = b64(bytes);
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
