import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, buildApp, connectAgent, countingLimiter, createWorkspace, sampleInvoice, startD1, TestClock, type Api } from './test/helpers';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

function setup(opts: Parameters<typeof buildApp>[1] = {}) {
  const clock = new TestClock();
  const built = buildApp(d1.db, { clock: clock.fn, ...opts });
  return { clock, client: api(built.app), errors: built.errors };
}

async function register(client: Api, body: Record<string, unknown> = { name: 'Claude Desktop', description: 'Bookkeeping helper', scopes: ['invoices:read', 'invoices:write'] }) {
  return client.post('/api/v1/agents/register', body);
}

describe('workspaces', () => {
  it('creates a workspace with a one-time mi_ws_ token and reports identity', async () => {
    const { client } = setup();
    const res = await client.post('/api/v1/workspaces');
    expect(res.status).toBe(201);
    expect(res.json.token).toMatch(/^mi_ws_[A-Za-z0-9_-]{43}$/);
    expect(res.json.workspace.id).toMatch(/^[0-9a-f-]{36}$/);
    const me = await client.get('/api/v1/workspace', res.json.token);
    expect(me.status).toBe(200);
    expect(me.json.workspace).toEqual(res.json.workspace);
  });

  it('stores only a hash of the token', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const row = await d1.db.prepare('SELECT * FROM workspaces WHERE id = ?').bind(ws.workspace.id).first<Record<string, string>>();
    expect(JSON.stringify(row)).not.toContain(ws.token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects missing, malformed and unknown tokens with 401 + WWW-Authenticate', async () => {
    const { client } = setup();
    for (const token of [undefined, 'garbage', 'mi_ws_doesnotexist', 'mi_agent_doesnotexist']) {
      const res = await client.get('/api/v1/workspace', token);
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('unauthorized');
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer realm="midnight-invoice"/);
    }
  });

  it('DELETE /workspace removes the workspace and all its data', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const { api_key } = await connectAgent(client, ws.token, ['invoices:read']);
    await client.post('/api/v1/invoices', sampleInvoice(), ws.token);
    await client.put('/api/v1/settings', { fromName: 'X', fromEmail: '', fromAddress: '', paymentDetails: '', notes: '', taxRate: 0, currency: 'USD' }, ws.token);
    expect((await client.del('/api/v1/workspace', ws.token)).status).toBe(204);
    expect((await client.get('/api/v1/workspace', ws.token)).status).toBe(401);
    expect((await client.get('/api/v1/invoices', api_key)).status).toBe(401);
    for (const table of ['invoices', 'agents', 'workspace_settings']) {
      const row = await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).bind(ws.workspace.id).first<{ n: number }>();
      expect(row!.n).toBe(0);
    }
  });

  it('agents cannot read or delete the workspace', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const { api_key } = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read']);
    expect((await client.get('/api/v1/workspace', api_key)).status).toBe(403);
    expect((await client.del('/api/v1/workspace', api_key)).status).toBe(403);
  });
});

