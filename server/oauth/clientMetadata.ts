/**
 * Client metadata: validation of dynamic client registrations (RFC 7591) and
 * fetching of Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document-00,
 * required as SHOULD by the MCP 2026-07-28 authorization spec).
 *
 * Fetching a client-chosen URL from the Worker is SSRF-sensitive, so the
 * document URL must be https on the default port with a DNS host name (no IP
 * literals, no localhost / single-label / internal-only names, not this app's
 * own host), redirects are refused instead of followed, the download is
 * capped at 5 KB and 5 s, and results are cached (Cache-Control max-age,
 * clamped to 5 min – 24 h). Workers' global fetch() also has no route into
 * private networks (that needs explicit bindings), which covers DNS names
 * that resolve to private addresses.
 */
import { OAUTH_LIMITS, OAUTH_TTL } from './config';
import { parseRedirectUri } from './redirectUris';

export interface ClientMetadata {
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
  softwareId: string | null;
  softwareVersion: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; reason: string };

const fail = (error: 'invalid_redirect_uri' | 'invalid_client_metadata', reason: string) => ({ ok: false as const, error, reason });

/** Plain single-line text: no control, format (bidi override, zero-width) or line-break characters. */
export function cleanText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex -- strip control characters
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

const GRANTS = new Set(['authorization_code', 'refresh_token']);

function optionalString(body: Record<string, unknown>, key: string, max: number): Result<string | null> {
  const v = body[key];
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return fail('invalid_client_metadata', `${key} must be a string`);
  if (v.length > max) return fail('invalid_client_metadata', `${key} must be at most ${max} characters`);
  return { ok: true, value: v };
}

/**
 * Validates the metadata both registration paths share. `requireName` is set
 * for metadata documents (the MCP spec makes client_name mandatory there).
 */
