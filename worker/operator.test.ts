/**
 * Operator console in the built bundle (dist/, run in workerd). The test
 * deployment has no INITIAL_PASSWORD secret, so the console must be disabled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';

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

describe('operator console in the deployable bundle', () => {
  it('is disabled with 503 when INITIAL_PASSWORD is not set', async () => {
    for (const p of ['/api/operator/status', '/api/operator/session']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('operator_not_configured');
      expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    }
    const login = await fetch(`${base}/api/operator/bootstrap/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ password: '' }),
    });
    expect(login.status).toBe(503);
  });

  it('serves /operator from the SPA shell with noindex', async () => {
    const res = await fetch(`${base}/operator/settings`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
  });

  it('keeps the console chunk out of the main bundle and the service-worker precache', () => {
    const assets = fs.readdirSync(path.join(ROOT, 'dist/client/assets'));
    const chunk = assets.find((f) => f.startsWith('OperatorRoot-') && f.endsWith('.js'));
    expect(chunk).toBeDefined();
    const sw = fs.readFileSync(path.join(ROOT, 'dist/client/sw.js'), 'utf8');
    expect(sw).not.toContain('OperatorRoot');
    expect(sw).toContain('operator');
    const main = assets.find((f) => /^index-.*\.js$/.test(f))!;
    expect(fs.readFileSync(path.join(ROOT, 'dist/client/assets', main), 'utf8')).not.toContain('Rotate master key');
  });

  it('ships no WorkOS emulator override in the production Worker', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'dist/midnight_invoice/index.js'), 'utf8');
    expect(worker).toContain('workosBaseUrl: void 0');
    expect(worker).not.toContain('WORKOS_API_BASE_URL');
  });

  it('ships no fake email-provider override in the production Worker', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'dist/midnight_invoice/index.js'), 'utf8');
    expect(worker).toContain('resendBaseUrl: void 0');
    expect(worker).not.toContain('RESEND_API_BASE_URL');
    expect(worker).toContain('https://api.resend.com');
  });
});
