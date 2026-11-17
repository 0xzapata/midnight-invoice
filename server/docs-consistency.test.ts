/**
 * The agent-facing contract is described in four places that drift easily:
 * shared/api.ts (SCOPES), the OpenAPI document, AGENT_API.md and public/llms.txt
 * (plus the README's device-flow list). These tests keep scopes and MCP tools
 * consistent across all of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SCOPES, SCOPE_DESCRIPTIONS } from '../shared/api';
import { buildOpenApiDocument } from './openapi';
import { groupOf } from './operator/telemetry';
import { MCP_SERVER_INFO } from './mcp';
import { APP_VERSION } from '../shared/version';
import { api, BASE, buildApp, connectAgent, createWorkspace, startD1 } from './test/helpers';

const ROOT = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const AGENT_API = read('AGENT_API.md');
const LLMS = read('public/llms.txt');
const README = read('README.md');

/** The rows of the first Markdown table after `heading`, as arrays of cells. */
function tableAfter(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const lines = markdown.slice(start).split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));
  }
  return rows.slice(2); // header + separator
}
const codeNames = (cell: string) => [...cell.matchAll(/`([a-z_:]+)`/g)].map((m) => m[1]);

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

describe('scopes are documented everywhere', () => {
  it('SCOPE_DESCRIPTIONS covers exactly SCOPES', () => {
    expect(Object.keys(SCOPE_DESCRIPTIONS).sort()).toEqual([...SCOPES].sort());
  });

  it('the OpenAPI document declares every scope and only known scopes', () => {
    const doc = buildOpenApiDocument('https://invoices.example.com') as {
      components: { schemas: { Scope: { enum: string[]; description: string } } };
      paths: Record<string, Record<string, { 'x-required-scope'?: string }>>;
    };
    expect(doc.components.schemas.Scope.enum).toEqual([...SCOPES]);
    for (const scope of SCOPES) expect(doc.components.schemas.Scope.description, scope).toContain(`${scope}:`);
    const required = Object.values(doc.paths).flatMap((ops) => Object.values(ops).map((op) => op['x-required-scope']).filter(Boolean));
    expect(required.length).toBeGreaterThan(0);
    for (const scope of required) expect(SCOPES as readonly string[], scope).toContain(scope);
  });

  it('AGENT_API.md has a row for every scope in its Scopes table, and nothing else', () => {
    const documented = tableAfter(AGENT_API, '### Scopes').map((row) => codeNames(row[0])[0]);
    expect(documented.sort()).toEqual([...SCOPES].sort());
  });

  it('llms.txt and the README device-flow list name every scope', () => {
    for (const scope of SCOPES) {
      expect(LLMS, `llms.txt: ${scope}`).toContain(scope);
      expect(README, `README: ${scope}`).toContain(`\`${scope}\``);
    }
  });
});

describe('MCP tools are documented', () => {
  it('AGENT_API.md lists exactly the tools an agent with every scope gets', async () => {
    const { app } = buildApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    const agent = await connectAgent(client, ws.token, [...SCOPES]);
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { authorization: `Bearer ${agent.api_key}` } },
    });
    const mcp = new Client({ name: 'docs-consistency', version: '1.0.0' });
    await mcp.connect(transport);
    const served = (await mcp.listTools()).tools.map((t) => t.name).sort();
    await mcp.close();

    const rows = tableAfter(AGENT_API, 'Tools (only those your scopes allow are listed');
    const documented = rows.flatMap((row) => codeNames(row[0])).sort();
    expect(documented).toEqual(served);
    // Each row names only known scopes.
    for (const row of rows) for (const scope of codeNames(row[1])) expect(SCOPES as readonly string[], `${row[0]}: ${scope}`).toContain(scope);
  });
});

describe('release version', () => {
  it('package.json, the CHANGELOG, the OpenAPI document and the MCP server agree', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(read('CHANGELOG.md')).toContain(`## [${pkg.version}]`);
    expect((buildOpenApiDocument('https://invoices.example.com') as { info: { version: string } }).info.version).toBe(pkg.version);
    expect(MCP_SERVER_INFO.version).toBe(pkg.version);
  });
});

describe('operator telemetry', () => {
  it('puts every documented /api/v1 route in a named group (none in "REST: other")', () => {
    const doc = buildOpenApiDocument('https://invoices.example.com') as { paths: Record<string, Record<string, unknown>> };
    const other: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/v1/')) continue; // /api/mcp is its own service
      const route = path.replace(/^\/api\/v1/, '').replace(/\{(\w+)\}/g, ':$1');
      for (const method of Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))) {
        if (groupOf(`rest|${method.toUpperCase()} ${route}`).group === 'REST: other') other.push(`${method.toUpperCase()} ${route}`);
      }
    }
    expect(other).toEqual([]);
  });
});
