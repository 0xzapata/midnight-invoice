/**
 * OAuth 2.1 for the MCP endpoint: paths, credential prefixes and the consent
 * API contract shared by the Worker and the browser app. See AGENT_API.md
 * ("Connect with OAuth").
 */
import type { Scope } from './api';

/** Protocol endpoints (outside /api/v1; described by the RFC 8414 metadata, not OpenAPI). */
export const OAUTH_PATHS = {
  authorize: '/api/oauth/authorize',
  token: '/api/oauth/token',
  register: '/api/oauth/register',
  revoke: '/api/oauth/revoke',
  protectedResourceMetadata: '/.well-known/oauth-protected-resource',
  authorizationServerMetadata: '/.well-known/oauth-authorization-server',
} as const;

/** SPA route of the consent screen (`?request=<id>` or `?error=<code>`). */
export const OAUTH_CONSENT_PATH = '/agents/authorize';

/** Secret prefixes (256-bit random, base64url), distinct from workspace tokens and agent keys. */
export const OAUTH_TOKEN_PREFIX = {
  code: 'mi_ac_',
  access: 'mi_at_',
  refresh: 'mi_rt_',
} as const;

/**
 * Granted when an authorization request carries no `scope`: read and write
 * invoices, read clients and the default settings. Destructive permissions
 * (invoices:delete, clients:write) must be asked for explicitly.
 */
export const DEFAULT_OAUTH_SCOPES: readonly Scope[] = ['invoices:read', 'invoices:write', 'settings:read', 'clients:read'];

/**
 * Why an authorization request cannot even be shown for review. These are
 * fixed codes: the consent screen shows its own text, never text from the request.
 */
export const OAUTH_REQUEST_ERRORS = [
  'invalid_client',
  'invalid_redirect_uri',
  'invalid_client_metadata',
  'invalid_request',
  'rate_limited',
] as const;
export type OAuthRequestError = (typeof OAUTH_REQUEST_ERRORS)[number];

/** How the client receives the answer. */
export type OAuthRedirectKind = 'https' | 'loopback' | 'custom_scheme';

/** GET /api/v1/oauth/requests/:id (workspace token) */
export interface OAuthRequestPreview {
  request: {
    id: string;
    client: {
      /** dcr = registered itself (RFC 7591); cimd = identified by a metadata document URL. */
      kind: 'dcr' | 'cimd';
      /** Chosen by the client: untrusted text. */
      name: string;
      /** For cimd: the host that publishes the client's metadata document. */
      metadataHost: string | null;
      /** Optional homepage given by the client (untrusted). */
      clientUri: string | null;
    };
    redirect: {
      uri: string;
      kind: OAuthRedirectKind;
      /** Host (with port for loopback) or, for a custom scheme, the scheme. */
      display: string;
    };
    requestedScopes: Scope[];
    /** The client asked for no scope; `requestedScopes` are DEFAULT_OAUTH_SCOPES. */
    scopesDefaulted: boolean;
    /** An active agent this client already has in this workspace; approving updates it. */
    existingAgent: { id: string; name: string; scopes: Scope[] } | null;
    createdAt: string;
    expiresAt: string;
  };
}

/** POST /api/v1/oauth/requests/:id/approve request (optional body) */
export interface OAuthApproveRequest {
  /** Subset of the requested scopes. Defaults to all requested scopes. */
  scopes?: Scope[];
}

/** POST …/approve and …/deny → 200: where to send the browser (the client's redirect URI). */
export interface OAuthDecisionResponse {
  status: 'approved' | 'denied';
  redirectTo: string;
  scopes?: Scope[];
}
