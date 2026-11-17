import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, connectAgent, createWorkspace, sampleInvoice, startD1, TestClock } from '../test/helpers';
import { GITHUB_TOKEN, buildOperatorApp, completeSetup, fakeGithub, fakeWorkos, routeFetch, type Browser } from '../test/operator';
import { runScheduledJobs } from '../scheduled';
import { percentile, groupOf } from './telemetry';
import { readdirSync } from 'node:fs';

const LATEST_MIGRATION = readdirSync(new URL('../../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().at(-1);

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const TABLES = [
  'operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit',
  'operator_state', 'telemetry_rollups', 'telemetry_errors', 'workspace_suspensions', 'workspace_activity', 'clients', 'invoices', 'workspaces',
];
beforeEach(async () => {
  await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const workos = fakeWorkos();
const github = fakeGithub();
const fetchRoutes = routeFetch({ 'api.workos.com': workos.fetch, 'api.github.com': github.fetch, 'ghe.example.com': github.fetch });

async function signedIn(clock = new TestClock()) {
  const built = buildOperatorApp(d1.db, { fetch: fetchRoutes, clock });
  const { browser: b } = await completeSetup(built.app, workos, { id: 'user_owner', email: 'owner@example.com' });
  return { ...built, b, client: api(built.app) };
}

describe('settings', () => {
  it('lists the registry, validates values and audits changes without values for secrets', async () => {
    const { b } = await signedIn();
    const list = await b.get('/api/operator/settings');
    expect(list.status).toBe(200);
    const keys = list.json.settings.map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['app.url', 'maintenance.enabled', 'registration.workspacesOpen', 'workos.apiKey', 'github.token', 'resend.apiKey']));
    expect(keys).not.toContain('operator.sessionSigningKey');
    expect(list.json.propagationSeconds).toBe(5);
    const apiKey = list.json.settings.find((s: { key: string }) => s.key === 'workos.apiKey');
    expect(apiKey).toMatchObject({ secret: true, isSet: true, source: 'database' });
    expect(apiKey).not.toHaveProperty('value');

    for (const [key, value] of [
      ['agents.registrationTtlSeconds', 5],
      ['agents.registrationTtlSeconds', 'abc'],
      ['maintenance.enabled', 'yes'],
      ['app.url', 'ftp://example.com'],
      ['app.url', 'http://example.com'],
      ['github.repository', 'not a repo'],
      ['nope.unknown', 1],
      ['operator.sessionSigningKey', 'x'],
    ] as const) {
      const res = await b.put(`/api/operator/settings/${key}`, { value });
      expect(res.status, `${key}=${value}`).toBe(400);
    }
    expect((await b.put('/api/operator/settings/app.url', { value: 'https://invoices.example.com/' })).status).toBe(200);
    expect((await b.get('/api/operator/settings')).json.settings.find((s: { key: string }) => s.key === 'app.url').value).toBe('https://invoices.example.com');
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const audit = await b.get('/api/operator/audit?action=settings');
    const entries = audit.json.entries.map((e: { target: string; detail: unknown }) => [e.target, e.detail]);
    expect(entries).toContainEqual(['github.token', { secret: true }]);
    expect(entries).toContainEqual(['app.url', { value: 'https://invoices.example.com' }]);
    expect(audit.text).not.toContain(GITHUB_TOKEN);
    // Reset restores the default.
    expect((await b.del('/api/operator/settings/app.url')).status).toBe(200);
    expect((await b.get('/api/operator/settings')).json.settings.find((s: { key: string }) => s.key === 'app.url').source).not.toBe('database');
  });

  it('take effect immediately in the writing isolate and within the TTL in others', async () => {
    const clock = new TestClock();
    const { b, client } = await signedIn(clock);
    const other = buildOperatorApp(d1.db, { fetch: fetchRoutes, clock });
    const otherClient = api(other.app);
    expect((await otherClient.get('/api/v1/health')).status).toBe(200);
    expect((await otherClient.post('/api/v1/workspaces')).status).toBe(201);

    await b.put('/api/operator/settings/registration.workspacesOpen', { value: false });
    const here = await client.post('/api/v1/workspaces');
    expect(here.status).toBe(403);
    expect(here.json.error.code).toBe('registration_closed');
    // The other isolate still has its cached snapshot...
    expect((await otherClient.post('/api/v1/workspaces')).status).toBe(201);
    // ...until the TTL (5 s) passes.
    clock.advance(5_001);
    expect((await otherClient.post('/api/v1/workspaces')).status).toBe(403);
  });

  it('drive the existing config (registration lifetime, APP_URL) through deps.config', async () => {
    const { b, client } = await signedIn();
    await b.put('/api/operator/settings/agents.registrationTtlSeconds', { value: 120 });
    await b.put('/api/operator/settings/app.url', { value: 'https://invoices.example.com' });
    const reg = await client.post('/api/v1/agents/register', { name: 'Bot', scopes: ['invoices:read'] });
    expect(reg.json.expires_in).toBe(120);
    expect(reg.json.verification_url).toMatch(/^https:\/\/invoices\.example\.com\//);
    await b.put('/api/operator/settings/registration.agentsOpen', { value: false });
    expect((await client.post('/api/v1/agents/register', { name: 'Bot', scopes: ['invoices:read'] })).json.error.code).toBe('registration_closed');
  });

  it('maintenance mode answers the public API and MCP with 503 but not health or the console', async () => {
    const { b, client, telemetry } = await signedIn();
    const telemetryFlush = () => telemetry.flush();
    const ws = await createWorkspace(client);
    await b.put('/api/operator/settings/maintenance.message', { value: 'Back at 10:00 UTC' });
    await b.put('/api/operator/settings/maintenance.enabled', { value: true });
    const res = await client.get('/api/v1/invoices', ws.token);
    expect(res.status).toBe(503);
    expect(res.json.error).toMatchObject({ code: 'maintenance', message: 'Back at 10:00 UTC' });
    expect(res.headers.get('retry-after')).toBe('300');
    expect((await client.post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ws.token)).status).toBe(503);
    expect((await client.get('/api/v1/health')).status).toBe(200);
    expect((await b.get('/api/operator/overview')).status).toBe(200);
    await telemetryFlush();
    const t = (await b.get('/api/operator/telemetry?range=1h')).json;
    expect(t.totals.maintenance).toBe(2);
    expect(t.totals.errors).toBe(0);
  });

  it('"Restart" bumps the config version so every isolate reloads', async () => {
    const { b } = await signedIn();
    const before = (await b.get('/api/operator/deployments')).json.configVersion;
    const res = await b.post('/api/operator/runtime/reload');
    expect(res.json.configVersion).toBeGreaterThan(before);
    expect((await b.get('/api/operator/audit?action=runtime.reload')).json.entries).toHaveLength(1);
  });
});

describe('users (workspaces and agents)', () => {
  async function populated() {
    const s = await signedIn();
    const ws = await createWorkspace(s.client);
    const agent = await connectAgent(s.client, ws.token, ['invoices:read', 'invoices:write']);
    await s.client.post('/api/v1/invoices', sampleInvoice({ toName: 'SECRET CLIENT Ltd', notes: 'PRIVATE NOTE 42' }), ws.token);
    await s.client.post('/api/v1/invoices', sampleInvoice({ toName: 'Other client' }), agent.api_key);
    const saved = await s.client.post('/api/v1/clients', { name: 'Hidden Client GmbH', email: 'secret-ap@hidden.example', address: '42 Confidential Road' }, ws.token);
    if (saved.status !== 201) throw new Error(`client create failed: ${saved.status} ${saved.text}`);
    return { ...s, ws, agent };
  }

  it('lists workspaces with metadata only (privacy boundary)', async () => {
    const { b, ws, telemetry } = await populated();
    await telemetry.flush();
    const res = await b.get('/api/operator/workspaces');
    expect(res.json.workspaces).toHaveLength(1);
    expect(res.json.workspaces[0]).toEqual({
      id: ws.workspace.id,
      createdAt: ws.workspace.createdAt,
      lastActivityAt: expect.any(Number),
      invoiceCount: 2,
      agentCount: 1,
      clientCount: 1,
      suspended: false,
      suspendedAt: null,
      suspensionReason: null,
    });
    expect((await b.get(`/api/operator/workspaces?q=${ws.workspace.id.slice(0, 6)}`)).json.workspaces).toHaveLength(1);
    expect((await b.get('/api/operator/workspaces?q=zzzz')).json.workspaces).toHaveLength(0);
    for (const path of ['/workspaces', '/agents', '/overview', '/telemetry?range=1h', '/telemetry?range=7d', '/audit', '/security']) {
      const r = await b.get(`/api/operator${path}`);
      expect(r.status).toBe(200);
      for (const leak of ['SECRET CLIENT', 'PRIVATE NOTE', 'Other client', 'Design work', 'Hidden Client', 'secret-ap@hidden.example', 'Confidential Road', ws.token]) {
        expect(r.text.includes(leak), `${path} leaked ${leak}`).toBe(false);
      }
    }
  });

  it('suspends a workspace: its token and agents get 403 until unsuspended', async () => {
    const { b, client, ws, agent } = await populated();
    expect((await b.post(`/api/operator/workspaces/${ws.workspace.id}/suspend`, { reason: 'abuse report' })).status).toBe(200);
    for (const token of [ws.token, agent.api_key]) {
      const res = await client.get('/api/v1/invoices', token);
      expect(res.status).toBe(403);
      expect(res.json.error).toMatchObject({ code: 'workspace_suspended' });
      expect((await client.post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)).status).toBe(403);
      expect((await client.get('/api/v1/clients', token)).json.error.code).toBe('workspace_suspended');
    }
    const listed = (await b.get('/api/operator/workspaces?status=suspended')).json.workspaces;
    expect(listed[0]).toMatchObject({ suspended: true, suspensionReason: 'abuse report' });
    // Another workspace is unaffected.
    const other = await createWorkspace(client);
    expect((await client.get('/api/v1/invoices', other.token)).status).toBe(200);
    expect((await b.post(`/api/operator/workspaces/${ws.workspace.id}/unsuspend`)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', ws.token)).status).toBe(200);
    expect((await client.get('/api/v1/invoices', agent.api_key)).status).toBe(200);
    const actions = (await b.get('/api/operator/audit?action=workspace')).json.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['workspace.unsuspend', 'workspace.suspend']);
  });

  it('deletes a workspace only with typed confirmation', async () => {
    const { b, client, ws } = await populated();
    expect((await b.del(`/api/operator/workspaces/${ws.workspace.id}`, { confirm: 'wrong' })).status).toBe(400);
    expect((await b.del(`/api/operator/workspaces/${ws.workspace.id}`, { confirm: ws.workspace.id })).status).toBe(204);
    expect((await client.get('/api/v1/invoices', ws.token)).status).toBe(401);
    for (const table of ['clients', 'invoices', 'agents', 'workspace_activity', 'workspace_suspensions']) {
      expect(await d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).bind(ws.workspace.id).first('n'), table).toBe(0);
    }
    expect((await b.del(`/api/operator/workspaces/${ws.workspace.id}`, { confirm: ws.workspace.id })).status).toBe(404);
  });

  it('lists agents across workspaces and force-revokes them', async () => {
    const { b, client, agent } = await populated();
    const list = await b.get('/api/operator/agents');
    expect(list.json.agents).toEqual([expect.objectContaining({ id: agent.agent.id, name: 'Test Agent', scopes: ['invoices:read', 'invoices:write'], revokedAt: null })]);
    expect((await b.post(`/api/operator/agents/${agent.agent.id}/revoke`)).json.result).toBe('revoked');
    expect((await client.get('/api/v1/invoices', agent.api_key)).status).toBe(401);
    expect((await b.get('/api/operator/agents?status=revoked')).json.agents).toHaveLength(1);
  });

  it('reports overview stats', async () => {
    const { b, telemetry } = await populated();
    await telemetry.flush();
    const o = (await b.get('/api/operator/overview')).json;
    expect(o.workspaces).toMatchObject({ total: 1, recent: 1, active7d: 1, suspended: 0 });
    expect(o.invoices).toMatchObject({ total: 2, recent: 2, byCreator: { user: { total: 1 }, agent: { total: 1 } } });
    expect(o.agents).toMatchObject({ active: 1, revoked: 0 });
    expect(o.clients).toEqual({ total: 1, recent: 1 });
    expect(o.api.last24h.requests).toBeGreaterThan(4);
    expect(o.requestsHourly).toHaveLength(24);
  });
});

describe('telemetry', () => {
  it('aggregates per route template (no ids) with status classes and latency', async () => {
    const { b, client, telemetry } = await signedIn();
    const ws = await createWorkspace(client);
    const created = await client.post('/api/v1/invoices', sampleInvoice(), ws.token);
    const id = created.json.invoice.id;
    await client.get(`/api/v1/invoices/${id}`, ws.token);
    await client.get(`/api/v1/invoices/${id}/pdf`, ws.token);
    await client.get('/api/v1/invoices?include_deleted=true', ws.token);
    const cl = await client.post('/api/v1/clients', { name: 'Telemetry Co' }, ws.token);
    await client.get(`/api/v1/clients/${cl.json.client.id}`, ws.token);
    await client.get('/api/v1/clients?include_deleted=true', ws.token);
    await client.post(`/api/v1/invoices/${id}/mark-sent`, undefined, ws.token);
    await client.get('/api/v1/invoices/summary', ws.token);
    await client.get('/api/v1/invoices', 'mi_ws_invalid');
    await client.get('/api/v1/nope');
    await client.post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_invoices', arguments: {} } }, ws.token);
    await telemetry.flush();
    const t = (await b.get('/api/operator/telemetry?range=1h')).json;
    const names = t.metrics.map((m: { metric: string }) => m.metric);
    expect(names).toEqual(
      expect.arrayContaining([
        'rest|POST /workspaces',
        'rest|POST /invoices',
        'rest|GET /invoices/:id',
        'rest|GET /invoices/:id/pdf',
        'rest|GET /invoices (sync)',
        'rest|GET /invoices',
        'rest|GET (unmatched)',
        'mcp|tool list_invoices',
        'rest|POST /clients',
        'rest|GET /clients/:id',
        'rest|GET /clients (sync)',
        'rest|POST /invoices/:id/mark-sent',
        'rest|GET /invoices/summary',
      ]),
    );
    expect(JSON.stringify(t)).not.toContain(cl.json.client.id);
    expect(JSON.stringify(t)).not.toContain('Telemetry Co');
    const groupOfMetric = (m: string) => t.metrics.find((x: { metric: string }) => x.metric === m).group;
    expect(groupOfMetric('rest|POST /invoices/:id/mark-sent')).toBe('Invoice status');
    expect(groupOfMetric('rest|GET /invoices/summary')).toBe('Invoice status');
    expect(groupOfMetric('rest|GET /clients/:id')).toBe('Clients');
    expect(groupOfMetric('rest|GET /clients (sync)')).toBe('Sync');
    expect(JSON.stringify(t)).not.toContain(id);
    const pdf = t.metrics.find((m: { metric: string }) => m.metric === 'rest|GET /invoices/:id/pdf');
    expect(pdf).toMatchObject({ group: 'PDF rendering', count: 1, errors: 0 });
    expect(t.totals.authFailures).toBeGreaterThanOrEqual(1);
    expect(t.groups.map((g: { group: string }) => g.group)).toEqual(expect.arrayContaining(['Sync', 'PDF rendering', 'MCP endpoint', 'Invoices']));
    expect(t.recentErrors.some((e: { status: number; metric: string }) => e.status === 401 && e.metric === 'rest|GET /invoices')).toBe(true);
    // The probe reports the newest applied migration (the last file in migrations/).
    expect(t.d1).toMatchObject({ ok: true, migration: LATEST_MIGRATION });
    expect(t.series).toHaveLength(60);
    // Rollups exist for both granularities.
    const g = await d1.db.prepare("SELECT DISTINCT granularity FROM telemetry_rollups ORDER BY granularity").all();
    expect(g.results.map((r) => r.granularity)).toEqual(['h', 'm']);
  });

  it('computes percentiles from the histogram', () => {
    expect(percentile(new Array(10).fill(0), 0.5)).toBeNull();
    expect(percentile([10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBe(3); // within [0, 5)
    expect(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 4], 0.95)).toBe(2500);
    expect(groupOf('rest|POST /agents/register').group).toBe('Agent registration');
  });

  it('never fails a request when telemetry or settings storage fails', async () => {
    const broken = new Proxy(d1.db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/telemetry_|workspace_activity|operator_settings/.test(sql)) throw new Error('D1 is on fire');
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const { app, telemetry, logged } = buildOperatorApp(broken, { fetch: fetchRoutes });
    const client = api(app);
    const ws = await createWorkspace(client);
    expect((await client.post('/api/v1/invoices', sampleInvoice(), ws.token)).status).toBe(201);
    await telemetry.flush();
    expect(logged.some((l) => /Telemetry flush failed|runtime settings/.test(l.message))).toBe(true);
  });

  it('prunes old rollups and caps recent errors via the scheduled job', async () => {
    const clock = new TestClock();
    const { client, telemetry, deps } = await signedIn(clock);
    await client.get('/api/v1/nope');
    await telemetry.flush();
    clock.advance(49 * 3_600_000);
    const results = await runScheduledJobs(deps, { cron: '17 * * * *', scheduledTime: clock.now.getTime() });
    expect(results).toEqual([{ name: 'operator.maintenance', ok: true }]);
    const rows = await d1.db.prepare('SELECT granularity, COUNT(*) AS n FROM telemetry_rollups GROUP BY granularity').all<{ granularity: string; n: number }>();
    expect(rows.results.find((r) => r.granularity === 'm')).toBeUndefined();
    expect(rows.results.find((r) => r.granularity === 'h')!.n).toBeGreaterThan(0);
    clock.advance(91 * 24 * 3_600_000);
    await runScheduledJobs(deps, { cron: '17 * * * *', scheduledTime: clock.now.getTime() });
    expect(await d1.db.prepare('SELECT COUNT(*) AS n FROM telemetry_rollups').first('n')).toBe(0);
    expect(await d1.db.prepare('SELECT COUNT(*) AS n FROM telemetry_errors').first('n')).toBe(0);
  });
});

describe('deployments', () => {
  async function configured(b: Browser) {
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    await b.put('/api/operator/settings/github.repository', { value: 'acme/midnight-invoice' });
  }

  it('reports missing configuration and build/version info', async () => {
    const { b } = await signedIn();
    const d = (await b.get('/api/operator/deployments')).json;
    expect(d).toMatchObject({ configured: false, missing: ['github.token', 'github.repository'], workflow: 'deploy.yml', ref: 'main' });
    expect(d.build).toEqual({ sha: 'deadbeef1234', time: '2026-11-17T09:00:00.000Z' });
    expect(d.version).toEqual({ id: 'ver-1', tag: 'v1', timestamp: '2026-11-17T09:00:00Z' });
    expect((await b.post('/api/operator/deployments/redeploy')).json.error.code).toBe('deploy_not_configured');
  });

  it('dispatches the deploy workflow through the GitHub REST API and lists runs', async () => {
    const { b } = await signedIn();
    await configured(b);
    await b.put('/api/operator/settings/github.ref', { value: 'release' });
    const before = github.dispatches.length;
    const res = await b.post('/api/operator/deployments/redeploy');
    expect(res.status).toBe(202);
    const sent = github.dispatches[before];
    expect(sent.url).toBe('https://api.github.com/repos/acme/midnight-invoice/actions/workflows/deploy.yml/dispatches');
    expect(sent.body).toEqual({ ref: 'release' });
    expect(sent.auth).toBe(`Bearer ${GITHUB_TOKEN}`);
    expect(sent.version).toBe('2022-11-28');
    const d = (await b.get('/api/operator/deployments')).json;
    expect(d.configured).toBe(true);
    expect(d.runs.length).toBeGreaterThan(0);
    expect(d.runs[0]).toMatchObject({ status: 'queued', event: 'workflow_dispatch' });
    expect(JSON.stringify(d)).not.toContain(GITHUB_TOKEN);
    expect((await b.get('/api/operator/audit?action=deploy')).json.entries[0]).toMatchObject({ action: 'deploy.redeploy', target: 'acme/midnight-invoice:deploy.yml@release' });
  });

  it('supports a custom API URL and surfaces GitHub errors', async () => {
    const { b } = await signedIn();
    await configured(b);
    await b.put('/api/operator/settings/github.apiUrl', { value: 'https://ghe.example.com/api/v3' });
    await b.put('/api/operator/settings/github.token', { value: 'github_pat_wrong_token_000000' });
    const res = await b.post('/api/operator/deployments/redeploy');
    expect(res.status).toBe(502);
    expect(res.json.error.message).toMatch(/rejected the token/);
  });
});
