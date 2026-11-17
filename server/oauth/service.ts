/**
 * OAuth 2.1 authorization server use-cases (authorization code + PKCE S256,
 * refresh-token rotation, dynamic client registration, Client ID Metadata
 * Documents, revocation) and the consent decisions taken in the app.
 * HTTP wiring lives in ./routes.ts.
 */
import { z } from 'zod';
import { SCOPES, type Scope } from '../../shared/api';
import { DEFAULT_OAUTH_SCOPES, OAUTH_TOKEN_PREFIX, type OAuthDecisionResponse, type OAuthRequestError, type OAuthRequestPreview } from '../../shared/oauth';
import { parseScopes, type Principal } from '../auth';
import { sha256Hex } from '../crypto';
import type { AppDeps } from '../deps';
import { errors } from '../errors';
import { zodDetails } from '../schemas';
import { checkMetadataDocumentUrl, fetchMetadataDocument, validateClientMetadata } from './clientMetadata';
import { OAUTH_LIMITS, OAUTH_TTL, oauthTunables, type OAuthUrls } from './config';
import { OAuthError, oauthErrors } from './errors';
import type { ConsentUser } from './identity';
import { PKCE_VALUE, verifyPkce } from './pkce';
import { describeRedirect, matchRedirectUri } from './redirectUris';
import type { NewTokens, OAuthClientRow, OAuthRepository, OAuthRequestRow } from './repository';

export interface OAuthCtx {
  deps: AppDeps;
  repo: OAuthRepository;
  urls: OAuthUrls;
  clientIp: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same message as the operator hook's 403 for a suspended workspace's other credentials. */
export const SUSPENDED_MESSAGE = 'This workspace has been suspended by the site operator.';

/**
 * Token-endpoint answer for a suspended workspace. Deliberately not
 * invalid_grant: clients keep their tokens (nothing is revoked), and they work
 * again once the operator lifts the suspension.
 */
const suspendedError = () => new OAuthError('access_denied', SUSPENDED_MESSAGE, 403);
const REQUEST_ID = /^[A-Za-z0-9_-]{32,64}$/;
/** Scope tokens that are accepted but grant nothing (refresh tokens follow the client's grant_types). */
const IGNORED_SCOPES = new Set(['offline_access']);

const now = (ctx: OAuthCtx) => ctx.deps.clock().getTime();
const jsonArray = (value: string): string[] => {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
};

/** RFC 8707 resource comparison: case-insensitive scheme/host (URL parsing), trailing slash ignored, no fragment. */
export function sameResource(candidate: string, expected: string): boolean {
  try {
    if (candidate.includes('#')) return false;
    const norm = (u: string) => {
      const url = new URL(u);
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
      return `${url.protocol}//${url.host}${path}${url.search}`;
    };
    return norm(candidate) === norm(expected);
  } catch {
    return false;
  }
}

/** Parses an OAuth `scope` parameter onto this API's scopes. */
export function parseScopeParam(raw: string | null | undefined): { ok: true; scopes: Scope[]; defaulted: boolean } | { ok: false; reason: string } {
  if (raw === null || raw === undefined || raw.trim() === '') return { ok: true, scopes: [...DEFAULT_OAUTH_SCOPES], defaulted: true };
  if (raw.length > OAUTH_LIMITS.scope) return { ok: false, reason: 'scope is too long' };
  const tokens = raw.split(' ').filter(Boolean);
  const known = SCOPES.filter((s) => tokens.includes(s));
  const unknown = tokens.filter((t) => !(SCOPES as readonly string[]).includes(t) && !IGNORED_SCOPES.has(t));
  if (known.length === 0) {
    if (unknown.length === 0) return { ok: true, scopes: [...DEFAULT_OAUTH_SCOPES], defaulted: true };
    return { ok: false, reason: `None of the requested scopes exist. Supported scopes: ${SCOPES.join(' ')}` };
  }
  // Unknown extra scopes (e.g. "openid") are ignored rather than failing the whole request.
  return { ok: true, scopes: known, defaulted: false };
}

/** Appends OAuth response parameters (and `iss`, RFC 9207) to a validated redirect URI. */
export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>, issuer: string): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set('iss', issuer);
  return url.href;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function registerClient(ctx: OAuthCtx, body: unknown) {
  const tunables = oauthTunables(ctx.deps);
  if (!tunables.registrationEnabled) {
    throw new OAuthError('access_denied', 'Dynamic client registration is turned off on this server', 403);
  }
  const result = validateClientMetadata(body, { requireName: false });
  if (!result.ok) throw new OAuthError(result.error, result.reason);
  const meta = result.value;
  const t = now(ctx);
  // Housekeeping: drop registrations that were never used, and stale requests/codes/tokens.
  await ctx.repo.purgeExpired(t, DAY_MS);
  const clientId = ctx.deps.secrets.generate('mi_client_');
  await ctx.repo.insertDcrClient({ clientId, ...meta, createdAt: t, unusedExpiresAt: t + tunables.unusedClientMs });
  const scope = typeof (body as { scope?: unknown }).scope === 'string' ? (body as { scope: string }).scope : undefined;
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(t / 1000),
    client_name: meta.clientName,
    ...(meta.clientUri ? { client_uri: meta.clientUri } : {}),
    redirect_uris: meta.redirectUris,
    grant_types: meta.grantTypes,
    response_types: ['code'],
    // Only public clients are supported: PKCE protects the code, no client secret is issued.
    token_endpoint_auth_method: 'none',
    ...(scope ? { scope } : {}),
    ...(meta.softwareId ? { software_id: meta.softwareId } : {}),
    ...(meta.softwareVersion ? { software_version: meta.softwareVersion } : {}),
  };
}