export function validateClientMetadata(input: unknown, opts: { requireName: boolean }): Result<ClientMetadata> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('invalid_client_metadata', 'Client metadata must be a JSON object');
  const body = input as Record<string, unknown>;

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return fail('invalid_redirect_uri', 'redirect_uris must be a non-empty array');
  if (uris.length > OAUTH_LIMITS.redirectUris) return fail('invalid_redirect_uri', `At most ${OAUTH_LIMITS.redirectUris} redirect_uris are allowed`);
  const redirectUris: string[] = [];
  for (const [i, raw] of uris.entries()) {
    const parsed = parseRedirectUri(raw);
    if (!parsed.ok) return fail('invalid_redirect_uri', `redirect_uris[${i}] ${parsed.reason}`);
    if (!redirectUris.includes(parsed.value.uri)) redirectUris.push(parsed.value.uri);
  }

  const name = optionalString(body, 'client_name', 1000);
  if (!name.ok) return name;
  const clientName = name.value === null ? '' : cleanText(name.value, OAUTH_LIMITS.clientName);
  if (opts.requireName && !clientName) return fail('invalid_client_metadata', 'client_name is required');

  const uri = optionalString(body, 'client_uri', OAUTH_LIMITS.uri);
  if (!uri.ok) return uri;
  let clientUri: string | null = null;
  if (uri.value) {
    try {
      const u = new URL(uri.value);
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error('not https');
      clientUri = u.href;
    } catch {
      return fail('invalid_client_metadata', 'client_uri must be an https URL');
    }
  }

  let grantTypes = ['authorization_code'];
  if (body.grant_types !== undefined) {
    if (!Array.isArray(body.grant_types) || body.grant_types.some((g) => typeof g !== 'string')) {
      return fail('invalid_client_metadata', 'grant_types must be an array of strings');
    }
    const unsupported = (body.grant_types as string[]).filter((g) => !GRANTS.has(g));
    if (unsupported.length > 0) return fail('invalid_client_metadata', `Unsupported grant_types: ${unsupported.slice(0, 3).join(', ').slice(0, 100)}`);
    if (!body.grant_types.includes('authorization_code')) return fail('invalid_client_metadata', 'grant_types must include authorization_code');
    grantTypes = [...new Set(body.grant_types as string[])];
  }
  if (body.response_types !== undefined) {
    if (!Array.isArray(body.response_types) || body.response_types.length === 0 || body.response_types.some((r) => r !== 'code')) {
      return fail('invalid_client_metadata', 'response_types must be ["code"]');
    }
  }
  if (body.scope !== undefined && (typeof body.scope !== 'string' || body.scope.length > OAUTH_LIMITS.scope)) {
    return fail('invalid_client_metadata', 'scope must be a space-separated string');
  }
  const softwareId = optionalString(body, 'software_id', 200);
  if (!softwareId.ok) return softwareId;
  const softwareVersion = optionalString(body, 'software_version', 100);
  if (!softwareVersion.ok) return softwareVersion;

  return {
    ok: true,
    value: {
      clientName: clientName || 'Unnamed MCP client',
      clientUri,
      redirectUris,
      grantTypes,
      softwareId: softwareId.value ? cleanText(softwareId.value, 200) : null,
      softwareVersion: softwareVersion.value ? cleanText(softwareVersion.value, 100) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Client ID Metadata Documents
// ---------------------------------------------------------------------------

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.test', '.invalid', '.example', '.onion'];

/** Is this client_id a metadata document URL we are willing to fetch? Returns the reason if not. */
export function checkMetadataDocumentUrl(clientId: string, ownHost: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (clientId.length > OAUTH_LIMITS.clientId) return { ok: false, reason: 'client_id URL is too long' };
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return { ok: false, reason: 'client_id is not a URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'client_id URL must use https' };
  if (url.username || url.password || clientId.includes('#')) return { ok: false, reason: 'client_id URL must not contain user info or a fragment' };
  if (url.port !== '') return { ok: false, reason: 'client_id URL must use the default https port' };
  if (url.pathname === '/' || url.pathname === '') return { ok: false, reason: 'client_id URL must have a path' };
  const rawPath = clientId.slice(clientId.indexOf(url.host) + url.host.length).split(/[?#]/)[0];
  if (rawPath.split('/').some((seg) => seg === '.' || seg === '..' || /^%2e/i.test(seg))) return { ok: false, reason: 'client_id URL must not contain dot segments' };
  if (url.href !== clientId) return { ok: false, reason: 'client_id URL must be in normalised form' };
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return { ok: false, reason: 'client_id URL must use a DNS name, not an IP address' };
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'client_id URL host is not a public DNS name' };
  }
  if (host === ownHost.toLowerCase()) return { ok: false, reason: 'client_id URL must not point at this server' };
  return { ok: true, url };
}

function cacheLifetimeMs(cacheControl: string | null): number {
  const header = (cacheControl ?? '').toLowerCase();
  if (/(?:^|,)\s*(?:no-store|no-cache)\b/.test(header)) return OAUTH_TTL.metadataMinMs;
  const match = /max-age\s*=\s*"?(\d+)"?/.exec(header);
  const ms = match ? Number(match[1]) * 1000 : OAUTH_TTL.metadataDefaultMs;
  return Math.min(OAUTH_TTL.metadataMaxMs, Math.max(OAUTH_TTL.metadataMinMs, ms));
}

async function readCapped(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

/** Downloads and validates a Client ID Metadata Document. Never throws for remote failures. */
export async function fetchMetadataDocument(
  url: URL,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; value: ClientMetadata; cacheMs: number } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(OAUTH_LIMITS.metadataFetchTimeoutMs),
    });
  } catch {
    return { ok: false, reason: 'The client metadata document could not be fetched' };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, reason: 'The client metadata document URL redirects; redirects are not followed' };
  if (response.status !== 200) return { ok: false, reason: `The client metadata document returned HTTP ${response.status}` };
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
    return { ok: false, reason: 'The client metadata document must be served as application/json' };
  }
  let text: string | null;
  try {
    text = await readCapped(response, OAUTH_LIMITS.metadataDocumentBytes);
  } catch {
    return { ok: false, reason: 'The client metadata document could not be read' };
  }
  if (text === null) return { ok: false, reason: `The client metadata document is larger than ${OAUTH_LIMITS.metadataDocumentBytes} bytes` };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The client metadata document is not valid JSON' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, reason: 'The client metadata document must be a JSON object' };
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url.href) return { ok: false, reason: 'The client metadata document client_id does not match its URL' };
  if ('client_secret' in d || 'client_secret_expires_at' in d) return { ok: false, reason: 'A client metadata document must not contain a client secret' };
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') {
    return { ok: false, reason: 'Only public clients (token_endpoint_auth_method "none") are supported' };
  }
  const meta = validateClientMetadata(d, { requireName: true });
  if (!meta.ok) return { ok: false, reason: meta.reason };
  return { ok: true, value: meta.value, cacheMs: cacheLifetimeMs(response.headers.get('cache-control')) };
}
