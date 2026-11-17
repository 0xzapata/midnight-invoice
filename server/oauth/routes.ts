/**
 * HTTP wiring of the OAuth authorization server and of the MCP endpoint's
 * protected-resource side (mounted by createApp):
 *
 *   GET  /.well-known/oauth-protected-resource[/api/mcp]  RFC 9728
 *   GET  /.well-known/oauth-authorization-server          RFC 8414
 *   GET  /api/oauth/authorize    → consent screen /agents/authorize?request=…
 *   POST /api/oauth/register     RFC 7591 (public clients)
 *   POST /api/oauth/token        authorization_code (+PKCE) and refresh_token
 *   POST /api/oauth/revoke       RFC 7009
 *   GET  /api/v1/oauth/requests/:id            consent preview  (workspace token)
 *   POST /api/v1/oauth/requests/:id/approve    consent decision (workspace token)
 *   POST /api/v1/oauth/requests/:id/deny
 *
 * The consent API is deliberately not CORS-enabled and requires the
 * workspace token in the Authorization header: a browser never attaches it on
 * its own, so another site cannot make the user approve anything (no CSRF).
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { OAUTH_CONSENT_PATH, OAUTH_PATHS, OAUTH_TOKEN_PREFIX } from '../../shared/oauth';
import { MCP_PATH } from '../../shared/api';
import type { AppEnv } from '../app';
import { bearerToken } from '../auth';
import type { AppDeps } from '../deps';
import { ApiError, AUTH_REALM } from '../errors';
import { setTelemetryDetail } from '../operator/hooks';
import { clientIp, enforceRateLimit, publicBaseUrl, readJson, runInBackground } from '../http';
import type { Repository } from '../db/repository';
import { LIMITS } from '../schemas';
import { authorizationServerMetadata, OAUTH_LIMITS, oauthTunables, oauthUrls, protectedResourceMetadata } from './config';
import { OAUTH_NO_STORE, OAuthError, oauthErrors } from './errors';
import { consentUserOf } from './identity';
import { createOAuthRepository, type OAuthRepository } from './repository';
import * as oauth from './service';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '600',
};

function withHeaders(res: Response, headers: Record<string, string>): Response {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

async function readForm(c: Context): Promise<URLSearchParams> {
  const contentType = c.req.header('content-type') ?? '';
  if (!/^application\/x-www-form-urlencoded\b/i.test(contentType)) {
    throw oauthErrors.invalidRequest('Content-Type must be application/x-www-form-urlencoded');
  }
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > OAUTH_LIMITS.formBodyBytes) throw oauthErrors.invalidRequest('Request body is too large');
  const raw = c.req.raw;
  if (!raw.body) return new URLSearchParams();
  const reader = raw.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > OAUTH_LIMITS.formBodyBytes) {
      await reader.cancel();
      throw oauthErrors.invalidRequest('Request body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  for (const key of new Set(form.keys())) {
    if (key !== 'resource' && form.getAll(key).length > 1) throw oauthErrors.invalidRequest(`Parameter ${key} must not be repeated`);
  }
  return form;
}

/** Public clients only: client_id in the body (or Basic auth with an empty secret). */
function clientIdOf(c: Context, form: URLSearchParams): string {
  const publicOnly = 'This server only supports public clients (PKCE, token_endpoint_auth_method "none"); do not send a client secret';
  let fromHeader: string | null = null;
  const header = c.req.header('authorization');
  if (header) {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
    if (!match) throw oauthErrors.invalidClient(publicOnly);
    let decoded: string;
    try {
      decoded = atob(match[1]);
    } catch {
      throw oauthErrors.invalidClient(publicOnly);
    }
    const sep = decoded.indexOf(':');
    const id = sep === -1 ? decoded : decoded.slice(0, sep);
    const secret = sep === -1 ? '' : decoded.slice(sep + 1);
    if (secret) throw oauthErrors.invalidClient(publicOnly);
    try {
      fromHeader = decodeURIComponent(id.replace(/\+/g, ' '));
    } catch {
      throw oauthErrors.invalidClient(publicOnly);
    }
  }
  if (form.get('client_secret')) throw oauthErrors.invalidClient(publicOnly);
  const fromBody = form.get('client_id');
  if (fromHeader && fromBody && fromHeader !== fromBody) throw oauthErrors.invalidRequest('client_id in the body and the Authorization header differ');
  const clientId = fromHeader || fromBody;
  if (!clientId) throw oauthErrors.invalidClient('client_id is required');
  return clientId;
}