type ClientResolution = { ok: true; client: OAuthClientRow } | { ok: false; error: OAuthRequestError };

/** Finds a registered client, or fetches (and caches) its Client ID Metadata Document. */
export async function resolveClient(ctx: OAuthCtx, clientId: string): Promise<ClientResolution> {
  const t = now(ctx);
  if (clientId.length > OAUTH_LIMITS.clientId) return { ok: false, error: 'invalid_client' };
  if (clientId.startsWith('https://')) {
    if (!oauthTunables(ctx.deps).metadataDocumentsEnabled) return { ok: false, error: 'invalid_client' };
    const cached = await ctx.repo.findClient(clientId);
    if (cached?.kind === 'cimd' && (cached.metadata_expires_at ?? 0) > t) return { ok: true, client: cached };
    const ownHost = new URL(ctx.urls.issuer).hostname;
    const checked = checkMetadataDocumentUrl(clientId, ownHost);
    if (!checked.ok) return { ok: false, error: 'invalid_client' };
    const { success } = await ctx.deps.rateLimiters.create.limit({ key: `oauth-cimd:${ctx.clientIp}` });
    if (!success) return { ok: false, error: 'rate_limited' };
    const fetched = await fetchMetadataDocument(checked.url, ctx.deps.outboundFetch ?? fetch);
    if (!fetched.ok) return { ok: false, error: 'invalid_client_metadata' };
    const row = await ctx.repo.upsertCimdClient({ clientId, ...fetched.value, now: t, metadataExpiresAt: t + fetched.cacheMs });
    return row ? { ok: true, client: row } : { ok: false, error: 'invalid_client' };
  }
  const row = await ctx.repo.findClient(clientId);
  if (!row || row.kind !== 'dcr') return { ok: false, error: 'invalid_client' };
  if (row.first_used_at === null && (row.unused_expires_at ?? 0) <= t) return { ok: false, error: 'invalid_client' };
  return { ok: true, client: row };
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

const SINGLE_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'prompt'];

/**
 * Validates an authorization request. Returns where to send the browser:
 * the consent screen, the consent screen's error view (when the client or
 * redirect URI cannot be trusted, the browser is never sent to the client),
 * or the client's redirect URI with an OAuth error.
 */
