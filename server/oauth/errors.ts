/**
 * OAuth protocol errors (RFC 6749 §5.2, RFC 7591 §3.2.2, RFC 7009). These
 * endpoints answer `{ error, error_description }`, not the API's
 * `{ error: { code, message } }` envelope, because OAuth clients parse them.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'unsupported_token_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'consent_required'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata';

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
    readonly status = 400,
    readonly headers: Record<string, string> = {},
  ) {
    super(description);
    this.name = 'OAuthError';
  }

  toResponse(extraHeaders: Record<string, string> = {}): Response {
    return Response.json(
      { error: this.code, error_description: this.description },
      { status: this.status, headers: { ...OAUTH_NO_STORE, ...this.headers, ...extraHeaders } },
    );
  }
}

export const OAUTH_NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const oauthErrors = {
  invalidRequest: (d: string) => new OAuthError('invalid_request', d),
  invalidClient: (d = 'Unknown or invalid client') => new OAuthError('invalid_client', d, 401, { 'www-authenticate': 'Basic realm="midnight-invoice"' }),
  invalidGrant: (d: string) => new OAuthError('invalid_grant', d),
  invalidScope: (d: string) => new OAuthError('invalid_scope', d),
  invalidTarget: (d: string) => new OAuthError('invalid_target', d),
  rateLimited: () => new OAuthError('temporarily_unavailable', 'Too many requests, slow down', 429, { 'retry-after': '60' }),
};
