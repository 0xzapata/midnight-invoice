import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { defaultDeps } from './deps';
import { buildOpenApiDocument } from './openapi';
import { DEFAULT_INVOICE_THEME, INVOICE_THEMES } from '@/components/invoice/invoiceTheme';

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

function routedOperations(): Set<string> {
  const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));
  const ops = new Set<string>();
  for (const r of app.routes) {
    const method = r.method.toLowerCase();
    if (!METHODS.includes(method) || !r.path.startsWith('/api/v1/')) continue;
    ops.add(`${method} ${r.path.slice('/api/v1'.length)}`);
  }
  return ops;
}

function documentedOperations(): Set<string> {
  const doc = buildOpenApiDocument('http://app.test');
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item as object)) {
      if (METHODS.includes(method)) ops.add(`${method} ${path.replace(/\{([^}]+)\}/g, ':$1')}`);
    }
  }
  return ops;
}

describe('OpenAPI document', () => {
  it('documents exactly the routed /api/v1 operations', () => {
    const routed = routedOperations();
    const documented = documentedOperations();
    expect([...documented].filter((op) => !routed.has(op))).toEqual([]);
    expect([...routed].filter((op) => !documented.has(op))).toEqual([]);
    expect(routed.size).toBeGreaterThanOrEqual(20);
  });

  it('is OpenAPI 3.1 with resolvable component refs and declared security', () => {
    const doc = buildOpenApiDocument('https://example.com');
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://example.com/api/v1' }]);
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    for (const name of refs) expect(doc.components.schemas, name).toHaveProperty(name);
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item as Record<string, { security?: unknown; responses: object }>)) {
        expect(op.security).toBeDefined();
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      }
    }
  });

  it('documents the optional PDF theme query parameter', () => {
    const doc = buildOpenApiDocument('http://app.test');
    const op = (doc.paths['/invoices/{id}/pdf'] as { get: { parameters: { name: string; in: string; required: boolean; schema: { enum: string[]; default: string } }[]; responses: object } }).get;
    const theme = op.parameters.find((p) => p.name === 'theme');
    expect(theme).toMatchObject({ in: 'query', required: false, schema: { enum: [...INVOICE_THEMES], default: DEFAULT_INVOICE_THEME } });
    expect(op.responses).toHaveProperty('400');
  });

  it('keeps the private operator console (/api/operator/*) out of the public document', () => {
    const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));
    const operatorRoutes = app.routes.filter((r) => r.path.startsWith('/api/operator/') && METHODS.includes(r.method.toLowerCase()));
    // The exclusion is explicit: these routes exist, are not under /api/v1, and are never documented.
    expect(operatorRoutes.length).toBeGreaterThanOrEqual(20);
    for (const op of routedOperations()) expect(op).not.toMatch(/operator/);
    const doc = JSON.stringify(buildOpenApiDocument('http://app.test'));
    expect(doc).not.toMatch(/operator/i);
  });

  it('keeps the cookie-authenticated account API (/api/account/*) out of the public document', () => {
    // Rule: endpoints authenticated by the user session cookie live under /api/account, never
    // under /api/v1, and are documented in AGENTS.md "User accounts" (browser-only contract in
    // shared/accounts.ts), not in openapi.json / AGENT_API.md "Endpoints". The bearer API stays
    // cookie-free; the only /api/v1 change is the `account_required` error on POST /workspaces.
    const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));
    const accountRoutes = app.routes.filter((r) => r.path.startsWith('/api/account') && METHODS.includes(r.method.toLowerCase()));
    expect(accountRoutes.length).toBeGreaterThanOrEqual(12);
    for (const op of routedOperations()) expect(op).not.toMatch(/account|sign-in|sign-out|recovery-key|devices/);
    const doc = buildOpenApiDocument('http://app.test');
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/\/api\/account|mi_user_session|csrf/i);
    const post = (doc.paths['/workspaces'] as { post: { responses: Record<string, { description: string }> } }).post;
    expect(post.responses[403].description).toMatch(/account_required/);
  });

  it('is served at /api/v1/openapi.json with the request origin', async () => {
    const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));
    const res = await app.request('https://invoices.example.org/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { servers: { url: string }[] };
    expect(doc.servers[0].url).toBe('https://invoices.example.org/api/v1');
  });
});
