/**
 * End-to-end tests of the built Worker (dist/, from `vite build`) running in
 * workerd with a local D1 database and the static-assets layer, i.e. the
 * same artefact `wrangler deploy` uploads.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { extractPdfText, pdfBaseFonts } from '../server/test/pdf-text';

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

    // Characters outside Noto Sans Mono get fallback faces read from static assets.
    const cjk = await json(await post('/api/v1/invoices', { toName: '株式会社テスト', fromName: 'Midnight', lineItems: [{ description: '网站设计 🚀', quantity: 1, price: 1 }] }, key));
    const cjkPdf = new Uint8Array(await (await fetch(`${base}/api/v1/invoices/${cjk.body.invoice.id}/pdf`, { headers: { authorization: `Bearer ${key}` } })).arrayBuffer());
    const cjkText = extractPdfText(cjkPdf).replace(/\n/g, '');
    for (const s of ['株式会社テスト', '网站设计', '🚀']) expect(cjkText).toContain(s);
    expect(pdfBaseFonts(cjkPdf).map((f) => f.replace(/^[A-Z]{6}\+/, ''))).toEqual(expect.arrayContaining([expect.stringMatching(/^NotoSansSC/), expect.stringMatching(/^NotoEmoji/)]));
  });
});