describe('agent device flow', () => {
  it('register → preview → approve → token → use', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);

    const reg = await register(client);
    expect(reg.status).toBe(201);
    expect(reg.json).toMatchObject({ expires_in: 600, interval: 5 });
    expect(reg.json.device_code).toMatch(/^mi_dc_[A-Za-z0-9_-]{43}$/);
    expect(reg.json.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(reg.json.verification_url).toBe('http://app.test/agents/approve');
    expect(reg.json.verification_url_complete).toBe(`http://app.test/agents/approve?code=${reg.json.user_code}`);

    const pending = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(pending.status).toBe(400);
    expect(pending.json.error.code).toBe('authorization_pending');

    const preview = await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, ws.token);
    expect(preview.status).toBe(200);
    expect(preview.json.registration).toMatchObject({
      id: reg.json.registration_id,
      name: 'Claude Desktop',
      description: 'Bookkeeping helper',
      requestedScopes: ['invoices:read', 'invoices:write'],
      userCode: reg.json.user_code,
    });

    const approve = await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, ws.token);
    expect(approve.status).toBe(200);
    expect(approve.json.registration).toEqual({ id: reg.json.registration_id, status: 'approved', scopes: ['invoices:read', 'invoices:write'] });

    const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(token.status).toBe(200);
    expect(token.json.token_type).toBe('Bearer');
    expect(token.json.api_key).toMatch(/^mi_agent_[A-Za-z0-9_-]{43}$/);
    expect(token.json.agent).toMatchObject({ name: 'Claude Desktop', scopes: ['invoices:read', 'invoices:write'], workspace_id: ws.workspace.id });

    const me = await client.get('/api/v1/agents/me', token.json.api_key);
    expect(me.status).toBe(200);
    expect(me.json.agent).toMatchObject({ id: token.json.agent.id, workspace_id: ws.workspace.id, scopes: ['invoices:read', 'invoices:write'] });

    const created = await client.post('/api/v1/invoices', sampleInvoice(), token.json.api_key);
    expect(created.status).toBe(201);
    expect(created.json.invoice.createdBy).toEqual({ type: 'agent', agentId: token.json.agent.id, agentName: 'Claude Desktop' });

    // Secrets are never persisted in clear text.
    const regRow = await d1.db.prepare('SELECT * FROM agent_registrations WHERE id = ?').bind(reg.json.registration_id).first();
    const agentRow = await d1.db.prepare('SELECT * FROM agents WHERE id = ?').bind(token.json.agent.id).first();
    expect(JSON.stringify(regRow)).not.toContain(reg.json.device_code);
    expect(JSON.stringify(agentRow)).not.toContain(token.json.api_key);
  });

  it('accepts user codes case-insensitively and without the dash', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    const sloppy = reg.json.user_code.replace('-', '').toLowerCase();
    expect((await client.get(`/api/v1/agents/registrations/${sloppy}`, ws.token)).status).toBe(200);
    expect((await client.get(`/api/v1/agents/registrations/${encodeURIComponent(reg.json.user_code.toLowerCase())}`, ws.token)).status).toBe(200);
  });

  it('a device_code is redeemable exactly once (sequential and concurrent)', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, ws.token);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.post('/api/v1/agents/token', { device_code: reg.json.device_code })),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(r.json.error.code).toBe('invalid_grant');

    const again = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(again.status).toBe(400);
    expect(again.json.error.code).toBe('invalid_grant');
    const agents = await client.get('/api/v1/agents', ws.token);
    expect(agents.json.agents).toHaveLength(1);
  });

  it('deny → access_denied, and the code cannot be approved afterwards', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    const deny = await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/deny`, undefined, ws.token);
    expect(deny.status).toBe(200);
    expect(deny.json.registration.status).toBe('denied');
    const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(token.json.error.code).toBe('access_denied');
    const approve = await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, ws.token);
    expect(approve.status).toBe(409);
  });

  it('expired registrations cannot be previewed, approved or redeemed', async () => {
    const { client, clock } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    clock.advance(601_000);
    const preview = await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, ws.token);
    expect(preview.status).toBe(410);
    const approve = await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, ws.token);
    expect(approve.status).toBe(410);
    const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(token.json.error.code).toBe('expired_token');
  });

  it('an approved but unredeemed registration expires too', async () => {
    const { client, clock } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, ws.token);
    clock.advance(600_000);
    const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(token.json.error.code).toBe('expired_token');
  });

  it('returns slow_down when polling faster than the interval', async () => {
    const { client, clock } = setup();
    const reg = await register(client);
    const first = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(first.json.error.code).toBe('authorization_pending');
    clock.advance(1000);
    const second = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(second.json.error.code).toBe('slow_down');
    clock.advance(5000);
    const third = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(third.json.error.code).toBe('authorization_pending');
  });

  it('unknown device codes are invalid_grant', async () => {
    const { client } = setup();
    const res = await client.post('/api/v1/agents/token', { device_code: 'mi_dc_nope' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_grant');
  });

  it('approval can narrow scopes but never widen them', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const reg = await register(client);
    const widen = await client.post(
      `/api/v1/agents/registrations/${reg.json.user_code}/approve`,
      { scopes: ['invoices:read', 'invoices:delete'] },
      ws.token,
    );
    expect(widen.status).toBe(400);
    expect(widen.json.error.code).toBe('invalid_scope');
    expect(widen.json.error.details.notRequested).toEqual(['invoices:delete']);

    const narrow = await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, { scopes: ['invoices:read'] }, ws.token);
    expect(narrow.status).toBe(200);
    const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
    expect(token.json.agent.scopes).toEqual(['invoices:read']);
    const write = await client.post('/api/v1/invoices', sampleInvoice(), token.json.api_key);
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe('insufficient_scope');
    expect(write.headers.get('www-authenticate')).toContain('scope="invoices:write"');
  });

  it('only a workspace token can approve, deny, list or revoke', async () => {
    const { client } = setup();
    const ws = await createWorkspace(client);
    const { api_key, agent } = await connectAgent(client, ws.token, ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read']);
    const reg = await register(client);
    expect((await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, api_key)).status).toBe(403);
    expect((await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/approve`, undefined, api_key)).status).toBe(403);
    expect((await client.post(`/api/v1/agents/registrations/${reg.json.user_code}/deny`, undefined, api_key)).status).toBe(403);
    expect((await client.get('/api/v1/agents', api_key)).status).toBe(403);
    expect((await client.del(`/api/v1/agents/${agent.id}`, api_key)).status).toBe(403);
    expect((await client.get('/api/v1/agents/me', ws.token)).status).toBe(403);
    expect((await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`)).status).toBe(401);
  });

  it('validates registration input', async () => {
    const { client } = setup();
    const cases = [
      {},
      { name: '', scopes: ['invoices:read'] },
      { name: 'x'.repeat(101), scopes: ['invoices:read'] },
      { name: 'A', scopes: [] },
      { name: 'A', scopes: ['admin'] },
      { name: 'A', scopes: ['invoices:read', 'invoices:read'] },
      { name: 'A', description: 'd'.repeat(501), scopes: ['invoices:read'] },
    ];
    for (const body of cases) {
      const res = await register(client, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe('validation_failed');
    }
    expect((await client.post('/api/v1/agents/register', '{not json')).json.error.code).toBe('invalid_json');
    const big = await client.post('/api/v1/agents/register', { name: 'A', scopes: ['invoices:read'], pad: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    const wrongType = await client.post('/api/v1/agents/register', 'name=x', undefined, { 'content-type': 'text/plain' });
    expect(wrongType.status).toBe(415);
  });

  it('uses APP_URL for verification links when configured', async () => {
    const { client } = setup({ config: { appUrl: 'https://invoices.example.com/' } });
    const reg = await register(client);
    expect(reg.json.verification_url_complete).toBe(`https://invoices.example.com/agents/approve?code=${reg.json.user_code}`);
  });
});

