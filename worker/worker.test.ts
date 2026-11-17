/**
 * End-to-end tests of the built Worker (dist/, from `vite build`) running in
 * workerd with a local D1 database and the static-assets layer, i.e. the
 * same artefact `wrangler deploy` uploads.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import { extractPdfText } from '../server/test/pdf-text';

const ROOT = path.resolve(import.meta.dirname, '..');
let server: TestHarness;
let base: string;

beforeAll(async () => {
  server = createTestHarness({ root: ROOT, workers: [{ configPath: 'dist/midnight_invoice/wrangler.json' }] });
  const { url } = await server.listen();
  base = url.origin;
  await server.getWorker().applyD1Migrations('DB');
});
afterAll(async () => {
  await server?.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped response bodies in tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const post = (p: string, body: unknown, token?: string) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('SPA and API routing in workerd', () => {
  it('serves the SPA for / and for client-side deep links', async () => {
    for (const p of ['/', '/create', '/invoice/abc123', '/agents/approve?code=BCDF-GHJK']) {
      const res = await fetch(`${base}${p}`, { headers: { accept: 'text/html' } });
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  it('serves static files (llms.txt, fonts) from assets', async () => {
    const llms = await fetch(`${base}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(await llms.text()).toContain('/api/v1/openapi.json');
    const font = await fetch(`${base}/fonts/NotoSansMono-Regular.ttf`);
    expect(font.status).toBe(200);
  });

  it('routes /api/* to the Worker, never to the SPA fallback', async () => {
    const health = await fetch(`${base}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
    const missing = await fetch(`${base}/api/v1/does-not-exist`, { headers: { accept: 'text/html' } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toMatch(/application\/json/);
    const openapi = await fetch(`${base}/api/v1/openapi.json`);
    expect(((await openapi.json()) as { openapi: string }).openapi).toBe('3.1.0');
  });
});

describe('agent flow, REST, MCP and PDF in workerd', () => {
  it('works end to end', async () => {
    const ws = await json(await post('/api/v1/workspaces', undefined));
    expect(ws.status).toBe(201);
    const token = ws.body.token as string;

    const reg = await json(await post('/api/v1/agents/register', { name: 'E2E Agent', scopes: ['invoices:read', 'invoices:write'] }));
    expect(reg.status).toBe(201);
    expect(reg.body.verification_url_complete).toBe(`${base}/agents/approve?code=${reg.body.user_code}`);
    expect((await json(await post('/api/v1/agents/token', { device_code: reg.body.device_code }))).body.error.code).toBe('authorization_pending');
    expect((await post(`/api/v1/agents/registrations/${reg.body.user_code}/approve`, { scopes: ['invoices:read', 'invoices:write'] }, token)).status).toBe(200);
    const redeemed = await json(await post('/api/v1/agents/token', { device_code: reg.body.device_code }));
    expect(redeemed.status).toBe(200);
    const key = redeemed.body.api_key as string;

    const created = await json(
      await post('/api/v1/invoices', { toName: 'Initech', fromName: 'Midnight', currency: 'EUR', lineItems: [{ description: 'TPS reports', quantity: 3, price: 99.5 }] }, key),
    );
    expect(created.status).toBe(201);
    expect(created.body.invoice).toMatchObject({ invoiceNumber: 'INV-0001', total: 298.5, createdBy: { type: 'agent', agentName: 'E2E Agent' } });

    // MCP with the official client over real HTTP.
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    });
    const mcp = new Client({ name: 'e2e', version: '1.0.0' });
    await mcp.connect(transport);
    const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'create_invoice',
      'get_invoice',
      'get_invoice_pdf',
      'get_invoice_summary',
      'get_next_invoice_number',
      'list_invoices',
      'set_invoice_status',
      'update_invoice',
    ]);
    const next = await mcp.callTool({ name: 'get_next_invoice_number', arguments: {} });
    expect(JSON.parse((next.content as { text: string }[])[0].text)).toEqual({ invoiceNumber: 'INV-0002' });
    const pdfTool = await mcp.callTool({ name: 'get_invoice_pdf', arguments: { id: created.body.invoice.id } });
    expect(pdfTool.isError).toBeFalsy();
    await mcp.close();

    // Server-side PDF from the same InvoicePDF component, inside workerd.
    const pdf = await fetch(`${base}/api/v1/invoices/${created.body.invoice.id}/pdf`, { headers: { authorization: `Bearer ${key}` } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const text = extractPdfText(bytes);
    for (const s of ['INV-0001', 'Initech', 'TPS reports', '€298.50']) expect(text).toContain(s);
  });
});

describe('OAuth for MCP in workerd', () => {
  it('routes the discovery documents to the Worker and protects the consent page from framing', async () => {
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server']) {
      const res = await fetch(`${base}${p}`, { headers: { accept: 'text/html' } });
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type'), p).toMatch(/application\/json/);
    }
    const oidc = await fetch(`${base}/.well-known/openid-configuration`, { headers: { accept: 'text/html' } });
    expect(oidc.status).toBe(404);
    expect(oidc.headers.get('content-type')).toMatch(/application\/json/);
    for (const p of ['/agents/authorize?request=x', '/agents', '/agents/approve', '/', '/index.html']) {
      const page = await fetch(`${base}${p}`, { headers: { accept: 'text/html' } });
      expect(page.status, p).toBe(200);
      expect(await page.text()).toContain('<div id="root">');
      expect(page.headers.get('x-frame-options'), p).toBe('DENY');
      expect(page.headers.get('content-security-policy'), p).toBe("frame-ancestors 'none'");
    }
    const challenge = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('www-authenticate')).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it('connects the official MCP client SDK with OAuth over real HTTP', async () => {
    const ws = (await json(await post('/api/v1/workspaces', undefined))).body.token as string;
    const redirect = 'http://127.0.0.1:43117/callback';
    const store: { info?: StoredOAuthClientInformation; tokens?: StoredOAuthTokens; verifier?: string; discovery?: OAuthDiscoveryState; url?: URL } = {};
    const provider: OAuthClientProvider = {
      redirectUrl: redirect,
      clientMetadata: { client_name: 'workerd e2e', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' },
      clientInformation: () => store.info,
      saveClientInformation: (i) => void (store.info = i),
      tokens: () => store.tokens,
      saveTokens: (t) => void (store.tokens = t),
      redirectToAuthorization: (u) => void (store.url = u),
      saveCodeVerifier: (v) => void (store.verifier = v),
      codeVerifier: () => store.verifier!,
      saveDiscoveryState: (d) => void (store.discovery = d),
      discoveryState: () => store.discovery,
    };
    const first = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { authProvider: provider });
    await expect(new Client({ name: 'e2e', version: '1.0.0' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    const landing = await fetch(store.url!, { redirect: 'manual' });
    expect(landing.status).toBe(302);
    const consent = new URL(landing.headers.get('location')!);
    expect(consent.pathname).toBe('/agents/authorize');
    const decision = await json(await post(`/api/v1/oauth/requests/${consent.searchParams.get('request')}/approve`, { scopes: ['invoices:read'] }, ws));
    expect(decision.status).toBe(200);
    await first.finishAuth(new URL(decision.body.redirectTo).searchParams);
    const mcp = new Client({ name: 'e2e', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { authProvider: provider }));
    expect((await mcp.listTools()).tools.map((t) => t.name)).toContain('list_invoices');
    expect((await mcp.listTools()).tools.map((t) => t.name)).not.toContain('create_invoice');
    await mcp.close();
  });
});
