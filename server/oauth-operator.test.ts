/**
 * OAuth × operator console: suspension, maintenance mode, force-revoke and
 * console deletion, telemetry (OAuth group, no ids), the scheduled prune job
 * and the oauth.* runtime settings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, BASE, createWorkspace, startD1, TestClock } from './test/helpers';
import { buildOperatorApp, completeSetup, fakeWorkos } from './test/operator';
import { authorize, connectOAuth, REDIRECT, registerClient, requestIdOf, RESOURCE, tokenRequest, VERIFIER } from './test/oauth';
import { runScheduledJobs } from './scheduled';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const workos = fakeWorkos();
let operatorCount = 0;

async function setup(clock = new TestClock()) {
  // The console is set up once per database; later apps sign in again as the same owner.
  await d1.db.batch(['operator_sessions', 'operators', 'operator_settings', 'operator_audit', 'operator_state', 'operator_oauth_states', 'operator_login_attempts'].map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
  const built = buildOperatorApp(d1.db, { fetch: workos.fetch, clock });
  const { browser: b } = await completeSetup(built.app, workos, { id: `user_owner_${++operatorCount}`, email: 'owner@example.com' });
  return { ...built, b, client: api(built.app) };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const mcp = (app: App, token: string) =>
  app.request(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
const body = async (res: Response) => ({ status: res.status, json: (await res.json()) as Record<string, unknown>, headers: res.headers });

describe('suspended workspaces (operator console)', () => {
  it('blocks OAuth access tokens, refresh, code exchange and consent, and restores them on unsuspend', async () => {
    const { app, client, b } = await setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    // A code approved just before the suspension, not yet exchanged.
    const pendingId = requestIdOf(await authorize(app, { client_id: clientId }));
    const approved = await client.post(`/api/v1/oauth/requests/${pendingId}/approve`, undefined, ws.token);
    const code = new URL(approved.json.redirectTo).searchParams.get('code')!;
    const nextRequest = requestIdOf(await authorize(app, { client_id: clientId }));
    expect((await mcp(app, tokens.access_token)).status).toBe(200);

    expect((await b.post(`/api/operator/workspaces/${ws.workspace.id}/suspend`, { reason: 'abuse' })).status).toBe(200);

    const blocked = await body(await mcp(app, tokens.access_token));
    expect(blocked.status).toBe(403);
    expect(blocked.json).toMatchObject({ error: { code: 'workspace_suspended' } });
    const refresh = await body(await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId }));
    expect(refresh).toMatchObject({ status: 403, json: { error: 'access_denied', error_description: expect.stringMatching(/suspended/) } });
    const exchange = await body(
      await tokenRequest(app, { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: clientId, resource: RESOURCE }),
    );
    expect(exchange).toMatchObject({ status: 403, json: { error: 'access_denied' } });
    for (const res of [
      await client.get(`/api/v1/oauth/requests/${nextRequest}`, ws.token),
      await client.post(`/api/v1/oauth/requests/${nextRequest}/approve`, undefined, ws.token),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('workspace_suspended');
    }
    // Nothing was revoked: suspension is reversible.
    const revoked = await d1.db.prepare('SELECT COUNT(*) AS n FROM oauth_grants WHERE workspace_id = ? AND revoked_at IS NOT NULL').bind(ws.workspace.id).first('n');
    expect(revoked).toBe(0);

    expect((await b.post(`/api/operator/workspaces/${ws.workspace.id}/unsuspend`)).status).toBe(200);
    expect((await mcp(app, tokens.access_token)).status).toBe(200);
    expect((await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId })).status).toBe(200);
    expect((await client.get(`/api/v1/oauth/requests/${nextRequest}`, ws.token)).status).toBe(200);
  });

  it('does not affect OAuth clients of other workspaces', async () => {
    const { app, client, b } = await setup();
    const a = await createWorkspace(client);
    const other = await createWorkspace(client);
    const okTokens = (await connectOAuth(app, client, other.token)).tokens;
    await b.post(`/api/operator/workspaces/${a.workspace.id}/suspend`, {});
    expect((await mcp(app, okTokens.access_token)).status).toBe(200);
  });
});

describe('maintenance mode', () => {
  it('answers OAuth endpoints in OAuth form, keeps discovery up and sends browsers to the app’s error page', async () => {
    const { app, client, b } = await setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    await b.put('/api/operator/settings/maintenance.enabled', { value: true });

    const token = await body(await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId }));
    expect(token.status).toBe(503);
    expect(token.json).toEqual({ error: 'temporarily_unavailable', error_description: expect.any(String) });
    expect(token.headers.get('retry-after')).toBe('300');
    expect(token.headers.get('cache-control')).toBe('no-store');
    const reg = await client.post('/api/oauth/register', { redirect_uris: [REDIRECT] });
    expect(reg.status).toBe(503);
    expect(reg.json.error).toBe('temporarily_unavailable');
    const auth = await authorize(app, { client_id: clientId });
    expect(auth.href).toBe(`${BASE}/agents/authorize?error=temporarily_unavailable`);
    expect((await mcp(app, tokens.access_token)).status).toBe(503);
    expect((await client.get('/api/v1/oauth/requests/x', ws.token)).json.error.code).toBe('maintenance');
    for (const p of ['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server']) {
      expect((await app.request(`${BASE}${p}`)).status, p).toBe(200);
    }
    // Nothing was consumed: once maintenance ends the refresh token still works.
    await b.put('/api/operator/settings/maintenance.enabled', { value: false });
    expect((await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId })).status).toBe(200);
  });
});

describe('operator actions on OAuth agents', () => {
  it('force-revoking an OAuth agent kills its access and refresh tokens', async () => {
    const { app, client, b } = await setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    const agents = (await b.get('/api/operator/agents')).json.agents;
    const agent = agents.find((x: { workspaceId: string }) => x.workspaceId === ws.workspace.id);
    expect((await b.post(`/api/operator/agents/${agent.id}/revoke`)).json.result).toBe('revoked');
    expect((await mcp(app, tokens.access_token)).status).toBe(401);
    const refresh = await body(await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId }));
    expect(refresh.json.error).toBe('invalid_grant');
  });

  it('deleting a workspace from the console removes its OAuth state', async () => {
    const { app, client, b } = await setup();
    const ws = await createWorkspace(client);
    const { clientId, tokens } = await connectOAuth(app, client, ws.token);
    requestIdOf(await authorize(app, { client_id: clientId })); // a pending request too
    expect((await b.del(`/api/operator/workspaces/${ws.workspace.id}`, { confirm: ws.workspace.id })).status).toBe(204);
    for (const table of ['oauth_tokens', 'oauth_grants', 'oauth_codes', 'oauth_agents', 'oauth_requests', 'agents']) {
      expect(await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).bind(ws.workspace.id).first('n'), table).toBe(0);
    }
    expect((await mcp(app, tokens.access_token)).status).toBe(401);
    expect((await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId })).status).toBe(400);
  });
});

describe('telemetry', () => {
  it('records an OAuth group with grant types and outcomes, never ids, codes, tokens or client names', async () => {
    const { app, client, b, telemetry } = await setup();
    const ws = await createWorkspace(client);
    const reg = await registerClient(client, { client_name: 'Telemetry Secret Client Name' });
    const { tokens, requestId, code } = await connectOAuth(app, client, ws.token, { clientId: reg.client_id });
    await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: reg.client_id });
    await tokenRequest(app, { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: reg.client_id }); // reused → invalid_grant
    await tokenRequest(app, { grant_type: 'password', client_id: reg.client_id });
    await authorize(app, { client_id: 'mi_client_unknown' });
    await authorize(app, { client_id: reg.client_id, code_challenge_method: 'plain' });
    const viewed = requestIdOf(await authorize(app, { client_id: reg.client_id }));
    expect((await client.get(`/api/v1/oauth/requests/${viewed}`, ws.token)).status).toBe(200);
    await telemetry.flush();
    const t = (await b.get('/api/operator/telemetry?range=1h')).json;
    const names = t.metrics.map((m: { metric: string }) => m.metric);
    expect(names).toEqual(
      expect.arrayContaining([
        'rest|POST /api/oauth/register',
        'rest|GET /api/oauth/authorize (consent)',
        'rest|GET /api/oauth/authorize (rejected)',
        'rest|GET /api/oauth/authorize (error_redirect)',
        'rest|POST /api/oauth/token (authorization_code)',
        'rest|POST /api/oauth/token (refresh_token)',
        'rest|POST /api/oauth/token (other_grant)',
        'rest|GET /oauth/requests/:request_id',
        'rest|POST /oauth/requests/:request_id/approve',
      ]),
    );
    for (const m of t.metrics.filter((x: { metric: string }) => x.metric.includes('oauth'))) expect(m.group, m.metric).toBe('OAuth');
    expect(t.groups.map((g: { group: string }) => g.group)).toContain('OAuth');
    const codes = t.recentErrors.map((e: { code: string | null }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['invalid_grant', 'unsupported_grant_type']));
    const raw = JSON.stringify(t);
    for (const leak of [requestId, viewed, reg.client_id, 'Telemetry Secret Client Name', code, tokens.access_token, tokens.refresh_token!, ws.token]) {
      expect(raw.includes(leak), `telemetry leaked ${leak.slice(0, 12)}`).toBe(false);
    }
    // The privacy boundary of the console holds for OAuth data too.
    for (const path of ['/workspaces', '/overview', '/telemetry?range=7d', '/audit', '/security']) {
      const r = await b.get(`/api/operator${path}`);
      for (const leak of [requestId, reg.client_id, code, tokens.access_token]) expect(r.text.includes(leak), `${path} leaked`).toBe(false);
    }
  });
});

describe('scheduled prune job', () => {
  it('removes expired requests, codes, tokens, unused registrations and dead grants, keeps live ones', async () => {
    const clock = new TestClock();
    const { app, client, deps } = await setup(clock);
    const ws = await createWorkspace(client);
    const live = await connectOAuth(app, client, ws.token);
    const unused = await registerClient(client);
    requestIdOf(await authorize(app, { client_id: live.clientId })); // pending request, will expire
    const revokedFlow = await connectOAuth(app, client, ws.token, { clientId: live.clientId });
    await app.request(`${BASE}/api/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: revokedFlow.tokens.refresh_token!, client_id: live.clientId }).toString(),
    });

    clock.advance(2 * 24 * 60 * 60 * 1000); // access tokens, codes, requests and the unused client are past expiry + grace
    const results = await runScheduledJobs(deps, { cron: '17 * * * *', scheduledTime: clock.now.getTime() });
    expect(results).toContainEqual({ name: 'oauth.prune', ok: true });
    const count = async (sql: string, ...args: unknown[]) => d1.db.prepare(sql).bind(...args).first<number>('n');
    expect(await count('SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = ?', unused.client_id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM oauth_clients WHERE client_id = ?', live.clientId)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM oauth_requests WHERE workspace_id IS NULL AND client_id = ?', live.clientId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM oauth_codes WHERE workspace_id = ?', ws.workspace.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM oauth_tokens WHERE workspace_id = ? AND kind = 'access'", ws.workspace.id)).toBe(0);
    // The live grant keeps its (30-day) refresh token; the revoked grant is gone.
    expect(await count('SELECT COUNT(*) AS n FROM oauth_grants WHERE workspace_id = ?', ws.workspace.id)).toBe(1);
    expect((await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: live.tokens.refresh_token!, client_id: live.clientId })).status).toBe(200);
  });
});

describe('oauth.* runtime settings', () => {
  it('turn dynamic registration and metadata documents off and change token lifetimes', async () => {
    const { app, client, b } = await setup();
    const ws = await createWorkspace(client);
    await b.put('/api/operator/settings/oauth.registrationEnabled', { value: false });
    await b.put('/api/operator/settings/oauth.metadataDocumentsEnabled', { value: false });
    await b.put('/api/operator/settings/oauth.accessTokenMinutes', { value: 5 });
    expect((await b.put('/api/operator/settings/oauth.accessTokenMinutes', { value: 1 })).status).toBe(400);

    const meta = (await (await app.request(`${BASE}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(meta).not.toHaveProperty('registration_endpoint');
    expect(meta.client_id_metadata_document_supported).toBe(false);
    const reg = await client.post('/api/oauth/register', { redirect_uris: [REDIRECT] });
    expect(reg.status).toBe(403);
    expect(reg.json.error).toBe('access_denied');
    const cimd = await authorize(app, { client_id: 'https://tools.example.com/mcp/client.json', redirect_uri: 'https://tools.example.com/cb' });
    expect(cimd.searchParams.get('error')).toBe('invalid_client');

    // Clients registered before keep working, with the new lifetime.
    await b.put('/api/operator/settings/oauth.registrationEnabled', { value: true });
    const existing = await registerClient(client);
    await b.put('/api/operator/settings/oauth.registrationEnabled', { value: false });
    const { tokens } = await connectOAuth(app, client, ws.token, { clientId: existing.client_id });
    expect(tokens.expires_in).toBe(300);
  });
});
