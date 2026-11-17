/**
 * User account sessions (cookie) and CSRF. Deliberately separate from the
 * operator console's sessions: different cookie name and path, different
 * table, different HMAC key. A user session never authenticates an operator
 * request and an operator session never authenticates an account request.
 *
 * Cookies
 * - `__Secure-mi_user_session` (Path=/api/account, HttpOnly, Secure, SameSite=Strict):
 *   "<id>.<sig>", id = 256 random bits (D1 stores SHA-256(id)), sig = HMAC-SHA-256
 *   with `accounts.sessionSigningKey` (encrypted settings). Idle + absolute
 *   timeouts (operator settings), revocable, new id on every sign-in.
 * - `__Secure-mi_user_oauth` (Path=/api/account/auth, HttpOnly, Secure, SameSite=Lax, 10 min):
 *   binds an AuthKit redirect to the browser that started it (Lax: the
 *   callback is a cross-site top-level navigation). Carries no authority.
 * CSRF: state-changing requests need `x-csrf-token` (HMAC of the session id)
 * and a same-origin Origin / Sec-Fetch-Site.
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ACCOUNT_CSRF_HEADER } from '../../shared/accounts';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { constantTimeEqual, hmacSha256, randomBytes, sha256, toBase64Url } from '../operator/crypto';
import type { AccountsDb, UserRow, UserSessionRow } from './db';

export const USER_SESSION_COOKIE = '__Secure-mi_user_session';
export const USER_OAUTH_COOKIE = '__Secure-mi_user_oauth';
export const USER_SESSION_PATH = '/api/account';
export const USER_OAUTH_PATH = '/api/account/auth';
const TOUCH_INTERVAL_MS = 60_000;
const DAY = 86_400_000;

export interface UserSession {
  id: string;
  idHash: string;
  row: UserSessionRow;
  user: UserRow;
  signingKey: Uint8Array;
}

/** Errors of /api/account (same body shape as the public API; codes are private to this surface). */
export function accountError(status: number, code: string, message: string, details?: unknown) {
  return new ApiError(status, code as ApiError['code'], message, details);
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const hashId = async (id: string) => hex(await sha256(id));

const sign = async (key: Uint8Array, id: string) => toBase64Url((await hmacSha256(key, `mi/user-session/v1|${id}`)).slice(0, 24));
export const csrfTokenFor = async (s: Pick<UserSession, 'signingKey' | 'id'>) => toBase64Url(await hmacSha256(s.signingKey, `mi/user-csrf/v1|${s.id}`));

export function sessionTimeouts(deps: AppDeps) {
  return {
    idleMs: deps.settings.get('accounts.sessionIdleDays') * DAY,
    absoluteMs: deps.settings.get('accounts.sessionAbsoluteDays') * DAY,
  };
}

/** Starts a fresh session (new random id: no fixation) and sets the cookie. */
export async function startUserSession(c: Context, deps: AppDeps, adb: AccountsDb, signingKey: Uint8Array, userId: string, extra: D1PreparedStatement[] = []) {
  const now = deps.clock().getTime();
  const { absoluteMs } = sessionTimeouts(deps);
  const id = toBase64Url(randomBytes(32));
  const row: UserSessionRow = {
    id_hash: await hashId(id),
    user_id: userId,
    device_token_id: null,
    created_at: now,
    last_seen_at: now,
    expires_at: now + absoluteMs,
    revoked_at: null,
    user_agent: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
  };
  await adb.raw.batch([...extra, adb.insertSessionStatement(row)]);
  setCookie(c, USER_SESSION_COOKIE, `${id}.${await sign(signingKey, id)}`, {
    path: USER_SESSION_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: Math.floor(absoluteMs / 1000),
  });
  return row;
}

export function clearUserSessionCookie(c: Context) {
  deleteCookie(c, USER_SESSION_COOKIE, { path: USER_SESSION_PATH, secure: true, httpOnly: true, sameSite: 'Strict' });
}

/** Parses and verifies the cookie (signature only). */
export async function sessionIdFromCookie(c: Context, signingKey: Uint8Array | null): Promise<string | null> {
  const raw = getCookie(c, USER_SESSION_COOKIE);
  if (!raw || !signingKey) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const expected = new TextEncoder().encode(await sign(signingKey, id));
  if (!constantTimeEqual(expected, new TextEncoder().encode(sig))) return null;
  return id;
}

/** Resolves the session: signature, revocation, idle and absolute timeouts, disabled accounts. */
export async function readUserSession(c: Context, deps: AppDeps, adb: AccountsDb, signingKey: Uint8Array | null): Promise<UserSession | null> {
  const id = await sessionIdFromCookie(c, signingKey);
  if (!id || !signingKey) return null;
  const idHash = await hashId(id);
  const row = await adb.findSession(idHash);
  if (!row || row.revoked_at) return null;
  const now = deps.clock().getTime();
  const { idleMs } = sessionTimeouts(deps);
  if (now >= row.expires_at || now - row.last_seen_at >= idleMs) return null;
  const user = await adb.findUser(row.user_id);
  if (!user || user.disabled_at) return null;
  if (now - row.last_seen_at >= TOUCH_INTERVAL_MS) await adb.touchSession(idHash, now);
  return { id, idHash, row, user, signingKey };
}

/** Same-origin check for any state-changing request (with or without a session). */
export function assertSameOrigin(c: Context, allowedOrigins: string[]) {
  const origin = c.req.header('origin');
  const site = c.req.header('sec-fetch-site');
  if (origin ? !allowedOrigins.includes(origin) : site !== undefined && site !== 'same-origin') {
    throw accountError(403, 'csrf_failed', 'Missing or invalid CSRF token / origin');
  }
}

export async function enforceCsrf(c: Context, session: UserSession, allowedOrigins: string[]) {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  assertSameOrigin(c, allowedOrigins);
  const token = c.req.header(ACCOUNT_CSRF_HEADER) ?? '';
  const expected = await csrfTokenFor(session);
  if (!constantTimeEqual(new TextEncoder().encode(token), new TextEncoder().encode(expected))) {
    throw accountError(403, 'csrf_failed', 'Missing or invalid CSRF token / origin');
  }
}
