/**
 * OAuth lifetimes, limits and the URLs this Worker publishes as authorization
 * server (issuer = the public origin) and protected resource (the MCP endpoint).
 */
import { MCP_PATH, SCOPES } from '../../shared/api';
import { OAUTH_PATHS } from '../../shared/oauth';
import type { AppDeps } from '../deps';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Fixed lifetimes. Access/refresh token lifetimes and the unused-registration
 * lifetime are runtime settings (operator console), see `oauthTunables`.
 */
export const OAUTH_TTL = {
  /** Pending authorization request (the consent screen must be answered within this). */
  requestMs: 10 * 60 * 1000,
  /** Authorization code: single use, redeemed by the client right after the redirect. */
  codeMs: 2 * 60 * 1000,
  /** Client ID Metadata Document cache bounds (Cache-Control max-age is clamped into this range). */
  metadataMinMs: 5 * 60 * 1000,
  metadataDefaultMs: 60 * 60 * 1000,
  metadataMaxMs: 24 * 60 * 60 * 1000,
} as const;

export const OAUTH_LIMITS = {
  /** POST /register body. */
  registerBodyBytes: 8 * 1024,
  /** POST /token and /revoke bodies. */
  formBodyBytes: 8 * 1024,
  /** Client ID Metadata Document download. */
  metadataDocumentBytes: 5 * 1024,
  metadataFetchTimeoutMs: 5000,
  redirectUris: 10,
  uri: 1024,
  clientName: 100,
  state: 1024,
  scope: 1000,
  clientId: 512,
} as const;

export const SCOPES_SUPPORTED: readonly string[] = SCOPES;

/** Operator-tunable OAuth settings (server/operator/settings-registry.ts, `oauth.*`). */
export function oauthTunables(deps: Pick<AppDeps, 'settings'>) {
  const s = deps.settings;
  return {
    /** Access token lifetime (default 1 hour). */
    accessSeconds: s.get('oauth.accessTokenMinutes') * 60,
    /** Refresh token lifetime; each use rotates it and issues a new one with a fresh lifetime (default 30 days). */
    refreshMs: s.get('oauth.refreshTokenDays') * 24 * HOUR_MS,
    /** A dynamically registered client that never completes a code exchange is deleted after this (default 24 h). */
    unusedClientMs: s.get('oauth.unusedClientHours') * HOUR_MS,
    registrationEnabled: s.get('oauth.registrationEnabled'),
    metadataDocumentsEnabled: s.get('oauth.metadataDocumentsEnabled'),
  };
}

export type OAuthTunables = ReturnType<typeof oauthTunables>;

export function oauthUrls(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    issuer: base,
    resource: `${base}${MCP_PATH}`,
    /** RFC 9728 path-suffixed location for the MCP endpoint (the one the 401 challenge names). */
    resourceMetadata: `${base}${OAUTH_PATHS.protectedResourceMetadata}${MCP_PATH}`,
    authorizationServerMetadata: `${base}${OAUTH_PATHS.authorizationServerMetadata}`,
    authorize: `${base}${OAUTH_PATHS.authorize}`,
    token: `${base}${OAUTH_PATHS.token}`,
    register: `${base}${OAUTH_PATHS.register}`,
    revoke: `${base}${OAUTH_PATHS.revoke}`,
  };
}

export type OAuthUrls = ReturnType<typeof oauthUrls>;

/** RFC 9728 Protected Resource Metadata for the MCP endpoint. */
export function protectedResourceMetadata(baseUrl: string) {
  const urls = oauthUrls(baseUrl);
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'Midnight Invoice',
    resource_documentation: `${urls.issuer}/llms.txt`,
  };
}

/** RFC 8414 Authorization Server Metadata. */
export function authorizationServerMetadata(baseUrl: string, flags: Pick<OAuthTunables, 'registrationEnabled' | 'metadataDocumentsEnabled'>) {
  const urls = oauthUrls(baseUrl);
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    ...(flags.registrationEnabled ? { registration_endpoint: urls.register } : {}),
    revocation_endpoint: urls.revoke,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: flags.metadataDocumentsEnabled,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${urls.issuer}/llms.txt`,
  };
}
