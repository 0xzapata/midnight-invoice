/**
 * Operator authentication: bootstrap password (first run only), AuthKit
 * (WorkOS) sign-in, cookie sessions, CSRF, and attempt lockout.
 *
 * Cookies
 * - `__Secure-mi_op_session` (Path=/api/operator, HttpOnly, Secure, SameSite=Strict):
 *   "<kind>.<id>.<sig>", id = 256 random bits (D1 stores SHA-256(id)),
 *   sig = HMAC-SHA-256 with the session signing key: for setup sessions a key
 *   derived from INITIAL_PASSWORD (the encrypted store may not exist yet), for
 *   full sessions the `operator.sessionSigningKey` secret from the encrypted store.
 * - `__Secure-mi_op_oauth` (Path=/api/operator/auth, HttpOnly, Secure, SameSite=Lax, 10 min):
 *   a nonce binding an AuthKit redirect to the browser that started it. Lax is
 *   required because the AuthKit callback is a cross-site top-level navigation,
 *   on which Strict cookies are not sent; it carries no authority by itself.
 * CSRF: state-changing requests need `x-csrf-token` (HMAC of the session id)
 * and a same-origin Origin / Sec-Fetch-Site.
 */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppDeps } from '../deps';
import { constantTimeEqual, fromBase64Url, hkdf, hmacSha256, randomBytes, sha256, toBase64Url } from './crypto';
import type { OperatorDb, OperatorRow, SessionRow } from './db';
import { OperatorError } from './errors';

export const SESSION_COOKIE = '__Secure-mi_op_session';
export const OAUTH_COOKIE = '__Secure-mi_op_oauth';
export const SESSION_PATH = '/api/operator';
export const OAUTH_PATH = '/api/operator/auth';
export const CSRF_HEADER = 'x-csrf-token';

export const SETUP_IDLE_MS = 15 * 60_000;
export const SETUP_ABSOLUTE_MS = 30 * 60_000;
const TOUCH_INTERVAL_MS = 60_000;

export interface OperatorSession {
  idHash: string;
  id: string;
  kind: 'setup' | 'full';
  row: SessionRow;
  operator: OperatorRow | null;
  signingKey: Uint8Array;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const hashId = async (id: string) => hex(await sha256(id));

export async function setupSigningKey(initialPassword: string, setupSalt: string): Promise<Uint8Array> {
  return hkdf(new TextEncoder().encode(initialPassword), fromBase64Url(setupSalt), 'mi/op-setup-session/v1');
}

async function sign(key: Uint8Array, kind: string, id: string) {
  return toBase64Url((await hmacSha256(key, `mi/op-session/v1|${kind}|${id}`)).slice(0, 24));
}

export async function csrfTokenFor(session: Pick<OperatorSession, 'signingKey' | 'id'>): Promise<string> {
  return toBase64Url(await hmacSha256(session.signingKey, `mi/op-csrf/v1|${session.id}`));
}

export function clientInfo(c: Context) {
  return {
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
  };
}

/** Creates a session row and sets the cookie. */
export async function startSession(
  c: Context,
  deps: AppDeps,
  odb: OperatorDb,
  kind: 'setup' | 'full',
  signingKey: Uint8Array,
  operatorId: string | null,
  extra: D1PreparedStatement[] = [],
): Promise<{ csrfToken: string; expiresAt: number }> {
  const now = deps.clock().getTime();
  const id = toBase64Url(randomBytes(32));
  const absolute = kind === 'setup' ? SETUP_ABSOLUTE_MS : deps.settings.get('operator.absoluteTimeoutHours') * 3_600_000;
  const { ip, userAgent } = clientInfo(c);
  const row: SessionRow = {
    id_hash: await hashId(id),
    kind,
    operator_id: operatorId,
    created_at: now,
    last_seen_at: now,
    expires_at: now + absolute,
    revoked_at: null,
    ip,
    user_agent: userAgent,
  };
  await odb.raw.batch([...extra, odb.insertSessionStatement(row)]);
  setCookie(c, SESSION_COOKIE, `${kind}.${id}.${await sign(signingKey, kind, id)}`, {
    path: SESSION_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: Math.floor(absolute / 1000),
  });
  return { csrfToken: await csrfTokenFor({ signingKey, id }), expiresAt: row.expires_at };
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: SESSION_PATH, secure: true, httpOnly: true, sameSite: 'Strict' });
}

/**
 * Resolves the session from the cookie, enforcing signature, revocation,
 * idle and absolute timeouts. Returns null if there is no valid session.
 * `keys` provides the signing key for each kind (null = that kind is unavailable).
 */
