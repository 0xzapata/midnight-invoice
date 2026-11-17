/**
 * Interop: the official MCP client SDK's own OAuth support
 * (@modelcontextprotocol/client: auth(), StreamableHTTPClientTransport with an
 * OAuthClientProvider) drives discovery → registration → authorization →
 * token → tools/list against this server. Only the browser step is
 * simulated: following the authorization URL and approving on the consent
 * API exactly as the consent screen does. Everything else (RFC 9728/8414
 * discovery, issuer and `iss` validation, PKCE, resource indicators, DCR or
 * Client ID Metadata Documents, refresh) is the SDK's logic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import { api, buildApp, createWorkspace, startD1, TestClock } from './test/helpers';

const ORIGIN = 'https://invoices.example.com';
const MCP_URL = new URL(`${ORIGIN}/api/mcp`);
const REDIRECT = 'http://127.0.0.1:43117/oauth/callback';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

/** In-memory OAuthClientProvider, as a CLI client with a loopback redirect would implement it. */
class MemoryProvider implements OAuthClientProvider {
  info?: StoredOAuthClientInformation;
  stored?: StoredOAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
  authorizationUrls: URL[] = [];
  constructor(readonly clientMetadataUrl?: string) {}
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'SDK Interop Client', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' };
  }
  state() {
    return 'sdk-state-42';
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: StoredOAuthClientInformation) {
    this.info = info;
  }
  tokens() {
    return this.stored;
  }
  saveTokens(tokens: StoredOAuthTokens) {
    this.stored = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrls.push(url);
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    if (!this.verifier) throw new Error('no verifier');
    return this.verifier;
  }
  saveDiscoveryState(s: OAuthDiscoveryState) {
    this.discovery = s;
  }
  discoveryState() {
    return this.discovery;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens') this.stored = undefined;
    if (scope === 'all' || scope === 'client') this.info = undefined;
  }
}

type Mode = 'legacy' | 'modern';

function setup(outboundFetch?: typeof fetch) {
  const clock = new TestClock();
  const requests: string[] = [];
  const { app } = buildApp(d1.db, { clock: clock.fn, config: { appUrl: ORIGIN }, outboundFetch });
  const appFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push(`${req.method} ${new URL(req.url).pathname}`);
    return Promise.resolve(app.fetch(req));
  };
  return { app, clock, requests, appFetch, client: api(app) };
}

function connect(env: ReturnType<typeof setup>, provider: MemoryProvider, mode: Mode) {
  const transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider, fetch: appFetch(env) });
  const client = new Client({ name: 'sdk-interop', version: '1.0.0' }, mode === 'modern' ? { versionNegotiation: { mode: 'auto' } } : {});
  return { transport, client, done: client.connect(transport) };
}
const appFetch = (env: ReturnType<typeof setup>) => env.appFetch as typeof fetch;

/** The browser step: open the authorization URL, land on the consent screen, approve with the workspace token. */
async function approveInBrowser(env: ReturnType<typeof setup>, authorizationUrl: URL, workspaceToken: string, scopes?: string[]) {
  const res = await env.app.fetch(new Request(authorizationUrl, { redirect: 'manual' }));
  expect(res.status).toBe(302);
  const consent = new URL(res.headers.get('location')!);
  expect(consent.origin + consent.pathname).toBe(`${ORIGIN}/agents/authorize`);
  const requestId = consent.searchParams.get('request')!;
  const decision = await env.client.post(`/api/v1/oauth/requests/${requestId}/approve`, scopes ? { scopes } : undefined, workspaceToken);
  expect(decision.status).toBe(200);
  const callback = new URL(decision.json.redirectTo);
  expect(callback.origin + callback.pathname).toBe(REDIRECT);
  return callback;
}