describe('agent management', () => {
  it('lists agents with metadata and revocation is immediate', async () => {
    const { client, clock } = setup();
    const ws = await createWorkspace(client);
    const { api_key, agent } = await connectAgent(client, ws.token, ['invoices:read'], undefined, 'Revokable');
    expect((await client.get('/api/v1/invoices', api_key)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50)); // lastUsedAt is written in the background

    const list = await client.get('/api/v1/agents', ws.token);
    expect(list.json.agents).toEqual([
      {
        id: agent.id,
        name: 'Revokable',
        description: null,
        scopes: ['invoices:read'],
        createdAt: clock.now.toISOString(),
        lastUsedAt: clock.now.toISOString(),
        revokedAt: null,
        connection: 'api_key',
      },
    ]);

    expect((await client.del(`/api/v1/agents/${agent.id}`, ws.token)).status).toBe(204);
    const after = await client.get('/api/v1/invoices', api_key);
    expect(after.status).toBe(401);
    const listed = await client.get('/api/v1/agents', ws.token);
    expect(listed.json.agents[0].revokedAt).toBe(clock.now.toISOString());
    // Idempotent; unknown ids are 404.
    expect((await client.del(`/api/v1/agents/${agent.id}`, ws.token)).status).toBe(204);
    expect((await client.del('/api/v1/agents/00000000-0000-0000-0000-000000000000', ws.token)).status).toBe(404);
  });

  it('throttles lastUsedAt writes', async () => {
    const { client, clock } = setup({ config: { lastUsedThrottleSeconds: 60 } });
    const ws = await createWorkspace(client);
    const { api_key } = await connectAgent(client, ws.token, ['invoices:read']);
    const firstUse = clock.now.toISOString();
    await client.get('/api/v1/invoices', api_key);
    await new Promise((r) => setTimeout(r, 30));
    clock.advance(10_000);
    await client.get('/api/v1/invoices', api_key);
    await new Promise((r) => setTimeout(r, 30));
    expect((await client.get('/api/v1/agents', ws.token)).json.agents[0].lastUsedAt).toBe(firstUse);
    clock.advance(60_000);
    await client.get('/api/v1/invoices', api_key);
    await new Promise((r) => setTimeout(r, 30));
    expect((await client.get('/api/v1/agents', ws.token)).json.agents[0].lastUsedAt).toBe(clock.now.toISOString());
  });

  it("a workspace cannot revoke another workspace's agent", async () => {
    const { client } = setup();
    const a = await createWorkspace(client);
    const b = await createWorkspace(client);
    const { api_key, agent } = await connectAgent(client, a.token, ['invoices:read']);
    expect((await client.del(`/api/v1/agents/${agent.id}`, b.token)).status).toBe(404);
    expect((await client.get('/api/v1/agents', b.token)).json.agents).toEqual([]);
    expect((await client.get('/api/v1/invoices', api_key)).status).toBe(200);
  });
});

