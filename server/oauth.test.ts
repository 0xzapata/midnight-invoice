import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { api, BASE, buildApp, connectAgent, countingLimiter, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';
import { authorize, authorizeUrl, connectOAuth, REDIRECT, registerClient, requestIdOf, RESOURCE, tokenRequest, VERIFIER } from './test/oauth';
import { s256 } from './oauth/pkce';
import { SCOPES } from '../shared/api';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

function setup(overrides: Parameters<typeof buildApp>[1] = {}) {
  const clock = new TestClock();
  const built = buildApp(d1.db, { clock: clock.fn, ...overrides });
  return { app: built.app, client: api(built.app), clock, errors: built.errors };
}

type App = ReturnType<typeof setup>['app'];

async function mcpClient(app: App, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'oauth-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const toolNames = async (app: App, token: string) => {
  const mcp = await mcpClient(app, token);
  const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
  await mcp.close();
  return names;
};

const rawMcp = (app: App, token?: string, base = BASE) =>
  app.request(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

const errorOf = (location: URL) => ({
  error: location.searchParams.get('error'),
  state: location.searchParams.get('state'),
  iss: location.searchParams.get('iss'),
  origin: location.origin + location.pathname,
});

describe('discovery', () => {
  it('serves protected-resource metadata at both RFC 9728 locations and authorization-server metadata', async () => {
    const { app } = setup();
    for (const path of ['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await app.request(`${BASE}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [BASE],
        // Every scope this API defines (clients pick from these; the user narrows on the consent screen).
        scopes_supported: [...SCOPES],
        bearer_methods_supported: ['header'],
        resource_name: 'Midnight Invoice',
        resource_documentation: `${BASE}/llms.txt`,
      });
    }
    const as = await app.request(`${BASE}/.well-known/oauth-authorization-server`);
    expect(as.status).toBe(200);
    const meta = (await as.json()) as Record<string, unknown>;
    expect(meta).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/api/oauth/authorize`,
      token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`,
      revocation_endpoint: `${BASE}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(meta.scopes_supported).not.toContain('offline_access');
    const preflight = await app.request(`${BASE}/.well-known/oauth-authorization-server`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
    // We are not an OpenID provider.
    expect((await app.request(`${BASE}/.well-known/openid-configuration`)).status).toBe(404);
  });

  it('uses APP_URL for every advertised URL', async () => {
    const { app } = setup({ config: { appUrl: 'https://invoices.example.org/' } });
    const prm = (await (await app.request(`${BASE}/.well-known/oauth-protected-resource/api/mcp`)).json()) as { resource: string; authorization_servers: string[] };
    expect(prm.resource).toBe('https://invoices.example.org/api/mcp');
    expect(prm.authorization_servers).toEqual(['https://invoices.example.org']);
  });

  it('answers unauthenticated and invalid MCP requests with a resource_metadata challenge', async () => {
    const { app } = setup();
    const none = await rawMcp(app);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(
      `Bearer realm="midnight-invoice", resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    for (const token of ['mi_at_bogus', 'mi_agent_bogus', 'mi_ws_bogus', 'garbage']) {
      const bad = await rawMcp(app, token);
      expect(bad.status, token).toBe(401);
      expect(bad.headers.get('www-authenticate'), token).toMatch(
        new RegExp(`^Bearer realm="midnight-invoice", error="invalid_token", error_description="[^"]+", resource_metadata="${BASE}/\\.well-known/oauth-protected-resource/api/mcp"$`),
      );
    }
  });
});

describe('dynamic client registration', () => {
  const register = (client: ReturnType<typeof setup>['client'], body: unknown) => client.post('/api/oauth/register', body);

  it('registers public clients and never issues a secret', async () => {
    const { client } = setup();
    const res = await register(client, {
      client_name: '  Claude‮ Desktop  ',
      redirect_uris: [REDIRECT, 'https://client.example.com/cb', 'com.example.app:/oauth', 'cursor://anysphere.cursor/oauth/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_basic',
      scope: 'invoices:read',
      logo_uri: 'https://evil.example/x.png',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.json).toMatchObject({
      client_name: 'Claude Desktop',
      redirect_uris: [REDIRECT, 'https://client.example.com/cb', 'com.example.app:/oauth', 'cursor://anysphere.cursor/oauth/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(res.json.client_id).toMatch(/^mi_client_[A-Za-z0-9_-]{43}$/);
    expect(res.json).not.toHaveProperty('client_secret');
    expect(res.json).not.toHaveProperty('logo_uri');
  });

  it.each([
    [{}, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: 'https://a.example/cb' }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['javascript:alert(1)//'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['data:text/html,hi'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['file:///etc/passwd'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb#frag'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://user:pw@a.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['/relative/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb\n'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [`https://a.example/${'x'.repeat(1100)}`] }, 'invalid_redirect_uri'],
    [{ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: ['refresh_token'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_name: 42 }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], client_uri: 'javascript:alert(1)' }, 'invalid_client_metadata'],
    [[1, 2], 'invalid_client_metadata'],
  ])('rejects %j with %s', async (body, error) => {
    const { client } = setup();
    const res = await register(client, body);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(error);
    expect(typeof res.json.error_description).toBe('string');
  });

  it('caps the body size, requires JSON and is rate limited per IP', async () => {
    const { client } = setup({ rateLimiters: { create: countingLimiter(2), poll: countingLimiter(1000) } });
    const big = await register(client, { redirect_uris: ['https://a.example/cb'], client_name: 'x'.repeat(9000) });
    expect(big.status).toBe(400);
    expect(big.json.error).toBe('invalid_client_metadata');
    const text = await client.call('POST', '/api/oauth/register', { body: 'redirect_uris=x', headers: { 'content-type': 'text/plain' } });
    expect(text.json.error).toBe('invalid_client_metadata');
    const limited = await register(client, { redirect_uris: ['https://a.example/cb'] });
    expect(limited.status).toBe(429);
    expect(limited.json.error).toBe('temporarily_unavailable');
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('expires registrations that were never used', async () => {
    const { app, client, clock } = setup();
    const { client_id } = await registerClient(client);
    clock.advance(25 * 60 * 60 * 1000);
    const location = await authorize(app, { client_id });
    expect(location.pathname).toBe('/agents/authorize');
    expect(location.searchParams.get('error')).toBe('invalid_client');
  });
});

describe('authorization code flow with PKCE', () => {
  it('connects a client end to end and maps it onto an agent', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client, { client_name: 'Cursor' });

    const location = await authorize(app, { client_id, scope: 'invoices:read invoices:write clients:read offline_access' });
    expect(location.origin).toBe(BASE);
    const requestId = requestIdOf(location);

    const preview = await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token);
    expect(preview.status).toBe(200);
    expect(preview.json.request).toMatchObject({
      id: requestId,
      client: { kind: 'dcr', name: 'Cursor', metadataHost: null },
      redirect: { uri: REDIRECT, kind: 'loopback', display: '127.0.0.1:53682' },
      requestedScopes: ['invoices:read', 'invoices:write', 'clients:read'],
      scopesDefaulted: false,
      existingAgent: null,
    });
    expect(Date.parse(preview.json.request.expiresAt) - Date.parse(preview.json.request.createdAt)).toBe(10 * 60 * 1000);

    // The user unticks invoices:write on the consent screen.
    const decision = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, { scopes: ['invoices:read', 'clients:read'] }, ws.token);
    expect(decision.status).toBe(200);
    expect(decision.json).toMatchObject({ status: 'approved', scopes: ['invoices:read', 'clients:read'] });
    const back = new URL(decision.json.redirectTo);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('st-123');
    expect(back.searchParams.get('iss')).toBe(BASE);
    const code = back.searchParams.get('code')!;
    expect(code).toMatch(/^mi_ac_/);

    const res = await tokenRequest(app, { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id, resource: RESOURCE });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
    const tokens = (await res.json()) as Record<string, string | number>;
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'invoices:read clients:read' });
    expect(tokens.access_token).toMatch(/^mi_at_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^mi_rt_[A-Za-z0-9_-]{43}$/);

    // Same tool visibility rules as for API keys.
    expect(await toolNames(app, tokens.access_token as string)).toEqual([
      'get_client',
      'get_invoice',
      'get_invoice_pdf',
      'get_invoice_summary',
      'get_next_invoice_number',
      'list_clients',
      'list_invoices',
    ]);

    const agents = await client.get('/api/v1/agents', ws.token);
    expect(agents.json.agents).toHaveLength(1);
    expect(agents.json.agents[0]).toMatchObject({ name: 'Cursor', scopes: ['invoices:read', 'clients:read'], connection: 'oauth', revokedAt: null });
    // OAuth tokens are bound to the MCP endpoint: the REST API does not accept them.
    const rest = await client.get('/api/v1/invoices', tokens.access_token as string);
    expect(rest.status).toBe(401);
    expect(rest.json.error.message).toMatch(/only valid at \/api\/mcp/);
  });

  it('attributes changes to the agent name and grants the default scopes when none are requested', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client, { client_name: 'Invoice Bot' });
    const requestId = requestIdOf(await authorize(app, { client_id, scope: null }));
    const preview = await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token);
    expect(preview.json.request.scopesDefaulted).toBe(true);
    expect(preview.json.request.requestedScopes).toEqual(['invoices:read', 'invoices:write', 'settings:read', 'clients:read']);
    const { tokens } = await connectOAuth(app, client, ws.token, { clientId: client_id });
    expect(tokens.scope).toBe('invoices:read invoices:write settings:read clients:read');
    const mcp = await mcpClient(app, tokens.access_token);
    const created = await mcp.callTool({ name: 'create_invoice', arguments: sampleInvoice() });
    expect(created.isError).toBeFalsy();
    await mcp.close();
    const list = await client.get('/api/v1/invoices', ws.token);
    expect(list.json.invoices[0].createdBy).toMatchObject({ type: 'agent', agentName: 'Invoice Bot' });
    const agents = await client.get('/api/v1/agents', ws.token);
    expect(agents.json.agents[0].lastUsedAt).not.toBeNull();
  });

  it('re-authorising the same client updates its agent instead of adding another', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const first = await connectOAuth(app, client, ws.token, { scope: 'invoices:read invoices:write' });
    const requestId = requestIdOf(await authorize(app, { client_id: first.clientId, scope: 'invoices:read' }));
    const preview = await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token);
    expect(preview.json.request.existingAgent).toMatchObject({ name: 'Test MCP Client', scopes: ['invoices:read', 'invoices:write'] });
    await client.post(`/api/v1/oauth/requests/${requestId}/deny`, undefined, ws.token);
    const second = await connectOAuth(app, client, ws.token, { clientId: first.clientId, scope: 'invoices:read' });
    const agents = (await client.get('/api/v1/agents', ws.token)).json.agents;
    expect(agents).toHaveLength(1);
    expect(agents[0].scopes).toEqual(['invoices:read']);
    // The older, broader token is narrowed too.
    expect(await toolNames(app, first.tokens.access_token)).not.toContain('create_invoice');
    expect(await toolNames(app, second.tokens.access_token)).toContain('list_invoices');
  });

  describe('rejects bad authorization requests', () => {
    it('never redirects to an unknown client or unregistered redirect URI (open redirect)', async () => {
      const { app, client } = setup();
      const { client_id } = await registerClient(client);
      for (const [params, error] of [
        [{ client_id: 'mi_client_doesnotexist' }, 'invalid_client'],
        [{ client_id: '' }, 'invalid_client'],
        [{ client_id, redirect_uri: 'https://evil.example/cb' }, 'invalid_redirect_uri'],
        [{ client_id, redirect_uri: `${REDIRECT}/../evil` }, 'invalid_redirect_uri'],
        [{ client_id, redirect_uri: `${REDIRECT}?x=1` }, 'invalid_redirect_uri'],
        [{ client_id, redirect_uri: 'http://localhost:53682/callback' }, 'invalid_redirect_uri'],
        [{ client_id, redirect_uri: 'http://127.0.0.1.evil.example:53682/callback' }, 'invalid_redirect_uri'],
      ] as const) {
        const location = await authorize(app, params);
        expect(location.origin + location.pathname, JSON.stringify(params)).toBe(`${BASE}/agents/authorize`);
        expect(location.searchParams.get('error')).toBe(error);
        expect([...location.searchParams.keys()]).toEqual(['error']);
      }
      // Repeated client_id / redirect_uri: also never redirected.
      const dup = await app.request(`${BASE}${await authorizeUrl({ client_id })}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`);
      expect(new URL(dup.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
    });

    it('allows any port for loopback IP redirect URIs (RFC 8252 §7.3), nothing else', async () => {
      const { app, client } = setup();
      const { client_id } = await registerClient(client);
      const location = await authorize(app, { client_id, redirect_uri: 'http://127.0.0.1:40001/callback' });
      expect(location.pathname).toBe('/agents/authorize');
      expect(location.searchParams.get('request')).toBeTruthy();
    });

    it.each([
      [{ code_challenge: null }, 'invalid_request', /code_challenge is required/],
      [{ code_challenge_method: null }, 'invalid_request', /S256 is required/],
      [{ code_challenge_method: 'plain' }, 'invalid_request', /Only the S256/],
      [{ code_challenge: 'short' }, 'invalid_request', /malformed/],
      [{ resource: null }, 'invalid_target', /resource is required/],
      [{ resource: 'https://other.example/api/mcp' }, 'invalid_target', /only resource/],
      [{ resource: `${BASE}/api/v1` }, 'invalid_target', /only resource/],
      [{ resource: `${RESOURCE}#frag` }, 'invalid_target', /only resource/],
      [{ response_type: 'token' }, 'unsupported_response_type', /code/],
      [{ scope: 'openid profile' }, 'invalid_scope', /Supported scopes/],
      [{ prompt: 'none' }, 'consent_required', /never approves/],
    ])('%j → %s (redirected back with state and iss)', async (params, error, description) => {
      const { app, client } = setup();
      const { client_id } = await registerClient(client);
      const location = await authorize(app, { client_id, ...params });
      expect(errorOf(location)).toEqual({ error, state: 'st-123', iss: BASE, origin: REDIRECT });
      expect(location.searchParams.get('error_description')).toMatch(description);
    });

    it('accepts the resource with a trailing slash or upper-case host, and ignores unknown extra scopes', async () => {
      const { app, client } = setup();
      const { client_id } = await registerClient(client);
      for (const resource of [`${RESOURCE}/`, RESOURCE.replace('app.test', 'APP.TEST')]) {
        expect(requestIdOf(await authorize(app, { client_id, resource }))).toBeTruthy();
      }
      const ws = await createWorkspace(client);
      const id = requestIdOf(await authorize(app, { client_id, scope: 'openid invoices:read' }));
      expect((await client.get(`/api/v1/oauth/requests/${id}`, ws.token)).json.request.requestedScopes).toEqual(['invoices:read']);
    });
  });

  describe('token endpoint', () => {
    async function approved(app: App, client: ReturnType<typeof setup>['client']) {
      const ws = await createWorkspace(client);
      const { client_id } = await registerClient(client);
      const requestId = requestIdOf(await authorize(app, { client_id, scope: 'invoices:read' }));
      const decision = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, undefined, ws.token);
      const code = new URL(decision.json.redirectTo).searchParams.get('code')!;
      const form = { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id, resource: RESOURCE };
      return { ws, client_id, code, form };
    }
    const err = async (res: Response) => ({ status: res.status, body: (await res.json()) as { error: string; error_description: string } });

    it('rejects a wrong verifier, redirect URI, client or resource without burning the code', async () => {
      const { app, client } = setup();
      const { form } = await approved(app, client);
      const other = await registerClient(client);
      for (const [change, error] of [
        [{ code_verifier: 'w'.repeat(43) }, 'invalid_grant'],
        [{ code_verifier: 'short' }, 'invalid_grant'],
        [{ redirect_uri: 'http://127.0.0.1:53682/other' }, 'invalid_grant'],
        [{ client_id: other.client_id }, 'invalid_grant'],
        [{ client_id: 'mi_client_unknown' }, 'invalid_client'],
        [{ resource: 'https://other.example/api/mcp' }, 'invalid_target'],
        [{ code: 'mi_ac_unknown' }, 'invalid_grant'],
      ] as const) {
        const res = await err(await tokenRequest(app, { ...form, ...change }));
        expect(res.body.error, JSON.stringify(change)).toBe(error);
        expect(res.status).toBe(error === 'invalid_client' ? 401 : 400);
      }
      const missing = await err(await tokenRequest(app, { ...form, code_verifier: '' }));
      expect(missing.body).toMatchObject({ error: 'invalid_request' });
      const { redirect_uri: _omit, ...withoutRedirect } = form;
      expect((await err(await tokenRequest(app, withoutRedirect))).body.error).toBe('invalid_grant');
      // The legitimate client can still redeem it.
      expect((await tokenRequest(app, form)).status).toBe(200);
    });

    it('codes are single use; a second use revokes the tokens issued for it', async () => {
      const { app, client } = setup();
      const { form } = await approved(app, client);
      const first = await tokenRequest(app, form);
      const tokens = (await first.json()) as { access_token: string; refresh_token: string };
      expect((await rawMcp(app, tokens.access_token)).status).toBe(200);
      const again = await err(await tokenRequest(app, form));
      expect(again.body).toMatchObject({ error: 'invalid_grant', error_description: expect.stringMatching(/already used/) });
      expect((await rawMcp(app, tokens.access_token)).status).toBe(401);
      const refreshed = await err(await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: form.client_id }));
      expect(refreshed.body.error).toBe('invalid_grant');
    });

    it('codes expire after two minutes', async () => {
      const { app, client, clock } = setup();
      const { form } = await approved(app, client);
      clock.advance(2 * 60 * 1000 + 1);
      expect((await err(await tokenRequest(app, form))).body).toMatchObject({ error: 'invalid_grant', error_description: expect.stringMatching(/expired/) });
    });

    it('requires form encoding and public clients; rejects unknown grants', async () => {
      const { app, client } = setup();
      const { form } = await approved(app, client);
      const json = await app.request(`${BASE}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
      expect((await err(json)).body.error).toBe('invalid_request');
      expect((await err(await tokenRequest(app, { ...form, client_secret: 's3cret' }))).body.error).toBe('invalid_client');
      expect((await err(await tokenRequest(app, form, { authorization: `Basic ${btoa(`${form.client_id}:secret`)}` }))).body.error).toBe('invalid_client');
      expect((await err(await tokenRequest(app, { ...form, grant_type: 'client_credentials' }))).body.error).toBe('unsupported_grant_type');
      expect((await err(await tokenRequest(app, { ...form, grant_type: 'password' }))).body.error).toBe('unsupported_grant_type');
      const dup = await app.request(`${BASE}/api/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `${new URLSearchParams(form)}&code=mi_ac_other`,
      });
      expect((await err(dup)).body.error).toBe('invalid_request');
      // Basic auth with an empty secret is how some public clients send client_id.
      const { client_id, ...rest } = form;
      const basic = await tokenRequest(app, rest, { authorization: `Basic ${btoa(`${client_id}:`)}` });
      expect(basic.status).toBe(200);
    });

    it('is rate limited per IP', async () => {
      const { app, client } = setup({ rateLimiters: { create: countingLimiter(100), poll: countingLimiter(5) } });
      const { form } = await approved(app, client);
      let last: Response | undefined;
      for (let i = 0; i < 6; i++) last = await tokenRequest(app, { ...form, code: `mi_ac_x${i}` });
      expect(last!.status).toBe(429);
      expect((await last!.json()) as object).toMatchObject({ error: 'temporarily_unavailable' });
    });
  });
});