export async function startAuthorization(ctx: OAuthCtx, params: URLSearchParams, consentUrl: (query: string) => string): Promise<string> {
  const showError = (code: OAuthRequestError) => consentUrl(`error=${code}`);
  const { success } = await ctx.deps.rateLimiters.poll.limit({ key: `oauth-authorize:${ctx.clientIp}` });
  if (!success) return showError('rate_limited');

  const duplicated = SINGLE_PARAMS.filter((p) => params.getAll(p).length > 1);
  if (duplicated.includes('client_id') || duplicated.includes('redirect_uri')) return showError('invalid_request');
  const clientId = params.get('client_id');
  if (!clientId) return showError('invalid_client');
  const resolved = await resolveClient(ctx, clientId);
  if (!resolved.ok) return showError(resolved.error);
  const client = resolved.client;

  const registered = jsonArray(client.redirect_uris);
  const requestedRedirect = params.get('redirect_uri');
  let redirectUri: string;
  if (requestedRedirect === null) {
    // OAuth 2.1: optional only when exactly one redirect URI is registered.
    if (registered.length !== 1) return showError('invalid_redirect_uri');
    redirectUri = registered[0];
  } else {
    if (!matchRedirectUri(registered, requestedRedirect)) return showError('invalid_redirect_uri');
    redirectUri = requestedRedirect;
  }

  // From here on errors go back to the (validated) redirect URI.
  const rawState = params.get('state');
  const state = rawState !== null && rawState.length <= OAUTH_LIMITS.state ? rawState : null;
  const fail = (error: string, description: string) =>
    buildRedirect(redirectUri, { error, error_description: description, state }, ctx.urls.issuer);
  if (rawState !== null && state === null) return fail('invalid_request', `state must be at most ${OAUTH_LIMITS.state} characters`);
  if (duplicated.length > 0) return fail('invalid_request', `Parameters must not be repeated: ${duplicated.join(', ')}`);
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be "code"');
  const challenge = params.get('code_challenge');
  if (!challenge) return fail('invalid_request', 'code_challenge is required (PKCE with S256)');
  if (!PKCE_VALUE.test(challenge)) return fail('invalid_request', 'code_challenge is malformed');
  const method = params.get('code_challenge_method');
  if (method !== 'S256') {
    return fail('invalid_request', method === null ? 'code_challenge_method=S256 is required' : 'Only the S256 code_challenge_method is supported');
  }
  const resources = params.getAll('resource');
  if (resources.length === 0) return fail('invalid_target', `resource is required: ${ctx.urls.resource}`);
  if (resources.length > 1 || !sameResource(resources[0], ctx.urls.resource)) {
    return fail('invalid_target', `The only resource served by this authorization server is ${ctx.urls.resource}`);
  }
  const scope = parseScopeParam(params.get('scope'));
  if (!scope.ok) return fail('invalid_scope', scope.reason);
  if ((params.get('prompt') ?? '').split(' ').includes('none')) {
    return fail('consent_required', 'This server never approves without asking the user');
  }

  const t = now(ctx);
  await ctx.repo.purgeExpired(t, DAY_MS);
  const id = ctx.deps.secrets.generate('');
  await ctx.repo.createRequest({
    id,
    clientId: client.client_id,
    redirectUri,
    redirectUriSent: requestedRedirect !== null,
    state,
    codeChallenge: challenge,
    scopes: scope.scopes,
    scopesDefaulted: scope.defaulted,
    resource: ctx.urls.resource,
    createdAt: t,
    expiresAt: t + OAUTH_TTL.requestMs,
  });
  return consentUrl(`request=${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Consent (app side, authenticated as the user)
// ---------------------------------------------------------------------------

async function pendingRequest(ctx: OAuthCtx, id: string): Promise<OAuthRequestRow & { client: OAuthClientRow }> {
  if (!REQUEST_ID.test(id)) throw errors.notFound('No authorization request with this id');
  const row = await ctx.repo.findRequest(id);
  if (!row) throw errors.notFound('No authorization request with this id');
  if (row.status !== 'pending') throw errors.conflict(`This request was already ${row.status}`, { status: row.status });
  if (row.expires_at <= now(ctx)) throw errors.gone('This request expired; start connecting again from your MCP client');
  return row;
}

export async function previewRequest(ctx: OAuthCtx, user: ConsentUser, id: string): Promise<OAuthRequestPreview> {
  const row = await pendingRequest(ctx, id);
  const existing = await ctx.repo.findActiveAgentForClient(user.workspaceId, row.client_id);
  return {
    request: {
      id: row.id,
      client: {
        kind: row.client.kind,
        name: row.client.client_name,
        metadataHost: row.client.kind === 'cimd' ? new URL(row.client.client_id).host : null,
        clientUri: row.client.client_uri,
      },
      redirect: { uri: row.redirect_uri, ...describeRedirect(row.redirect_uri) },
      requestedScopes: parseScopes(row.scopes),
      scopesDefaulted: row.scopes_defaulted === 1,
      existingAgent: existing ? { id: existing.id, name: existing.name, scopes: parseScopes(existing.scopes) } : null,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}

const approveSchema = z.object({ scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length).optional() }).strict();

export async function decideRequest(
  ctx: OAuthCtx,
  user: ConsentUser,
  id: string,
  decision: 'approved' | 'denied',
  body: unknown,
): Promise<OAuthDecisionResponse> {
  const row = await pendingRequest(ctx, id);
  const t = now(ctx);
  const raced = async (): Promise<never> => {
    const latest = await ctx.repo.findRequest(id);
    if (latest && latest.status === 'pending') throw errors.gone('This request expired; start connecting again from your MCP client');
    throw errors.conflict('This request was already decided', { status: latest?.status });
  };
  if (decision === 'denied') {
    if (!(await ctx.repo.denyRequest(id, user.workspaceId, t))) return raced();
    return {
      status: 'denied',
      redirectTo: buildRedirect(row.redirect_uri, { error: 'access_denied', error_description: 'The user denied access', state: row.state }, ctx.urls.issuer),
    };
  }
  const parsed = approveSchema.safeParse(body ?? {});
  if (!parsed.success) throw errors.validation(zodDetails(parsed.error));
  const requested = parseScopes(row.scopes);
  const scopes = parsed.data.scopes ? SCOPES.filter((s) => parsed.data.scopes!.includes(s)) : requested;
  const extra = scopes.filter((s) => !requested.includes(s));
  if (extra.length > 0) throw errors.invalidScope('Approved scopes must be a subset of the requested scopes', { requested, notRequested: extra });
  const code = ctx.deps.secrets.generate(OAUTH_TOKEN_PREFIX.code);
  const ok = await ctx.repo.approveRequest({ id, workspaceId: user.workspaceId, scopes, now: t, codeHash: await sha256Hex(code), codeExpiresAt: t + OAUTH_TTL.codeMs });
  if (!ok) return raced();
  return { status: 'approved', scopes, redirectTo: buildRedirect(row.redirect_uri, { code, state: row.state }, ctx.urls.issuer) };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

async function newTokens(ctx: OAuthCtx, scopes: Scope[], refreshable: boolean, t: number) {
  const { accessSeconds, refreshMs } = oauthTunables(ctx.deps);
  const access = ctx.deps.secrets.generate(OAUTH_TOKEN_PREFIX.access);
  const refresh = refreshable ? ctx.deps.secrets.generate(OAUTH_TOKEN_PREFIX.refresh) : null;
  const tokens: NewTokens = {
    accessHash: await sha256Hex(access),
    accessExpiresAt: t + accessSeconds * 1000,
    refreshHash: refresh ? await sha256Hex(refresh) : null,
    refreshExpiresAt: t + refreshMs,
    scopes,
  };
  const response: TokenResponse = {
    access_token: access,
    token_type: 'Bearer',
    expires_in: accessSeconds,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: scopes.join(' '),
  };
  return { tokens, response };
}

function checkResourceParam(ctx: OAuthCtx, form: URLSearchParams, granted: string) {
  const resources = form.getAll('resource');
  if (resources.length === 0) return;
  if (resources.length > 1 || !sameResource(resources[0], granted) || !sameResource(resources[0], ctx.urls.resource)) {
    throw oauthErrors.invalidTarget(`Tokens from this server are only valid for ${ctx.urls.resource}`);
  }
}

export async function exchangeToken(ctx: OAuthCtx, form: URLSearchParams, clientId: string): Promise<TokenResponse> {
  const client = await ctx.repo.findClient(clientId);
  if (!client) throw oauthErrors.invalidClient();
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') return exchangeCode(ctx, form, client);
  if (grantType === 'refresh_token') return refresh(ctx, form, client);
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

async function exchangeCode(ctx: OAuthCtx, form: URLSearchParams, client: OAuthClientRow): Promise<TokenResponse> {
  const code = form.get('code');
  const verifier = form.get('code_verifier');
  if (!code) throw oauthErrors.invalidRequest('code is required');
  if (!verifier) throw oauthErrors.invalidRequest('code_verifier is required (PKCE)');
  const t = now(ctx);
  const codeHash = await sha256Hex(code);
  const row = await ctx.repo.findCode(codeHash);
  if (!row) throw oauthErrors.invalidGrant('Unknown authorization code');
  if (row.used_at !== null) {
    // A second redemption means the code leaked: revoke what the first one issued (OAuth 2.1 §4.1.3).
    await ctx.repo.revokeGrantOfCode(codeHash, t);
    throw oauthErrors.invalidGrant('This authorization code was already used; the tokens issued for it are revoked');
  }
  if (row.expires_at <= t) throw oauthErrors.invalidGrant('The authorization code expired');
  if (row.client_id !== client.client_id) throw oauthErrors.invalidGrant('The authorization code was issued to another client');
  if (await ctx.repo.isWorkspaceSuspended(row.workspace_id)) throw suspendedError();
  const redirectUri = form.get('redirect_uri');
  if (row.redirect_uri_sent === 1 ? redirectUri !== row.redirect_uri : redirectUri !== null && redirectUri !== row.redirect_uri) {
    throw oauthErrors.invalidGrant('redirect_uri does not match the authorization request');
  }
  checkResourceParam(ctx, form, row.resource);
  if (!(await verifyPkce(verifier, row.code_challenge))) throw oauthErrors.invalidGrant('PKCE verification failed (code_verifier does not match)');

  const scopes = parseScopes(row.scopes);
  const refreshable = jsonArray(client.grant_types).includes('refresh_token');
  const { tokens, response } = await newTokens(ctx, scopes, refreshable, t);
  const existing = await ctx.repo.findActiveAgentForClient(row.workspace_id, client.client_id);
  const agent = await ctx.repo.redeemCode({
    codeHash,
    now: t,
    grantId: ctx.deps.ids.uuid(),
    refreshable,
    agent: existing ? { existingId: existing.id } : { newId: ctx.deps.ids.uuid(), name: client.client_name, createdAt: new Date(t).toISOString() },
    agentName: client.client_name,
    tokens,
  });
  if (!agent) {
    const latest = await ctx.repo.findCode(codeHash);
    if (latest?.used_at !== null && latest?.used_at !== undefined && latest.grant_id) await ctx.repo.revokeGrantOfCode(codeHash, t);
    throw oauthErrors.invalidGrant('The authorization code is no longer valid');
  }
  return response;
}

async function refresh(ctx: OAuthCtx, form: URLSearchParams, client: OAuthClientRow): Promise<TokenResponse> {
  const token = form.get('refresh_token');
  if (!token) throw oauthErrors.invalidRequest('refresh_token is required');
  if (!token.startsWith(OAUTH_TOKEN_PREFIX.refresh)) throw oauthErrors.invalidGrant('Unknown refresh token');
  const t = now(ctx);
  const hash = await sha256Hex(token);
  const row = await ctx.repo.lookupToken(hash);
  if (!row || row.kind !== 'refresh' || row.client_id !== client.client_id) throw oauthErrors.invalidGrant('Unknown refresh token');
  if (row.used_at !== null) {
    await ctx.repo.revokeGrant(row.grant_id, t, 'refresh_reuse');
    throw oauthErrors.invalidGrant('This refresh token was already used; for your safety every token of this authorization is revoked');
  }
  if (row.token_revoked_at !== null || row.grant_revoked_at !== null || row.agent_revoked_at !== null) {
    throw oauthErrors.invalidGrant('This authorization was revoked');
  }
  if (row.expires_at <= t) throw oauthErrors.invalidGrant('The refresh token expired');
  if (row.workspace_suspended) throw suspendedError();
  checkResourceParam(ctx, form, row.resource);
  const current = parseScopes(row.token_scopes);
  let scopes = current;
  const scopeParam = form.get('scope');
  if (scopeParam !== null && scopeParam.trim() !== '') {
    const parsed = parseScopeParam(scopeParam);
    if (!parsed.ok || parsed.scopes.some((s) => !current.includes(s))) {
      throw oauthErrors.invalidScope('A refresh can only keep or narrow the granted scopes');
    }
    scopes = parsed.scopes;
  }
  if (!(await ctx.repo.markRefreshTokenUsed(hash, t))) {
    await ctx.repo.revokeGrant(row.grant_id, t, 'refresh_reuse');
    throw oauthErrors.invalidGrant('This refresh token was already used; for your safety every token of this authorization is revoked');
  }
  const { tokens, response } = await newTokens(ctx, scopes, true, t);
  if (!(await ctx.repo.insertTokens(row.grant_id, row.workspace_id, t, tokens))) throw oauthErrors.invalidGrant('This authorization was revoked');
  return response;
}

/** RFC 7009: always succeeds for well-formed requests; only the client a token was issued to can revoke it. */
export async function revokeToken(ctx: OAuthCtx, form: URLSearchParams, clientId: string): Promise<void> {
  const token = form.get('token');
  if (!token) throw oauthErrors.invalidRequest('token is required');
  if (!token.startsWith(OAUTH_TOKEN_PREFIX.access) && !token.startsWith(OAUTH_TOKEN_PREFIX.refresh)) return;
  const hash = await sha256Hex(token);
  const row = await ctx.repo.lookupToken(hash);
  if (!row || row.client_id !== clientId) return;
  const t = now(ctx);
  if (row.kind === 'refresh') await ctx.repo.revokeGrant(row.grant_id, t, 'revoked_by_client');
  else await ctx.repo.revokeToken(hash, t);
}

// ---------------------------------------------------------------------------
// Resource server side: access tokens on /api/mcp
// ---------------------------------------------------------------------------

/**
 * Resolves an OAuth access token presented to the MCP endpoint
 * `expectedResource`: the agent principal, 'suspended' if its workspace is
 * suspended by the operator, or null if the token is not valid here.
 */
export async function authenticateAccessToken(
  repo: OAuthRepository,
  token: string,
  expectedResource: string,
  nowMs: number,
): Promise<Extract<Principal, { type: 'agent' }> | 'suspended' | null> {
  const row = await repo.lookupToken(await sha256Hex(token));
  if (!row || row.kind !== 'access') return null;
  if (row.expires_at <= nowMs || row.token_revoked_at !== null || row.grant_revoked_at !== null || row.agent_revoked_at !== null) return null;
  // Audience binding (RFC 8707): the token is only valid at the resource it was issued for.
  if (!sameResource(row.resource, expectedResource)) return null;
  // The operator hook matches workspace tokens and agent keys by hash; OAuth
  // tokens are checked here, against the suspension table, on every request.
  if (row.workspace_suspended) return 'suspended';
  const agentScopes = parseScopes(row.agent_scopes);
  return {
    type: 'agent',
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentDescription: row.agent_description,
    agentCreatedAt: row.agent_created_at,
    lastUsedAt: row.agent_last_used_at,
    // A later re-authorisation with fewer permissions also narrows older tokens.
    scopes: parseScopes(row.token_scopes).filter((s) => agentScopes.includes(s)),
    credential: 'oauth',
  };
}
