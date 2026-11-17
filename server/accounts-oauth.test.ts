/**
 * User accounts × OAuth for MCP and agents. Rule: OAuth grants and agent API
 * keys belong to the workspace (and its agent), never to a device token, so
 * signing devices out never disconnects agents; agents are revoked on the
 * Agents page. Disabling an account revokes only its devices. Deleting the
 * account together with its workspace removes everything, agents included.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { safeReturnTo } from '../shared/accounts';
import { api, connectAgent, startD1 } from './test/helpers';
import { browser } from './test/operator';
import { connectOAuth } from './test/oauth';
import { accountsApp, alice, bearer, signInUser, type App } from './test/accounts';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const TABLES = [
  'oauth_tokens', 'oauth_grants', 'oauth_agents', 'oauth_codes', 'oauth_requests', 'oauth_clients',
  'activity', 'user_oauth_states', 'user_sessions', 'workspace_tokens', 'workspace_members', 'users',
  'operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit',
  'operator_state', 'telemetry_rollups', 'telemetry_errors', 'workspace_suspensions', 'workspace_activity',
  'agent_registrations', 'agents', 'clients', 'invoices', 'workspace_settings', 'workspaces',
];
beforeEach(async () => {
  await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const tools = (app: App, token: string) => api(app).post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token, { accept: 'application/json, text/event-stream' });

async function setup() {
  const built = await accountsApp(d1.db);
  const { app, workos } = built;
  const { b: a } = await signInUser(app, workos, alice);
  const devA = (await a.post('/api/account/workspace', {})).json as { token: string; deviceId: string; workspace: { id: string } };
  const { b } = await signInUser(app, workos, alice);
  const devB = (await b.post('/api/account/workspace/connect', {})).json as { token: string; deviceId: string };
  const client = api(app);
  // Consent with a device token: the OAuth identity interface sees an ordinary workspace user.
  const oauth = await connectOAuth(app, client, devA.token, { scope: 'invoices:read invoices:write' });
  const agent = await connectAgent(client, devB.token, ['invoices:read']);
  return { ...built, a, b, devA, devB, client, oauthToken: oauth.tokens.access_token, agentKey: agent.api_key };
}

describe('agents and OAuth grants are bound to the workspace, not to a device', () => {
  it('survive revoking a device, signing out a browser and "sign out everywhere"', async () => {
    const { app, a, b, devA, devB, client, oauthToken, agentKey } = await setup();
    const agentsOk = async () => {
      // OAuth access tokens are bound to the MCP endpoint (resource), agent keys work everywhere.
      expect((await tools(app, oauthToken)).status).toBe(200);
      expect((await client.get('/api/v1/invoices', agentKey)).status).toBe(200);
    };
    expect((await a.del(`/api/account/devices/${devB.deviceId}`)).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devB.token)).status).toBe(401);
    await agentsOk();
    expect((await a.post('/api/account/sign-out-everywhere', { keepThisDevice: false })).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devA.token)).status).toBe(401);
    await agentsOk();
    void b;
  });

  it('survive a browser signing itself out with its device token', async () => {
    const { app, devA, client, oauthToken, agentKey } = await setup();
    expect((await browser(app).post('/api/account/sign-out', undefined, { headers: bearer(devA.token) })).status).toBe(204);
    expect((await client.get('/api/v1/invoices', devA.token)).status).toBe(401);
    expect((await tools(app, oauthToken)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', agentKey)).status).toBe(200);
  });

  it('operator disabling the account revokes its devices only; deleting account + workspace removes the agents too', async () => {
    const { app, workos, operator, devA, devB, client, oauthToken, agentKey } = await setup();
    const id = (await operator.get('/api/operator/accounts')).json.accounts[0].id;
    expect((await operator.post(`/api/operator/accounts/${id}/disable`, {})).status).toBe(200);
    for (const t of [devA.token, devB.token]) expect((await client.get('/api/v1/invoices', t)).status).toBe(401);
    expect((await tools(app, oauthToken)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', agentKey)).status).toBe(200);
    await operator.post(`/api/operator/accounts/${id}/enable`);

    const { b } = await signInUser(app, workos, alice);
    await b.post('/api/account/workspace/connect', {});
    const del = await b.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: true } });
    expect(del.json.deletedWorkspace).toBe(true);
    expect((await tools(app, oauthToken)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', agentKey)).status).toBe(401);
  });

  it('keeps agents when the account is deleted but the workspace is kept', async () => {
    const { app, a, client, oauthToken, agentKey } = await setup();
    const kept = await a.call('DELETE', '/api/account', { body: { confirm: 'alice@example.com', deleteWorkspace: false } });
    expect(kept.json.recoveryKey).toMatch(/^mi_ws_/);
    expect((await tools(app, oauthToken)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', agentKey)).status).toBe(200);
  });
});

describe('suspension after the OAuth merge', () => {
  it('blocks device tokens (snapshot path) and OAuth access tokens (their own check), and both recover on unsuspend', async () => {
    const { app, operator, devA, client, oauthToken, agentKey } = await setup();
    expect((await operator.post(`/api/operator/workspaces/${devA.workspace.id}/suspend`, {})).status).toBe(200);
    for (const t of [devA.token, agentKey]) {
      const res = await client.get('/api/v1/invoices', t);
      expect(res.status, t.slice(0, 8)).toBe(403);
      expect(res.json.error.code).toBe('workspace_suspended');
    }
    for (const t of [devA.token, oauthToken, agentKey]) {
      const res = await tools(app, t);
      expect(res.status, t.slice(0, 8)).toBe(403);
      expect(res.json.error.code).toBe('workspace_suspended');
    }
    expect((await operator.post(`/api/operator/workspaces/${devA.workspace.id}/unsuspend`)).status).toBe(200);
    for (const t of [devA.token, agentKey]) expect((await client.get('/api/v1/invoices', t)).status).toBe(200);
    for (const t of [devA.token, oauthToken, agentKey]) expect((await tools(app, t)).status).toBe(200);
  });
});

describe('sign-in from the OAuth consent screen', () => {
  const REQ = 'r'.repeat(20) + '_-AbC0123456789xyz';

  it('allows returning to the same pending consent request, and nothing else', () => {
    expect(safeReturnTo(`/agents/authorize?request=${REQ}`)).toBe(`/agents/authorize?request=${REQ}`);
    for (const evil of [
      '/agents/authorize?request=short',
      `/agents/authorize?request=${REQ}&redirect_uri=https://evil.example`,
      `/agents/authorize?request=${REQ}&request=${REQ}`,
      `/agents/authorize?request=${REQ}<script>`,
      `/agents/authorize?code=${REQ}`,
      `//evil.example/agents/authorize?request=${REQ}`,
      `https://evil.example/agents/authorize?request=${REQ}`,
      `/agents/authorize/../../evil?request=${REQ}`,
      `/agents/authorize?request=${REQ}#//evil.example`,
      `/%2F%2Fevil.example/agents/authorize?request=${REQ}`,
      `/agents/approve?request=${REQ}`,
    ]) {
      expect(safeReturnTo(evil), evil).toBe('/?tab=settings');
    }
  });

  it('carries the consent request through AuthKit back to /account/connect', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const back = `/agents/authorize?request=${REQ}`;
    const { location } = await signInUser(app, workos, alice, browser(app), back);
    expect(location).toBe(`/account/connect?return_to=${encodeURIComponent(back)}`);
    const evil = await signInUser(app, workos, alice, browser(app), `${back}&next=https://evil.example`);
    expect(evil.location).toBe(`/account/connect?return_to=${encodeURIComponent('/?tab=settings')}`);
  });
});
