/**
 * The OAuth consent screen's view of "who is the user" and how it talks to
 * the server, behind one small interface.
 *
 * Today the user is this browser's cloud-sync workspace: the consent API is
 * called through `api`, which sends the workspace token only in the
 * Authorization header of same-origin /api/v1 requests (never in a URL, a
 * cookie or the page). A browser signed in with an optional account uses its
 * own device token here, so nothing changes; a browser without a workspace is
 * offered "Sign in" first on the consent screen (EnableCloudSyncCard
 * `accountFirst`), which returns to the same `?request=` after sign-in.
 */
import { api } from '@/lib/api';
import { useCloudEnabled } from '@/stores/useCloudStore';
import type { Scope } from '../../../shared/api';

export type ConsentIdentity = { status: 'ready' } | { status: 'needs_workspace' };

export function useConsentIdentity(): ConsentIdentity {
  return useCloudEnabled() ? { status: 'ready' } : { status: 'needs_workspace' };
}

export const consentApi = {
  get: (requestId: string) => api.getOAuthRequest(requestId),
  approve: (requestId: string, scopes: Scope[]) => api.approveOAuthRequest(requestId, scopes),
  deny: (requestId: string) => api.denyOAuthRequest(requestId),
};

const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'about:']);

/**
 * Defence in depth before leaving the app: the server builds the target from
 * the redirect URI it validated, and the browser only follows it if it still
 * points at the redirect URI the user was shown.
 */
export function checkRedirectTarget(target: string, expectedRedirectUri: string): URL | null {
  try {
    const url = new URL(target);
    const expected = new URL(expectedRedirectUri);
    if (BLOCKED_PROTOCOLS.has(url.protocol)) return null;
    const sameTarget = url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname;
    return sameTarget ? url : null;
  } catch {
    return null;
  }
}

/** Leaves the app for the client's redirect URI (replaceable in tests: jsdom cannot navigate). */
export const browser = {
  leaveTo: (url: string) => window.location.assign(url),
};
