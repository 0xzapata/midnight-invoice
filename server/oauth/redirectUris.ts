/**
 * Redirect URI rules (OAuth 2.1 §1.5/§2.3, RFC 8252 for native apps, MCP
 * authorization "Communication Security"):
 * - `https:` with any host;
 * - `http:` only for loopback hosts (127.0.0.1, [::1], localhost);
 * - a private-use custom scheme for native apps (`com.example.app:/cb`,
 *   `cursor://…`), except schemes that a browser would execute or that reach
 *   other resources (javascript:, data:, file:, …).
 * Never a fragment or user info. Matching is exact string comparison, except
 * that loopback IP literals may use any port at request time (RFC 8252 §7.3,
 * OAuth 2.1 §8.4.2) because native apps bind an ephemeral port.
 */
import type { OAuthRedirectKind } from '../../shared/oauth';
import { OAUTH_LIMITS } from './config';

const LOOPBACK_IPS = new Set(['127.0.0.1', '[::1]']);
const LOOPBACK_HOSTS = new Set([...LOOPBACK_IPS, 'localhost']);

/** Schemes that must never receive an authorization response. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'filesystem', 'view-source',
  'ws', 'wss', 'ftp', 'mailto', 'tel', 'sms', 'intent', 'chrome', 'resource', 'jar',
]);

export interface ParsedRedirectUri {
  uri: string;
  url: URL;
  kind: OAuthRedirectKind;
  /** What the consent screen shows: host[:port] or `scheme:`. */
  display: string;
}

/** Validates one redirect URI; returns null with a reason on failure. */
export function parseRedirectUri(raw: unknown): { ok: true; value: ParsedRedirectUri } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'must be a non-empty string' };
  if (raw.length > OAUTH_LIMITS.uri) return { ok: false, reason: `must be at most ${OAUTH_LIMITS.uri} characters` };
  // eslint-disable-next-line no-control-regex -- reject control characters and whitespace outright
  if (/[\u0000- \u007f-\u009f]/.test(raw)) return { ok: false, reason: 'must not contain whitespace or control characters' };
  if (raw.includes('#')) return { ok: false, reason: 'must not contain a fragment' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'must be an absolute URI' };
  }
  if (url.username || url.password) return { ok: false, reason: 'must not contain user info' };
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') {
    if (!url.hostname) return { ok: false, reason: 'must have a host' };
    const port = url.port ? `:${url.port}` : '';
    return { ok: true, value: { uri: raw, url, kind: LOOPBACK_HOSTS.has(url.hostname) ? 'loopback' : 'https', display: `${url.hostname}${port}` } };
  }
  if (scheme === 'http') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, reason: 'http is only allowed for loopback hosts (127.0.0.1, [::1], localhost); use https' };
    return { ok: true, value: { uri: raw, url, kind: 'loopback', display: `${url.hostname}${url.port ? `:${url.port}` : ''}` } };
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || FORBIDDEN_SCHEMES.has(scheme)) {
    return { ok: false, reason: `the "${scheme}:" scheme is not allowed` };
  }
  if (raw.length <= scheme.length + 1) return { ok: false, reason: 'must have a path after the scheme' };
  return { ok: true, value: { uri: raw, url, kind: 'custom_scheme', display: `${scheme}:` } };
}

/** Is `requested` one of the client's registered redirect URIs? */
export function matchRedirectUri(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const req = parseRedirectUri(requested);
  if (!req.ok || req.value.url.protocol !== 'http:' || !LOOPBACK_IPS.has(req.value.url.hostname)) return false;
  return registered.some((r) => {
    const reg = parseRedirectUri(r);
    if (!reg.ok) return false;
    const a = reg.value.url;
    const b = req.value.url;
    return a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && LOOPBACK_IPS.has(a.hostname);
  });
}

export function describeRedirect(uri: string): { kind: OAuthRedirectKind; display: string } {
  const parsed = parseRedirectUri(uri);
  return parsed.ok ? { kind: parsed.value.kind, display: parsed.value.display } : { kind: 'https', display: uri };
}
