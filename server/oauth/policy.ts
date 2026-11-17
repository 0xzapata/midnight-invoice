/**
 * Operator policy answers (maintenance mode, …) for the OAuth protocol
 * endpoints, in the shape OAuth clients understand. Called by the operator
 * request hook (server/operator/hooks.ts) for /api/oauth/* instead of the
 * API's `{ error: { code } }` envelope.
 */
import type { Context } from 'hono';
import { OAUTH_CONSENT_PATH, OAUTH_PATHS } from '../../shared/oauth';
import type { AppDeps } from '../deps';
import type { ApiError } from '../errors';
import { publicBaseUrl } from '../http';
import { OAUTH_NO_STORE } from './errors';

export function isOAuthProtocolPath(path: string): boolean {
  return path.startsWith('/api/oauth/');
}

export function oauthPolicyResponse(c: Context, blocked: ApiError, deps: AppDeps): Response {
  const unavailable = blocked.status === 503;
  if (c.req.path === OAUTH_PATHS.authorize && c.req.method === 'GET') {
    // A browser navigation: show the app's fixed error text, never redirect to the client.
    const base = publicBaseUrl(c, deps.config.appUrl);
    const code = unavailable ? 'temporarily_unavailable' : 'invalid_request';
    return new Response(null, {
      status: 302,
      headers: { location: `${base}${OAUTH_CONSENT_PATH}?error=${code}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  }
  return Response.json(
    { error: unavailable ? 'temporarily_unavailable' : 'access_denied', error_description: blocked.message },
    {
      status: blocked.status,
      headers: { ...OAUTH_NO_STORE, ...blocked.headers, 'access-control-allow-origin': '*' },
    },
  );
}