export async function readSession(
  c: Context,
  deps: AppDeps,
  odb: OperatorDb,
  keys: { setup: () => Promise<Uint8Array | null>; full: () => Promise<Uint8Array | null> },
): Promise<OperatorSession | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [kind, id, sig] = parts;
  if ((kind !== 'setup' && kind !== 'full') || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const signingKey = await keys[kind]();
  if (!signingKey) return null;
  const expected = new TextEncoder().encode(await sign(signingKey, kind, id));
  if (!constantTimeEqual(expected, new TextEncoder().encode(sig))) return null;
  const idHash = await hashId(id);
  const row = await odb.findSession(idHash);
  if (!row || row.kind !== kind || row.revoked_at) return null;
  const now = deps.clock().getTime();
  const idleMs = kind === 'setup' ? SETUP_IDLE_MS : deps.settings.get('operator.idleTimeoutMinutes') * 60_000;
  if (now >= row.expires_at || now - row.last_seen_at >= idleMs) return null;
  let operator: OperatorRow | null = null;
  if (kind === 'full') {
    operator = row.operator_id ? await odb.findOperator(row.operator_id) : null;
    if (!operator) return null;
  }
  if (now - row.last_seen_at >= TOUCH_INTERVAL_MS) await odb.touchSession(idHash, now);
  return { idHash, id, kind, row, operator, signingKey };
}

/** Same-origin check + CSRF token for state-changing requests. */
export async function enforceCsrf(c: Context, session: OperatorSession, allowedOrigins: string[]): Promise<void> {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = c.req.header('origin');
  if (origin) {
    if (!allowedOrigins.includes(origin)) throw OperatorError.csrf();
  } else if (c.req.header('sec-fetch-site') && c.req.header('sec-fetch-site') !== 'same-origin') {
    throw OperatorError.csrf();
  }
  const token = c.req.header(CSRF_HEADER) ?? '';
  const expected = await csrfTokenFor(session);
  if (!constantTimeEqual(new TextEncoder().encode(token), new TextEncoder().encode(expected))) throw OperatorError.csrf();
}

// ---------------------------------------------------------------------------
// Attempt lockout (bootstrap password, recovery key)
// ---------------------------------------------------------------------------

const ATTEMPT_WINDOW_MS = 60 * 60_000;
/** Per client IP: a hard lock with exponential backoff (1 min, 2 min, … 1 h) after 5 failures in a window. */
const IP_POLICY = { threshold: 5, baseLockMs: 60_000, maxLockMs: 60 * 60_000 };
/**
 * Across IPs (security fix L5): never a lock — one could otherwise lock the
 * operator out of bootstrap and recovery from anywhere. Past `threshold`
 * failures in a window, every attempt waits before it is checked, doubling
 * every `step` failures up to `maxMs`: guessing across many IPs slows down,
 * the real operator still gets in.
 */
export const GLOBAL_DELAY = { threshold: 100, step: 10, baseMs: 250, maxMs: 8_000 };

export function attemptKeys(kind: 'bootstrap' | 'recovery', ip: string | null) {
  return { ip: `${kind}:ip:${ip ?? 'unknown'}`, global: `${kind}:global` };
}

/** Delay for the next attempt from the global failure count (0 below the threshold). */
export function globalDelayMs(row: { failures: number; window_start: number } | undefined, now: number): number {
  if (!row || now - row.window_start > ATTEMPT_WINDOW_MS) return 0;
  const over = row.failures - GLOBAL_DELAY.threshold;
  if (over < 0) return 0;
  return Math.min(GLOBAL_DELAY.maxMs, GLOBAL_DELAY.baseMs * 2 ** Math.floor(over / GLOBAL_DELAY.step));
}

/** Throws 429 if this IP is locked; waits (see GLOBAL_DELAY) when many attempts failed site-wide. */
export async function assertNotLocked(
  odb: OperatorDb,
  keys: { ip: string; global: string },
  now: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const rows = await odb.getAttempts([keys.ip, keys.global]);
  const ip = rows.find((r) => r.key === keys.ip);
  if (ip && ip.locked_until > now) throw OperatorError.locked(Math.ceil((ip.locked_until - now) / 1000));
  const delay = globalDelayMs(rows.find((r) => r.key === keys.global), now);
  if (delay > 0) await sleep(delay);
}

/**
 * Records a failure: both counters are incremented atomically (UPSERT …
 * RETURNING, so concurrent failures are never lost), and the IP that reached
 * the threshold is locked by one compare-and-set statement.
 */
export async function recordFailure(odb: OperatorDb, keys: { ip: string; global: string }, now: number): Promise<void> {
  const [ip] = await odb.bumpAttempts([keys.ip, keys.global], now, ATTEMPT_WINDOW_MS, 24 * ATTEMPT_WINDOW_MS);
  if (ip && ip.failures >= IP_POLICY.threshold) {
    await odb.lockAttempt(keys.ip, { now, threshold: IP_POLICY.threshold, baseMs: IP_POLICY.baseLockMs, maxMs: IP_POLICY.maxLockMs });
  }
}
