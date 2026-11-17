/**
 * Test helpers: a real local D1 (workerd via wrangler's test harness, with
 * migrations applied) and an app built with controllable deps.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestHarness } from 'wrangler';
import { createApp } from '../app';
import { defaultDeps, type AppConfig, type AppDeps, type RateLimiter } from '../deps';
import type { CreateWorkspaceResponse, Scope } from '../../shared/api';

const ROOT = path.resolve(import.meta.dirname, '../..');

export async function startD1() {
  const harness = createTestHarness({
    root: ROOT,
    workers: [
      {
        config: {
          name: 'midnight-invoice-test',
          main: 'server/test/d1-host.worker.ts',
          compatibility_date: '2026-11-16',
          d1_databases: [{ binding: 'DB', database_name: 'test', database_id: 'test', migrations_dir: 'migrations' }],
        },
      },
    ],
  });
  await harness.listen();
  const worker = harness.getWorker<{ DB: D1Database }>();
  await worker.applyD1Migrations('DB');
  const env = await worker.getEnv();
  return { db: env.DB, close: () => harness.close() };
}

/** Reads `public/<path>` like the Worker reads static assets. */
export const readPublicAsset = async (assetPath: string): Promise<ArrayBuffer> => {
  const buf = await fs.readFile(path.join(ROOT, 'public', assetPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

export class TestClock {
  constructor(public now = new Date('2026-11-17T10:00:00.000Z')) {}
  fn = () => new Date(this.now.getTime());
  advance(ms: number) {
    this.now = new Date(this.now.getTime() + ms);
  }
}

/** Rate limiter double with a fixed per-key budget (like the binding, but deterministic). */
export function countingLimiter(limit: number): RateLimiter & { calls: string[] } {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

export function buildApp(
  db: D1Database,
  overrides: Partial<Omit<AppDeps, 'db' | 'config'>> & { config?: Partial<AppConfig> } = {},
) {
  const errors: unknown[] = [];
  const app = createApp(
    defaultDeps({ db, readAsset: readPublicAsset, logError: (_m, e) => errors.push(e), ...overrides }),
  );
  return { app, errors };
}

type App = ReturnType<typeof createApp>;

export const BASE = 'http://app.test';

export function api(app: App) {
  const call = async (method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }
    const res = await app.request(`${BASE}${url}`, { method, headers, body });
    const text = await res.text();
    let json: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped response bodies in tests
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, json, text };
  };
  return {
    call,
    get: (url: string, token?: string, headers?: Record<string, string>) => call('GET', url, { token, headers }),
    post: (url: string, body?: unknown, token?: string, headers?: Record<string, string>) => call('POST', url, { body, token, headers }),
    put: (url: string, body: unknown, token?: string, headers?: Record<string, string>) => call('PUT', url, { body, token, headers }),
    patch: (url: string, body: unknown, token?: string, headers?: Record<string, string>) => call('PATCH', url, { body, token, headers }),
    del: (url: string, token?: string, headers?: Record<string, string>) => call('DELETE', url, { token, headers }),
  };
}

export type Api = ReturnType<typeof api>;

export async function createWorkspace(client: Api): Promise<CreateWorkspaceResponse> {
  const res = await client.post('/api/v1/workspaces');
  if (res.status !== 201) throw new Error(`createWorkspace failed: ${res.status} ${res.text}`);
  return res.json;
}

/** Runs the whole device flow and returns the agent key. */
export async function connectAgent(client: Api, workspaceToken: string, scopes: Scope[], approveScopes?: Scope[], name = 'Test Agent') {
  const reg = await client.post('/api/v1/agents/register', { name, scopes });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
  const approve = await client.post(
    `/api/v1/agents/registrations/${reg.json.user_code}/approve`,
    approveScopes ? { scopes: approveScopes } : undefined,
    workspaceToken,
  );
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status} ${approve.text}`);
  const token = await client.post('/api/v1/agents/token', { device_code: reg.json.device_code });
  if (token.status !== 200) throw new Error(`token failed: ${token.status} ${token.text}`);
  return token.json as { api_key: string; agent: { id: string; name: string; scopes: Scope[]; workspace_id: string } };
}

export const sampleInvoice = (overrides: Record<string, unknown> = {}) => ({
  toName: 'Acme Corp',
  fromName: 'Midnight Studio',
  lineItems: [{ description: 'Design work', quantity: 2, price: 150 }],
  ...overrides,
});