describe('rate limiting and brute-force protection', () => {
  it('limits unauthenticated endpoints per client IP via the rate-limit bindings', async () => {
    const create = countingLimiter(2);
    const poll = countingLimiter(2);
    const { client } = setup({ rateLimiters: { create, poll } });
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    expect((await client.post('/api/v1/workspaces', undefined, undefined, headers)).status).toBe(201);
    expect((await client.post('/api/v1/workspaces', undefined, undefined, headers)).status).toBe(201);
    const limited = await client.post('/api/v1/workspaces', undefined, undefined, headers);
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('rate_limited');
    expect(limited.headers.get('retry-after')).toBe('60');
    // Another IP has its own budget; registration has its own key.
    expect((await client.post('/api/v1/workspaces', undefined, undefined, { 'cf-connecting-ip': '198.51.100.1' })).status).toBe(201);
    const body = { name: 'A', scopes: ['invoices:read'] };
    expect((await client.post('/api/v1/agents/register', body, undefined, headers)).status).toBe(201);
    expect((await client.post('/api/v1/agents/register', body, undefined, headers)).status).toBe(201);
    expect((await client.post('/api/v1/agents/register', body, undefined, headers)).status).toBe(429);
    expect(create.calls).toContain('workspace:203.0.113.7');
    expect(create.calls).toContain('register:203.0.113.7');

    for (let i = 0; i < 2; i++) await client.post('/api/v1/agents/token', { device_code: 'mi_dc_x' }, undefined, headers);
    expect((await client.post('/api/v1/agents/token', { device_code: 'mi_dc_x' }, undefined, headers)).status).toBe(429);
  });

  it('locks user-code lookups after repeated misses (per workspace and per IP, D1 counter)', async () => {
    const { client, clock } = setup({ config: { userCodeFailureLimit: 3, userCodeFailureWindowSeconds: 600, registrationTtlSeconds: 3600 } });
    const ws = await createWorkspace(client);
    const other = await createWorkspace(client);
    const reg = await register(client);
    const ipA = { 'cf-connecting-ip': '192.0.2.10' };
    for (const code of ['BBBB-BBBB', 'CCCC-CCCC', 'not-a-code']) {
      expect((await client.get(`/api/v1/agents/registrations/${code}`, ws.token, ipA)).status).toBe(404);
    }
    // Locked for this workspace even with the right code and a different IP...
    const locked = await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, ws.token, { 'cf-connecting-ip': '192.0.2.99' });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // ...and for this IP even with another workspace.
    expect((await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, other.token, ipA)).status).toBe(429);
    // Other workspace + other IP is unaffected; successful lookups do not count.
    expect((await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, other.token, { 'cf-connecting-ip': '192.0.2.50' })).status).toBe(200);
    // The window ends.
    clock.advance(600_000);
    expect((await client.get(`/api/v1/agents/registrations/${reg.json.user_code}`, ws.token, ipA)).status).toBe(200);
  });
});
