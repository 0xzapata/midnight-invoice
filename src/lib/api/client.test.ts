import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError, describeError, NetworkError, parseRetryAfter } from './errors';

const TOKEN = `mi_ws_${'x'.repeat(43)}`;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function setup(response: Response | (() => Promise<Response>), token: string | null = TOKEN) {
  const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    typeof response === 'function' ? response : async () => response,
  );
  const onUnauthorized = vi.fn();
  const client = createApiClient({ getToken: () => token, onUnauthorized, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl, onUnauthorized };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API client', () => {
  it('sends the token only in the Authorization header of a same-origin /api/v1 request', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, { invoices: [], syncedAt: 't', hasMore: false, next: null }));
    await client.listInvoices({ updatedSince: '2026-11-17T10:00:00.000Z', includeDeleted: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/invoices?updated_since=2026-11-17T10%3A00%3A00.000Z&include_deleted=true');
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
  });

  it('does not authenticate public endpoints', async () => {
    const { client, fetchImpl } = setup(jsonResponse(201, { workspace: { id: 'w', createdAt: 't' }, token: TOKEN }), null);
    await client.createWorkspace();
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('refuses authenticated calls when cloud sync is off, without a request', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, {}), null);
    await expect(client.listAgents()).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses the {error:{code,message,details}} shape into a typed ApiError', async () => {
    const details = [{ path: 'toName', message: 'Client name/company is required' }];
    const { client } = setup(jsonResponse(400, { error: { code: 'validation_failed', message: 'Request validation failed', details } }));
    const error = await client.putInvoice('id', { toName: '', lineItems: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_failed', message: 'Request validation failed', details });
    expect(error.isTransient).toBe(false);
  });

  it('sends If-Match and If-None-Match preconditions', async () => {
    const { client, fetchImpl } = setup(async () => jsonResponse(200, { invoice: {} }));
    await client.putInvoice('a', { toName: 'x', lineItems: [] }, { ifMatch: 3 });
    await client.putInvoice('b', { toName: 'x', lineItems: [] }, { ifNoneMatch: true });
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'if-match': '"3"', 'content-type': 'application/json' });
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toMatchObject({ 'if-none-match': '*' });
  });

  it('reports a 401 for the stored token so the browser can disconnect', async () => {
    const { client, onUnauthorized } = setup(jsonResponse(401, { error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } }));
    const error = await client.listInvoices().catch((e) => e);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledWith(TOKEN);
  });

  it('does not disconnect when checking a different token (recovery key)', async () => {
    const { client, onUnauthorized, fetchImpl } = setup(jsonResponse(401, { error: { code: 'unauthorized', message: 'nope' } }));
    const other = `mi_ws_${'y'.repeat(43)}`;
    await expect(client.getWorkspace(other)).rejects.toMatchObject({ status: 401 });
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${other}` });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('exposes Retry-After on 429 and describes it', async () => {
    const { client } = setup(jsonResponse(429, { error: { code: 'rate_limited', message: 'Too many requests, slow down' } }, { 'retry-after': '120' }));
    const error = await client.createWorkspace().catch((e) => e);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterMs: 120_000 });
    expect(error.isTransient).toBe(true);
    expect(describeError(error)).toBe('Too many requests. Try again in 2 minutes.');
  });

  it('turns network failures into NetworkError without leaking request details', async () => {
    const { client } = setup(async () => {
      throw new TypeError(`Failed to fetch with ${TOKEN}`);
    });
    const error = await client.listInvoices().catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).not.toContain(TOKEN);
    expect(describeError(error)).not.toContain(TOKEN);
  });

  it('fails fast while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { client, fetchImpl } = setup(jsonResponse(200, {}));
    const error = await client.listInvoices().catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.offline).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('handles non-JSON error pages (e.g. a proxy 502)', async () => {
    const { client } = setup(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await client.listInvoices().catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: 'unknown' });
    expect(error.isTransient).toBe(true);
    expect(describeError(error)).toBe('The server had a problem. Try again in a moment.');
  });

  it('returns undefined for 204 responses', async () => {
    const { client } = setup(new Response(null, { status: 204 }));
    await expect(client.revokeAgent('a1')).resolves.toBeUndefined();
  });

  it('URL-encodes path segments', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, { registration: {} }));
    await client.getRegistration('AB/../CD');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/agents/registrations/AB%2F..%2FCD');
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('Tue, 17 Nov 2026 10:00:30 GMT', Date.parse('2026-11-17T10:00:00Z'))).toBe(30_000);
    expect(parseRetryAfter('soon')).toBeNull();
  });
});