describe.each<Mode>(['legacy', 'modern'])('official MCP client SDK OAuth flow (%s protocol)', (mode) => {
  it('discovers, registers (DCR), authorizes with PKCE, exchanges the code, lists tools and refreshes', async () => {
    const env = setup();
    const ws = await createWorkspace(env.client);
    const provider = new MemoryProvider();

    // 1. Unauthenticated connect: 401 → discovery → registration → redirect.
    const first = connect(env, provider, mode);
    await expect(first.done).rejects.toBeInstanceOf(UnauthorizedError);
    expect(env.requests).toEqual(
      expect.arrayContaining([
        'POST /api/mcp',
        'GET /.well-known/oauth-protected-resource/api/mcp',
        'GET /.well-known/oauth-authorization-server',
        'POST /api/oauth/register',
      ]),
    );
    expect(provider.info?.client_id).toMatch(/^mi_client_/);
    expect(provider.authorizationUrls).toHaveLength(1);
    const authUrl = provider.authorizationUrls[0];
    expect(authUrl.origin + authUrl.pathname).toBe(`${ORIGIN}/api/oauth/authorize`);
    expect(Object.fromEntries(authUrl.searchParams)).toMatchObject({
      response_type: 'code',
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT,
      state: 'sdk-state-42',
      resource: `${ORIGIN}/api/mcp`,
      // Scope selection strategy: all of scopes_supported from the protected-resource metadata.
      scope: 'invoices:read invoices:write invoices:delete settings:read clients:read clients:write',
    });

    // 2. The user approves a narrower set on the consent screen.
    const callback = await approveInBrowser(env, authUrl, ws.token, ['invoices:read', 'clients:read']);
    expect(callback.searchParams.get('state')).toBe('sdk-state-42');
    expect(callback.searchParams.get('iss')).toBe(ORIGIN);

    // 3. The SDK validates iss (RFC 9207) and redeems the code with its verifier.
    await first.transport.finishAuth(callback.searchParams);
    expect(provider.stored).toMatchObject({ token_type: 'Bearer', scope: 'invoices:read clients:read' });
    expect(provider.stored?.access_token).toMatch(/^mi_at_/);
    const firstRefresh = provider.stored?.refresh_token;
    expect(firstRefresh).toMatch(/^mi_rt_/);

    // 4. Authorized: only the approved scopes' tools are visible.
    const second = connect(env, provider, mode);
    await second.done;
    const tools = (await second.client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['get_client', 'get_invoice', 'get_invoice_pdf', 'get_invoice_summary', 'get_next_invoice_number', 'list_clients', 'list_invoices']);
    const listed = await second.client.callTool({ name: 'list_invoices', arguments: {} });
    expect(listed.isError).toBeFalsy();
    await second.client.close();

    // 5. An hour later the access token is expired: the SDK refreshes on the 401 by itself (rotation).
    env.clock.advance(61 * 60 * 1000);
    const third = connect(env, provider, mode);
    await third.done;
    expect((await third.client.listTools()).tools.length).toBe(7);
    expect(provider.stored?.refresh_token).toMatch(/^mi_rt_/);
    expect(provider.stored?.refresh_token).not.toBe(firstRefresh);
    await third.client.close();

    // 6. The user revokes the agent in the app: tokens die, refresh fails, the SDK falls back to a new authorization.
    const agents = (await env.client.get('/api/v1/agents', ws.token)).json.agents;
    expect(agents).toEqual([expect.objectContaining({ name: 'SDK Interop Client', connection: 'oauth', scopes: ['invoices:read', 'clients:read'] })]);
    expect((await env.client.del(`/api/v1/agents/${agents[0].id}`, ws.token)).status).toBe(204);
    const fourth = connect(env, provider, mode);
    await expect(fourth.done).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.authorizationUrls).toHaveLength(2);
  });

  it('uses a Client ID Metadata Document instead of registering when the client has one', async () => {
    const DOC = 'https://client.example.net/mcp/oauth-client.json';
    const outbound = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(DOC);
      return Response.json({
        client_id: DOC,
        client_name: 'Hosted Connector (CIMD)',
        redirect_uris: [REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      });
    }) as typeof fetch;
    const env = setup(outbound);
    const ws = await createWorkspace(env.client);
    const provider = new MemoryProvider(DOC);

    const first = connect(env, provider, mode);
    await expect(first.done).rejects.toBeInstanceOf(UnauthorizedError);
    expect(env.requests).not.toContain('POST /api/oauth/register');
    expect(provider.info?.client_id).toBe(DOC);
    const callback = await approveInBrowser(env, provider.authorizationUrls[0], ws.token);
    await first.transport.finishAuth(callback.searchParams);

    const second = connect(env, provider, mode);
    await second.done;
    expect((await second.client.listTools()).tools.map((t) => t.name)).toContain('delete_invoice');
    await second.client.close();
    const agents = (await env.client.get('/api/v1/agents', ws.token)).json.agents;
    expect(agents[0]).toMatchObject({ name: 'Hosted Connector (CIMD)', connection: 'oauth' });
  });

  it('a denied request surfaces as access_denied in the SDK', async () => {
    const env = setup();
    const ws = await createWorkspace(env.client);
    const provider = new MemoryProvider();
    const first = connect(env, provider, mode);
    await expect(first.done).rejects.toBeInstanceOf(UnauthorizedError);
    const res = await env.app.fetch(new Request(provider.authorizationUrls[0], { redirect: 'manual' }));
    const requestId = new URL(res.headers.get('location')!).searchParams.get('request')!;
    const denied = await env.client.post(`/api/v1/oauth/requests/${requestId}/deny`, undefined, ws.token);
    const callback = new URL(denied.json.redirectTo);
    await expect(first.transport.finishAuth(callback.searchParams)).rejects.toMatchObject({ code: 'access_denied' });
  });
});