/** Runs an OAuth protocol handler: OAuth-style errors, no-store, CORS, telemetry error code. */
async function protocol(c: Context, run: () => Promise<Response>): Promise<Response> {
  try {
    return withHeaders(await run(), { ...OAUTH_NO_STORE, ...CORS });
  } catch (error) {
    if (error instanceof OAuthError) {
      setTelemetryDetail(c, { errorCode: error.code });
      return error.toResponse(CORS);
    }
    if (error instanceof ApiError && error.status === 429) {
      setTelemetryDetail(c, { errorCode: 'rate_limited' });
      return oauthErrors.rateLimited().toResponse(CORS);
    }
    throw error;
  }
}

const GRANT_LABELS = new Set(['authorization_code', 'refresh_token']);

/** Telemetry outcome of an authorization request, from fixed parts of where it sends the browser. */
function authorizeOutcome(location: string, consentPrefix: string): { label: string; errorCode?: string } {
  const url = new URL(location);
  if (location.startsWith(consentPrefix)) {
    const error = url.searchParams.get('error');
    return error ? { label: 'rejected', errorCode: error } : { label: 'consent' };
  }
  return { label: 'error_redirect', errorCode: url.searchParams.get('error') ?? undefined };
}

export function registerOAuthRoutes(app: Hono<AppEnv>, v1: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, deps: AppDeps) {
  const repo = createOAuthRepository(deps.db);
  const ctxOf = (c: Context): oauth.OAuthCtx => ({
    deps,
    repo,
    urls: oauthUrls(publicBaseUrl(c, deps.config.appUrl)),
    clientIp: clientIp(c),
    activity: { source: 'rest', requestId: c.req.header('cf-ray') ?? crypto.randomUUID(), waitUntil: (p) => runInBackground(c, p) },
  });

  // --- Discovery ---------------------------------------------------------------
  // Outside /api/*, so not behind the operator hook: discovery stays available in maintenance mode.
  const metadata = (build: (base: string) => unknown) => async (c: Context) => {
    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    await deps.settings.refresh();
    return withHeaders(Response.json(build(publicBaseUrl(c, deps.config.appUrl))), { ...CORS, 'cache-control': 'public, max-age=300' });
  };
  for (const path of [OAUTH_PATHS.protectedResourceMetadata, `${OAUTH_PATHS.protectedResourceMetadata}${MCP_PATH}`]) {
    app.on(['GET', 'OPTIONS'], path, metadata(protectedResourceMetadata));
  }
  app.on(['GET', 'OPTIONS'], OAUTH_PATHS.authorizationServerMetadata, metadata((base) => authorizationServerMetadata(base, oauthTunables(deps))));

  // --- Authorization endpoint (browser navigation) -----------------------------
  app.get(OAUTH_PATHS.authorize, async (c) => {
    const ctx = ctxOf(c);
    const consentPrefix = `${ctx.urls.issuer}${OAUTH_CONSENT_PATH}?`;
    const location = await oauth.startAuthorization(ctx, new URL(c.req.url).searchParams, (q) => `${consentPrefix}${q}`);
    setTelemetryDetail(c, authorizeOutcome(location, consentPrefix));
    return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  });

  // --- Registration, token, revocation (client → server) ------------------------
  for (const path of [OAUTH_PATHS.register, OAUTH_PATHS.token, OAUTH_PATHS.revoke]) {
    app.options(path, () => new Response(null, { status: 204, headers: CORS }));
  }
  app.post(OAUTH_PATHS.register, (c) =>
    protocol(c, async () => {
      await enforceRateLimit(deps.rateLimiters.create, `oauth-register:${clientIp(c)}`);
      let body: unknown;
      try {
        body = await readJson(c, OAUTH_LIMITS.registerBodyBytes);
      } catch (error) {
        if (error instanceof ApiError) throw new OAuthError('invalid_client_metadata', error.message);
        throw error;
      }
      return Response.json(await oauth.registerClient(ctxOf(c), body), { status: 201 });
    }),
  );
  app.post(OAUTH_PATHS.token, (c) =>
    protocol(c, async () => {
      await enforceRateLimit(deps.rateLimiters.poll, `oauth-token:${clientIp(c)}`);
      const form = await readForm(c);
      const grant = form.get('grant_type') ?? '';
      setTelemetryDetail(c, { label: GRANT_LABELS.has(grant) ? grant : 'other_grant' });
      return Response.json(await oauth.exchangeToken(ctxOf(c), form, clientIdOf(c, form)));
    }),
  );
  app.post(OAUTH_PATHS.revoke, (c) =>
    protocol(c, async () => {
      await enforceRateLimit(deps.rateLimiters.poll, `oauth-revoke:${clientIp(c)}`);
      const form = await readForm(c);
      await oauth.revokeToken(ctxOf(c), form, clientIdOf(c, form));
      return new Response(null, { status: 200 });
    }),
  );

  // --- Consent API for the app (workspace token) --------------------------------
  v1.get('/oauth/requests/:request_id', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `oauth-consent:${clientIp(c)}`);
    return c.json(await oauth.previewRequest(ctxOf(c), consentUserOf(c.get('principal')), c.req.param('request_id')));
  });
  v1.post('/oauth/requests/:request_id/approve', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `oauth-consent:${clientIp(c)}`);
    const user = consentUserOf(c.get('principal'));
    const body = await readJson(c, LIMITS.smallBodyBytes);
    return c.json(await oauth.decideRequest(ctxOf(c), user, c.req.param('request_id'), 'approved', body));
  });
  v1.post('/oauth/requests/:request_id/deny', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `oauth-consent:${clientIp(c)}`);
    const user = consentUserOf(c.get('principal'));
    return c.json(await oauth.decideRequest(ctxOf(c), user, c.req.param('request_id'), 'denied', undefined));
  });

  return repo;
}

