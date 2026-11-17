import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { defaultDeps } from './deps';
import { buildOpenApiDocument } from './openapi';

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

  it('is served at /api/v1/openapi.json with the request origin', async () => {
    const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));
    const res = await app.request('https://invoices.example.org/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { servers: { url: string }[] };
    expect(doc.servers[0].url).toBe('https://invoices.example.org/api/v1');
  });
});
