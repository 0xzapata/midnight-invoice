/** OAuth events in the workspace activity log (server/services/activity.ts). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { api, BASE, buildApp, createWorkspace, sampleInvoice, startD1, TestClock } from './test/helpers';
import { authorize, connectOAuth, REDIRECT, registerClient, requestIdOf, tokenRequest, VERIFIER } from './test/oauth';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

function setup() {
  const clock = new TestClock();
  const built = buildApp(d1.db, { clock: clock.fn });
  return { app: built.app, client: api(built.app), clock };
}

type Entry = {
  action: string;
  actor: { type: string; agentId?: string; agentName?: string };
  entity: { type: string; id: string; label: string | null } | null;
  changes: Record<string, unknown> | null;
  source: string;
  tool: string | null;
};

async function activity(client: ReturnType<typeof api>, token: string, path = '/api/v1/activity'): Promise<Entry[]> {
  const res = await client.get(path, token);
  if (res.status !== 200) throw new Error(`activity: ${res.status} ${res.text}`);
  return res.json.activity;
}
const actions = (entries: Entry[]) => entries.map((e) => e.action);

describe('OAuth activity', () => {
  it('records authorization (narrowed), connection, MCP tool calls, re-authorisation and revocation, without secrets', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const reg = await registerClient(client, { client_name: 'Claude Code' });
    const first = await connectOAuth(app, client, ws.token, {
      clientId: reg.client_id,
      scope: 'invoices:read invoices:write invoices:delete',
      approve: ['invoices:read', 'invoices:write'],
    });

    // MCP tool call with the OAuth token: attributed to the agent, source mcp + tool.
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${first.tokens.access_token}` } },
    });
    const mcp = new Client({ name: 't', version: '1' });
    await mcp.connect(transport);
    expect((await mcp.callTool({ name: 'create_invoice', arguments: sampleInvoice() })).isError).toBeFalsy();
    await mcp.close();

    let log = await activity(client, ws.token);
    const authorized = log.find((e) => e.action === 'agent.oauth_authorized')!;
    expect(authorized).toMatchObject({
      actor: { type: 'user' },
      entity: { type: 'oauth_client', id: expect.stringMatching(/^oc_[0-9a-f]{16}$/), label: 'Claude Code' },
      changes: { scopes: ['invoices:read', 'invoices:write'], requestedScopes: ['invoices:read', 'invoices:write', 'invoices:delete'] },
      source: 'rest',
    });
    const connected = log.find((e) => e.action === 'agent.oauth_connected')!;
    const agentId = connected.actor.agentId!;
    expect(connected).toMatchObject({ actor: { type: 'agent', agentName: 'Claude Code' }, entity: { type: 'agent', id: agentId }, changes: { scopes: ['invoices:read', 'invoices:write'] } });
    expect(log.find((e) => e.action === 'invoice.created')).toMatchObject({ actor: { type: 'agent', agentId, agentName: 'Claude Code' }, source: 'mcp', tool: 'create_invoice' });

    // Re-authorisation with the same scopes: an authorization entry, no scope change.
    await connectOAuth(app, client, ws.token, { clientId: reg.client_id, scope: 'invoices:read invoices:write' });
    // Re-authorisation with fewer scopes: scope change recorded with the previous scopes.
    await connectOAuth(app, client, ws.token, { clientId: reg.client_id, scope: 'invoices:read' });
    log = await activity(client, ws.token);
    expect(actions(log).filter((a) => a === 'agent.oauth_scopes_changed')).toHaveLength(1);
    expect(log.find((e) => e.action === 'agent.oauth_scopes_changed')).toMatchObject({
      actor: { type: 'agent', agentId },
      changes: { scopes: ['invoices:read'], previousScopes: ['invoices:read', 'invoices:write'] },
    });
    // Once the agent exists, the user's re-authorisations are about the agent itself.
    expect(log.filter((e) => e.action === 'agent.oauth_authorized').map((e) => e.entity?.type)).toEqual(['agent', 'agent', 'oauth_client']);

    // Revoking an OAuth agent produces the same agent.revoked entry as for key agents.
    expect((await client.del(`/api/v1/agents/${agentId}`, ws.token)).status).toBe(204);
    log = await activity(client, ws.token);
    expect(log[0]).toMatchObject({ action: 'agent.revoked', actor: { type: 'user' }, entity: { type: 'agent', id: agentId, label: 'Claude Code' } });

    // The per-agent view shows what happened to it.
    const agentLog = await activity(client, ws.token, `/api/v1/agents/${agentId}/activity`);
    expect(actions(agentLog)).toEqual(
      expect.arrayContaining(['agent.revoked', 'agent.oauth_scopes_changed', 'agent.oauth_authorized', 'agent.oauth_connected', 'invoice.created']),
    );

    // Nothing secret or request-specific in any entry.
    const raw = JSON.stringify(await activity(client, ws.token));
    for (const leak of [first.tokens.access_token, first.tokens.refresh_token!, first.code, first.requestId, REDIRECT, reg.client_id, '127.0.0.1']) {
      expect(raw.includes(leak), `activity leaked ${leak.slice(0, 16)}`).toBe(false);
    }
  });

  it('records denials', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const reg = await registerClient(client, { client_name: 'Unknown Tool' });
    const requestId = requestIdOf(await authorize(app, { client_id: reg.client_id, scope: 'invoices:read' }));
    await client.post(`/api/v1/oauth/requests/${requestId}/deny`, undefined, ws.token);
    const [entry] = await activity(client, ws.token);
    expect(entry).toMatchObject({ action: 'agent.oauth_denied', actor: { type: 'user' }, entity: { type: 'oauth_client', label: 'Unknown Tool' }, changes: { requestedScopes: ['invoices:read'] } });
  });

  it('records refresh-token and code reuse once, as a system security entry', async () => {
    const { app, client } = setup();
    const ws = await createWorkspace(client);
    const a = await connectOAuth(app, client, ws.token);
    const rotated = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: a.tokens.refresh_token!, client_id: a.clientId });
    expect(rotated.status).toBe(200);
    for (let i = 0; i < 2; i++) {
      expect((await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: a.tokens.refresh_token!, client_id: a.clientId })).status).toBe(400);
    }
    // Code reuse on a second connection.
    const b = await connectOAuth(app, client, ws.token, { clientId: a.clientId });
    await tokenRequest(app, { grant_type: 'authorization_code', code: b.code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: a.clientId });

    const reuse = (await activity(client, ws.token)).filter((e) => e.action === 'agent.oauth_reuse_detected');
    expect(reuse).toHaveLength(2);
    expect(reuse.map((e) => e.changes?.credential).sort()).toEqual(['authorization_code', 'refresh_token']);
    for (const e of reuse) expect(e).toMatchObject({ actor: { type: 'system' }, entity: { type: 'agent', label: 'Test MCP Client' } });
  });
});