describe('consent API', () => {
  it('requires the workspace token: no token, agent keys and OAuth tokens are refused', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const oauthAgent = await connectOAuth(app, client, ws.token);
    const { api_key } = await connectAgent(client, ws.token, ['invoices:read']);
    const requestId = requestIdOf(await authorize(app, { client_id: oauthAgent.clientId }));
    for (const [token, status] of [
      [undefined, 401],
      [api_key, 403],
      [oauthAgent.tokens.access_token, 401],
      ['mi_ws_forged', 401],
    ] as const) {
      expect((await client.get(`/api/v1/oauth/requests/${requestId}`, token)).status).toBe(status);
      expect((await client.post(`/api/v1/oauth/requests/${requestId}/approve`, undefined, token)).status).toBe(status);
      expect((await client.post(`/api/v1/oauth/requests/${requestId}/deny`, undefined, token)).status).toBe(status);
    }
    // Still pending: nothing above decided it.
    expect((await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token)).status).toBe(200);
  });

  it('cannot be driven cross-site (no CORS, no ambient credentials, JSON only)', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client);
    const requestId = requestIdOf(await authorize(app, { client_id }));
    const url = `${BASE}/api/v1/oauth/requests/${requestId}/approve`;
    // A cross-site page can only send "simple" requests without an Authorization header…
    const formPost = await app.request(url, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'scopes=invoices:read' });
    expect(formPost.status).toBe(401);
    expect(formPost.headers.get('access-control-allow-origin')).toBeNull();
    // …and the preflight a credentialed request needs is never granted.
    const preflight = await app.request(url, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-headers')).toBeNull();
    // Even with the token, a non-JSON body is refused.
    const textPost = await client.call('POST', `/api/v1/oauth/requests/${requestId}/approve`, { token: ws.token, body: 'x', headers: { 'content-type': 'text/plain' } });
    expect(textPost.status).toBe(415);
    expect((await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token)).status).toBe(200);
  });

  it('only narrows scopes, and decides exactly once', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client);
    const requestId = requestIdOf(await authorize(app, { client_id, scope: 'invoices:read' }));
    const wider = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, { scopes: ['invoices:read', 'invoices:delete'] }, ws.token);
    expect(wider.status).toBe(400);
    expect(wider.json.error.code).toBe('invalid_scope');
    const none = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, { scopes: [] }, ws.token);
    expect(none.status).toBe(400);
    const unknown = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, { scopes: ['admin'] }, ws.token);
    expect(unknown.status).toBe(400);
    const extraField = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, { scopes: ['invoices:read'], redirect_uri: 'https://evil.example' }, ws.token);
    expect(extraField.status).toBe(400);
    const ok = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, undefined, ws.token);
    expect(ok.status).toBe(200);
    expect(new URL(ok.json.redirectTo).origin + new URL(ok.json.redirectTo).pathname).toBe(REDIRECT);
    for (const action of ['approve', 'deny']) {
      const again = await client.post(`/api/v1/oauth/requests/${requestId}/${action}`, undefined, ws.token);
      expect(again.status).toBe(409);
    }
    expect((await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token)).json.error.details).toEqual({ status: 'approved' });
  });

  it('deny sends access_denied back to the client', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client);
    const requestId = requestIdOf(await authorize(app, { client_id }));
    const denied = await client.post(`/api/v1/oauth/requests/${requestId}/deny`, undefined, ws.token);
    expect(denied.status).toBe(200);
    expect(denied.json.status).toBe('denied');
    const back = new URL(denied.json.redirectTo);
    expect(errorOf(back)).toEqual({ error: 'access_denied', state: 'st-123', iss: BASE, origin: REDIRECT });
    expect(back.searchParams.get('code')).toBeNull();
    expect((await client.get('/api/v1/agents', ws.token)).json.agents).toEqual([]);
  });

  it('expires pending requests after ten minutes and 404s unknown ids', async () => {
    const { app, client, clock } = setup();
    const ws = await createWorkspace(client);
    const { client_id } = await registerClient(client);
    const requestId = requestIdOf(await authorize(app, { client_id }));
    clock.advance(10 * 60 * 1000);
    expect((await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token)).status).toBe(410);
    expect((await client.post(`/api/v1/oauth/requests/${requestId}/approve`, undefined, ws.token)).status).toBe(410);
    expect((await client.get(`/api/v1/oauth/requests/${'x'.repeat(43)}`, ws.token)).status).toBe(404);
    expect((await client.get('/api/v1/oauth/requests/..%2F..%2Fagents', ws.token)).status).toBe(404);
  });
});

