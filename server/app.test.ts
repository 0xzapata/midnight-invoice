import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { defaultDeps } from './deps';
import { bearerToken } from './auth';
import { generateSecret, generateUserCode, normalizeUserCode, USER_CODE_ALPHABET } from './crypto';

const app = createApp(defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0) }));

describe('HTTP surface', () => {
  it('GET /api/v1/health', async () => {
    const res = await app.request('http://app.test/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('unknown API routes are JSON 404s', async () => {
    const res = await app.request('http://app.test/api/v1/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('never emits CORS headers (same-origin app, server-to-server agents)', async () => {
    const res = await app.request('http://app.test/api/v1/health', { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('secrets', () => {
  it('generates 256-bit prefixed secrets', () => {
    const a = generateSecret('mi_ws_');
    expect(a).toMatch(/^mi_ws_[A-Za-z0-9_-]{43}$/);
    expect(generateSecret('mi_ws_')).not.toBe(a);
  });

  it('generates unambiguous user codes and normalises input', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode();
      expect(code).toMatch(new RegExp(`^[${USER_CODE_ALPHABET}]{4}-[${USER_CODE_ALPHABET}]{4}$`));
    }
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY01]/);
    expect(normalizeUserCode('wxdz-bcdf')).toBe('WXDZBCDF');
    expect(normalizeUserCode(' WXDZ BCDF ')).toBe('WXDZBCDF');
    expect(normalizeUserCode('WXDZ-BCD')).toBeNull();
    expect(normalizeUserCode('WXDZ-BCDA')).toBeNull();
    expect(normalizeUserCode("' OR 1=1 --")).toBeNull();
  });

  it('parses bearer headers strictly', () => {
    expect(bearerToken('Bearer mi_ws_abc')).toBe('mi_ws_abc');
    expect(bearerToken('bearer   mi_ws_abc')).toBe('mi_ws_abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
