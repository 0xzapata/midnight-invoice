/**
 * Test helpers for the OAuth authorization server: register a client, run
 * the authorization request, approve it the way the consent screen does
 * (POST with the workspace token) and exchange the code.
 */
import { s256 } from '../oauth/pkce';
import { BASE, type Api } from './helpers';

export const REDIRECT = 'http://127.0.0.1:53682/callback';
export const RESOURCE = `${BASE}/api/mcp`;
export const VERIFIER = 'v'.repeat(20) + '-._~' + 'A1b2C3d4e5F6g7H8i9J0k'; // 45 chars

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

export async function registerClient(client: Api, overrides: Record<string, unknown> = {}) {
  const res = await client.post('/api/oauth/register', {
    client_name: 'Test MCP Client',
    redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return res.json as { client_id: string; redirect_uris: string[] };
}

export interface AuthorizeParams {
  client_id: string;
  redirect_uri?: string | null;
  scope?: string | null;
  state?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  resource?: string | null;
  response_type?: string | null;
  [key: string]: string | null | undefined;
}

export async function authorizeUrl(p: AuthorizeParams, verifier = VERIFIER): Promise<string> {
  const params = new URLSearchParams();
  const values: Record<string, string | null | undefined> = {
    response_type: 'code',
    redirect_uri: REDIRECT,
    state: 'st-123',
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
    resource: RESOURCE,
    ...p,
  };
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) params.set(k, v);
  return `/api/oauth/authorize?${params}`;
}

/** GET /authorize and return the Location header (parsed). */
export async function authorize(app: App, p: AuthorizeParams, verifier?: string): Promise<URL> {
  const res = await app.request(`${BASE}${await authorizeUrl(p, verifier)}`, { redirect: 'manual' });
  if (res.status !== 302) throw new Error(`authorize: expected 302, got ${res.status} ${await res.text()}`);
  return new URL(res.headers.get('location')!);
}

/** The pending request id from a redirect to the consent screen. */
export function requestIdOf(location: URL): string {
  if (location.pathname !== '/agents/authorize') throw new Error(`not the consent screen: ${location.href}`);
  const id = location.searchParams.get('request');
  if (!id) throw new Error(`no request id: ${location.href} (error=${location.searchParams.get('error')})`);
  return id;
}

export function tokenRequest(app: App, form: Record<string, string>, headers: Record<string, string> = {}) {
  return app.request(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
}

/** Runs register (optional) → authorize → approve → token and returns everything. */
export async function connectOAuth(
  app: App,
  client: Api,
  workspaceToken: string,
  opts: { scope?: string; approve?: string[]; clientId?: string } = {},
) {
  const clientId = opts.clientId ?? (await registerClient(client)).client_id;
  const location = await authorize(app, { client_id: clientId, scope: opts.scope ?? null });
  const requestId = requestIdOf(location);
  const decision = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, opts.approve ? { scopes: opts.approve } : undefined, workspaceToken);
  if (decision.status !== 200) throw new Error(`approve failed: ${decision.status} ${decision.text}`);
  const redirect = new URL(decision.json.redirectTo);
  const code = redirect.searchParams.get('code')!;
  const res = await tokenRequest(app, {
    grant_type: 'authorization_code',
    code,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
    client_id: clientId,
    resource: RESOURCE,
  });
  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; scope: string; expires_in: number; token_type: string };
  if (res.status !== 200) throw new Error(`token failed: ${res.status} ${JSON.stringify(tokens)}`);
  return { clientId, requestId, code, redirect, tokens };
}
