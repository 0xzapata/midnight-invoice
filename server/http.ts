import type { Context } from 'hono';
import { errors } from './errors';
import type { RateLimiter } from './deps';

/**
 * Reads a JSON body with a hard size cap. An empty body yields `undefined`
 * (callers decide whether that is allowed).
 */
export async function readJson(c: Context, limitBytes: number): Promise<unknown> {
  const declared = c.req.header('content-length');
  if (declared && Number(declared) > limitBytes) throw errors.payloadTooLarge(limitBytes);
  const raw = c.req.raw;
  if (!raw.body) return undefined;
  const reader = raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limitBytes) {
      await reader.cancel();
      throw errors.payloadTooLarge(limitBytes);
    }
    chunks.push(value);
  }
  if (size === 0) return undefined;
  const contentType = c.req.header('content-type') ?? '';
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) throw errors.unsupportedMediaType();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw errors.invalidJson();
  }
}

export async function readJsonRequired(c: Context, limitBytes: number): Promise<unknown> {
  const body = await readJson(c, limitBytes);
  if (body === undefined) throw errors.badRequest('A JSON request body is required');
  return body;
}

/** Client IP as seen by Cloudflare (set by the edge; absent in some local setups). */
export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

export async function enforceRateLimit(limiter: RateLimiter, key: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) throw errors.rateLimited(60);
}

/** Base URL for links we hand out: APP_URL if configured, else the request origin. */
export function publicBaseUrl(c: Context, appUrl: string | undefined): string {
  if (appUrl && appUrl.trim() !== '') return appUrl.trim().replace(/\/+$/, '');
  return new URL(c.req.url).origin;
}

/** Schedules background work; falls back to fire-and-forget outside a Worker (tests). */
export function runInBackground(c: Context, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
