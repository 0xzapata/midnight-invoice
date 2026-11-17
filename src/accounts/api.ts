/**
 * Client for the browser-only account API (`/api/account/*`, same origin).
 *
 * Authenticated by the HttpOnly session cookie (never readable here) plus the
 * CSRF token from GET /session on state-changing requests. Device tokens are
 * only ever sent in the Authorization header and never logged or shown.
 */
import {
  ACCOUNT_API_BASE,
  ACCOUNT_CSRF_HEADER,
  type AccountConfigResponse,
  type AccountSessionResponse,
  type AccountWorkspace,
  type DeleteAccountResponse,
  type DeviceTokenResponse,
  type DevicesResponse,
  type RecoveryKeyRotateResponse,
  type StartSignInRequest,
  safeReturnTo,
} from '../../shared/accounts';

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccountApiError';
  }
}

export const isAccountError = (e: unknown, status?: number, code?: string): e is AccountApiError =>
  e instanceof AccountApiError && (status === undefined || e.status === status) && (code === undefined || e.code === code);

let csrfToken: string | null = null;
export const setAccountCsrfToken = (token: string | null) => {
  csrfToken = token;
};

async function request<T>(method: string, path: string, opts: { body?: unknown; bearer?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[ACCOUNT_CSRF_HEADER] = csrfToken;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  let res: Response;
  try {
    res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    // Never carry request details (headers hold tokens).
    throw new AccountApiError(0, 'network_error', 'The server could not be reached. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text().catch(() => '');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new AccountApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `Request failed (HTTP ${res.status})`);
  }
  const data = json as T;
  if (data && typeof data === 'object' && 'csrfToken' in data && typeof (data as { csrfToken: unknown }).csrfToken === 'string') {
    setAccountCsrfToken((data as { csrfToken: string }).csrfToken);
  }
  return data;
}

export const accountApi = {
  config: () => request<AccountConfigResponse>('GET', '/config'),
  session: () => request<AccountSessionResponse>('GET', '/session'),
  startSignIn: (input: StartSignInRequest) => request<{ authorizationUrl: string }>('POST', '/auth/start', { body: input }),
  /** Signs this browser out: the session cookie and/or this browser's device token (sent as Bearer). */
  signOut: (deviceToken?: string | null) => request<void>('POST', '/sign-out', { bearer: deviceToken }),
  createWorkspace: () => request<DeviceTokenResponse>('POST', '/workspace', { body: {} }),
  claim: (workspaceToken: string) => request<DeviceTokenResponse>('POST', '/workspace/claim', { body: {}, bearer: workspaceToken }),
  connect: (currentToken?: string | null) => request<DeviceTokenResponse>('POST', '/workspace/connect', { body: {}, bearer: currentToken }),
  devices: () => request<DevicesResponse>('GET', '/devices'),
  /** Why a (rejected) device token stopped working; the token itself authenticates the question. */
  deviceStatus: (deviceToken: string) =>
    request<{ status: 'active' | 'revoked' | 'account_disabled' | 'unknown' }>('GET', '/device-status', { bearer: deviceToken }),
  revokeDevice: (id: string) => request<void>('DELETE', `/devices/${encodeURIComponent(id)}`),
  signOutEverywhere: (keepThisDevice: boolean) => request<void>('POST', '/sign-out-everywhere', { body: { keepThisDevice } }),
  rotateRecoveryKey: () => request<RecoveryKeyRotateResponse>('POST', '/recovery-key/rotate', { body: {} }),
  disableRecoveryKey: () => request<{ workspace: AccountWorkspace }>('POST', '/recovery-key/disable', { body: {} }),
  deleteAccount: (confirm: string, deleteWorkspace: boolean) => request<DeleteAccountResponse>('DELETE', '', { body: { confirm, deleteWorkspace } }),
};

/** Full-page navigation to AuthKit (indirected so tests can observe it). */
export const accountNav = {
  assign: (url: string) => window.location.assign(url),
};

/** Starts AuthKit sign-in / sign-up and leaves the page. */
export async function startAccountSignIn(intent: 'sign-in' | 'sign-up', returnTo: string, loginHint?: string): Promise<void> {
  const { authorizationUrl } = await accountApi.startSignIn({ intent, returnTo: safeReturnTo(returnTo), loginHint });
  accountNav.assign(authorizationUrl);
}

export function accountErrorMessage(error: unknown): string {
  if (error instanceof AccountApiError) {
    if (error.code === 'rate_limited') return 'Too many attempts. Wait a minute and try again.';
    // Operator policy (maintenance mode, suspended workspace) carries a message meant for users.
    if (error.code === 'maintenance' || error.code === 'workspace_suspended' || error.code === 'registration_closed') return error.message;
    if (error.code === 'accounts_unavailable' || error.status === 503) return 'Accounts are not available on this site right now.';
    if (error.status === 401) return 'Your account session ended. Sign in again.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