/**
 * Authentication for POST /api/mcp: OAuth access tokens (audience-bound to
 * this endpoint) plus everything `auth` accepts (agent keys, workspace
 * tokens). Every 401 carries the RFC 9728 `resource_metadata` challenge so
 * MCP clients can discover the authorization server.
 */
export function mcpAuth(deps: AppDeps, appRepo: Repository, repo: OAuthRepository, auth: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const urls = oauthUrls(publicBaseUrl(c, deps.config.appUrl));
    const token = bearerToken(c.req.header('authorization'));
    const unauthorized = (message: string) =>
      new ApiError(401, 'unauthorized', message, undefined, {
        'www-authenticate': token
          ? `Bearer realm="${AUTH_REALM}", error="invalid_token", error_description="${message}", resource_metadata="${urls.resourceMetadata}"`
          : `Bearer realm="${AUTH_REALM}", resource_metadata="${urls.resourceMetadata}"`,
      });
    if (token?.startsWith(OAUTH_TOKEN_PREFIX.access)) {
      const now = deps.clock();
      const principal = await oauth.authenticateAccessToken(repo, token, urls.resource, now.getTime());
      if (principal === 'suspended') throw new ApiError(403, 'workspace_suspended', oauth.SUSPENDED_MESSAGE);
      if (!principal) throw unauthorized('The access token is invalid, expired or revoked');
      c.set('principal', principal);
      const throttleMs = deps.config.lastUsedThrottleSeconds * 1000;
      const last = principal.lastUsedAt ? Date.parse(principal.lastUsedAt) : 0;
      if (now.getTime() - last >= throttleMs) {
        runInBackground(
          c,
          appRepo
            .touchAgentLastUsed(principal.workspaceId, principal.agentId, now.toISOString(), new Date(now.getTime() - throttleMs).toISOString())
            .catch((error) => deps.logError?.('Failed to update agent lastUsedAt', error)),
        );
      }
      return next();
    }
    try {
      await auth(c, next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw unauthorized(token ? 'Missing or invalid bearer token' : 'Authorization required');
      throw error;
    }
  };
}