describe('tokens', () => {
  it('rotates refresh tokens and revokes the whole grant when an old one is reused', async () => {
    const { app, client, clock } = setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token, { scope: 'invoices:read invoices:write' });
    clock.advance(61 * 60 * 1000);
    expect((await rawMcp(app, tokens.access_token)).status).toBe(401); // expired after an hour

    const r1 = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId, resource: RESOURCE });
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(t1.refresh_token).not.toBe(tokens.refresh_token);
    expect(t1.scope).toBe('invoices:read invoices:write');
    expect((await rawMcp(app, t1.access_token)).status).toBe(200);

    // Narrowing on refresh is allowed, widening is not.
    const wider = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: clientId, scope: 'invoices:delete' });
    expect(((await wider.json()) as { error: string }).error).toBe('invalid_scope');
    const r2 = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: clientId, scope: 'invoices:read' });
    const t2 = (await r2.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(t2.scope).toBe('invoices:read');

    // Reusing the already-rotated t1 refresh token: reuse detected → grant revoked.
    const reuse = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: clientId });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error_description: string }).error_description).toMatch(/already used/);
    expect((await rawMcp(app, t2.access_token)).status).toBe(401);
    const afterReuse = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: clientId });
    expect(((await afterReuse.json()) as { error: string }).error).toBe('invalid_grant');
    // Wrong client for a refresh token.
    const other = await registerClient(client);
    const stolen = await connectOAuth(app, client, ws.token, { clientId });
    const wrongClient = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: stolen.tokens.refresh_token!, client_id: other.client_id });
    expect(((await wrongClient.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('refresh tokens expire after 30 days and are not issued without the refresh_token grant', async () => {
    const { app, client, clock } = setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    clock.advance(30 * 24 * 60 * 60 * 1000 + 1);
    const res = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId });
    expect(((await res.json()) as { error_description: string }).error_description).toMatch(/expired/);
    const noRefresh = await registerClient(client, { grant_types: undefined });
    const plain = await connectOAuth(app, client, ws.token, { clientId: noRefresh.client_id });
    expect(plain.tokens.refresh_token).toBeUndefined();
  });

  it('revocation endpoint: refresh token kills the grant, access token only itself, foreign tokens are ignored', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const a = await connectOAuth(app, client, ws.token);
    const revoke = (form: Record<string, string>) =>
      app.request(`${BASE}/api/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });

    // Another client cannot revoke a token it does not own (silently ignored, RFC 7009 §2.2).
    const other = await registerClient(client);
    expect((await revoke({ token: a.tokens.access_token, client_id: other.client_id })).status).toBe(200);
    expect((await rawMcp(app, a.tokens.access_token)).status).toBe(200);
    // Unknown tokens and API keys: 200, nothing happens.
    expect((await revoke({ token: 'mi_at_unknown', client_id: a.clientId })).status).toBe(200);
    expect((await revoke({ token: ws.token, client_id: a.clientId })).status).toBe(200);
    expect((await client.get('/api/v1/workspace', ws.token)).status).toBe(200);
    expect(((await (await revoke({ client_id: a.clientId })).json()) as { error: string }).error).toBe('invalid_request');

    expect((await revoke({ token: a.tokens.access_token, client_id: a.clientId, token_type_hint: 'access_token' })).status).toBe(200);
    expect((await rawMcp(app, a.tokens.access_token)).status).toBe(401);
    const refreshed = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: a.tokens.refresh_token!, client_id: a.clientId });
    expect(refreshed.status).toBe(200);
    const fresh = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect((await revoke({ token: fresh.refresh_token, client_id: a.clientId })).status).toBe(200);
    expect((await rawMcp(app, fresh.access_token)).status).toBe(401);
  });

  it('revoking the agent in the app kills its tokens immediately', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    const agent = (await client.get('/api/v1/agents', ws.token)).json.agents[0];
    expect((await rawMcp(app, tokens.access_token)).status).toBe(200);
    expect((await client.del(`/api/v1/agents/${agent.id}`, ws.token)).status).toBe(204);
    expect((await rawMcp(app, tokens.access_token)).status).toBe(401);
    const res = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId });
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    // Re-authorising after a revoke creates a new agent (revocation is permanent).
    await connectOAuth(app, client, ws.token, { clientId });
    const agents = (await client.get('/api/v1/agents', ws.token)).json.agents;
    expect(agents.map((x: { revokedAt: string | null }) => x.revokedAt === null).sort()).toEqual([false, true]);
  });

  it('access tokens are audience-bound to the MCP endpoint they were issued for', async () => {
    const issuing = setup();
    const ws = await createWorkspace(issuing.client);
    const { tokens } = await connectOAuth(issuing.app, issuing.client, ws.token);
    expect((await rawMcp(issuing.app, tokens.access_token)).status).toBe(200);
    // Same database, but the server now serves a different public URL (another resource).
    const other = buildApp(d1.db, { config: { appUrl: 'https://other.example.org' } });
    expect((await rawMcp(other.app, tokens.access_token)).status).toBe(401);
    // Same app reached under another host name: not the resource the token is for either.
    expect((await rawMcp(issuing.app, tokens.access_token, 'http://alias.test')).status).toBe(401);
  });

  it('keeps workspaces isolated', async () => {
    const { app, client } = setup();
    const a = await createWorkspace(client);
    const b = await createWorkspace(client);
    await client.post('/api/v1/invoices', sampleInvoice({ toName: 'Only in B' }), b.token);
    const { tokens } = await connectOAuth(app, client, a.token, { scope: 'invoices:read' });
    const mcp = await mcpClient(app, tokens.access_token);
    const list = await mcp.callTool({ name: 'list_invoices', arguments: {} });
    expect((list.structuredContent as { invoices: unknown[] }).invoices).toEqual([]);
    await mcp.close();
    const agentA = (await client.get('/api/v1/agents', a.token)).json.agents[0];
    expect((await client.get('/api/v1/agents', b.token)).json.agents).toEqual([]);
    expect((await client.del(`/api/v1/agents/${agentA.id}`, b.token)).status).toBe(404);
    expect((await rawMcp(app, tokens.access_token)).status).toBe(200);
  });

  it('deleting the workspace deletes its OAuth grants', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    expect((await client.del('/api/v1/workspace', ws.token)).status).toBe(204);
    expect((await rawMcp(app, tokens.access_token)).status).toBe(401);
    const res = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId });
    expect(res.status).toBe(400);
  });
});

describe('existing credentials keep working on /api/mcp', () => {
  it('static agent keys (device flow) and the workspace token', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const { api_key } = await connectAgent(client, ws.token, ['invoices:read']);
    expect(await toolNames(app, api_key)).toContain('list_invoices');
    expect(await toolNames(app, api_key)).not.toContain('create_invoice');
    expect(await toolNames(app, ws.token)).toContain('delete_invoice');
    const agents = (await client.get('/api/v1/agents', ws.token)).json.agents;
    expect(agents[0]).toMatchObject({ connection: 'api_key' });
  });
});

describe('Client ID Metadata Documents', () => {
  const DOC_URL = 'https://tools.example.com/mcp/client.json';
  // Each test uses its own document URL: the D1 database (and so the metadata cache) is shared per file.
  let docUrl = DOC_URL;
  const doc = (overrides: Record<string, unknown> = {}) => ({
    client_id: docUrl,
    client_name: 'Example Hosted Connector',
    client_uri: 'https://tools.example.com',
    redirect_uris: ['https://tools.example.com/oauth/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  });

  function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch;
    return { fn, calls };
  }
  const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

  it('fetches, validates and caches the document, then runs the normal flow', async () => {
    const fake = fakeFetch(() => jsonResponse(doc(), { 'cache-control': 'max-age=600' }));
    const { app, client, clock } = setup({ outboundFetch: fake.fn });
    const ws = await createWorkspace(client);
    const location = await authorize(app, { client_id: DOC_URL, redirect_uri: 'https://tools.example.com/oauth/callback' });
    const requestId = requestIdOf(location);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(DOC_URL);
    expect(fake.calls[0].init?.redirect).toBe('manual');
    const preview = await client.get(`/api/v1/oauth/requests/${requestId}`, ws.token);
    expect(preview.json.request.client).toEqual({ kind: 'cimd', name: 'Example Hosted Connector', metadataHost: 'tools.example.com', clientUri: 'https://tools.example.com/' });
    expect(preview.json.request.redirect).toMatchObject({ kind: 'https', display: 'tools.example.com' });
    const decision = await client.post(`/api/v1/oauth/requests/${requestId}/approve`, undefined, ws.token);
    const code = new URL(decision.json.redirectTo).searchParams.get('code')!;
    const res = await tokenRequest(app, { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: 'https://tools.example.com/oauth/callback', client_id: DOC_URL });
    expect(res.status).toBe(200);
    // Cached for max-age: no second fetch; refetched once it is stale.
    await authorize(app, { client_id: DOC_URL, redirect_uri: 'https://tools.example.com/oauth/callback' });
    expect(fake.calls).toHaveLength(1);
    clock.advance(601 * 1000);
    await authorize(app, { client_id: DOC_URL, redirect_uri: 'https://tools.example.com/oauth/callback' });
    expect(fake.calls).toHaveLength(2);
    // Redirect URIs come only from the document.
    const evil = await authorize(app, { client_id: DOC_URL, redirect_uri: 'https://evil.example/cb' });
    expect(evil.searchParams.get('error')).toBe('invalid_redirect_uri');
  });

  it.each([
    ['client_id mismatch', () => jsonResponse(doc({ client_id: 'https://tools.example.com/other.json' }))],
    ['missing client_name', () => jsonResponse(doc({ client_name: undefined }))],
    ['client secret', () => jsonResponse(doc({ client_secret: 'x' }))],
    ['private_key_jwt', () => jsonResponse(doc({ token_endpoint_auth_method: 'private_key_jwt' }))],
    ['bad redirect uri', () => jsonResponse(doc({ redirect_uris: ['http://evil.example/cb'] }))],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })],
    ['404', () => new Response('nope', { status: 404 })],
    ['html', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['too large', () => jsonResponse({ ...doc(), padding: 'x'.repeat(6000) })],
    ['not json', () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['network error', () => { throw new TypeError('fetch failed'); }],
  ])('rejects a document with %s', async (name, respond) => {
    docUrl = `https://tools.example.com/mcp/${name.replace(/\W+/g, '-')}.json`;
    const fake = fakeFetch(respond);
    const { app } = setup({ outboundFetch: fake.fn });
    const location = await authorize(app, { client_id: docUrl, redirect_uri: 'https://tools.example.com/oauth/callback' });
    expect(location.origin + location.pathname).toBe(`${BASE}/agents/authorize`);
    expect(location.searchParams.get('error')).toBe('invalid_client_metadata');
    expect(fake.calls).toHaveLength(1);
  });

  it.each([
    'https://127.0.0.1/client.json',
    'https://[::1]/client.json',
    'https://10.0.0.1/client.json',
    'https://localhost/client.json',
    'https://metadata.google.internal/client.json',
    'https://printer.local/client.json',
    'https://intranet/client.json',
    'https://tools.example.com:8443/client.json',
    'https://tools.example.com/',
    'https://tools.example.com/a/../client.json',
    'https://user:pw@tools.example.com/client.json',
    'https://app.test/client.json',
    'https://TOOLS.example.com/client.json',
  ])('never fetches %s', async (url) => {
    const fake = fakeFetch(() => jsonResponse(doc({ client_id: url })));
    const { app } = setup({ outboundFetch: fake.fn });
    const location = await authorize(app, { client_id: url, redirect_uri: 'https://tools.example.com/oauth/callback' });
    expect(location.searchParams.get('error')).toBe('invalid_client');
    expect(fake.calls).toEqual([]);
  });

  it('rate-limits document fetches per IP', async () => {
    const fake = fakeFetch(() => new Response('nope', { status: 500 }));
    const { app } = setup({ outboundFetch: fake.fn, rateLimiters: { create: countingLimiter(2), poll: countingLimiter(1000) } });
    const errors: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      errors.push((await authorize(app, { client_id: `https://tools.example.com/c${i}.json`, redirect_uri: 'https://tools.example.com/oauth/callback' })).searchParams.get('error'));
    }
    expect(errors).toEqual(['invalid_client_metadata', 'invalid_client_metadata', 'rate_limited']);
    expect(fake.calls).toHaveLength(2);
  });
});

describe('pkce helper', () => {
  it('matches the RFC 7636 appendix B example', async () => {
    expect(await s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
