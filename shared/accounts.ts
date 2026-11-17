/**
 * User accounts (optional, sign in with WorkOS AuthKit): the browser-only
 * contract of `/api/account/*`, shared by the Worker and the SPA.
 *
 * These endpoints are authenticated by an HttpOnly session cookie, not by a
 * bearer token, so they are deliberately NOT part of the public API
 * (`/api/v1`, openapi.json, AGENT_API.md "Endpoints"); `server/openapi.test.ts`
 * enforces that. They are documented in AGENTS.md "User accounts".
 */
import type { Workspace } from './api';

export const ACCOUNT_API_BASE = '/api/account';
export const ACCOUNT_CSRF_HEADER = 'x-csrf-token';

/** Error codes specific to /api/account (body shape is the usual `{ error: { code, message } }`). */
export type AccountErrorCode =
  | 'accounts_disabled'
  | 'accounts_unavailable'
  | 'account_required'
  | 'csrf_failed'
  | 'no_workspace'
  | 'workspace_exists'
  | 'workspace_owned'
  | 'account_disabled';

/** Error codes the callback can hand to /account/connect as `?error=`. */
export const SIGN_IN_ERRORS = {
  invalid_state: 'The sign-in link expired or was opened in a different browser. Start again.',
  authorization_failed: 'Sign-in was not completed. Start again.',
  email_not_verified: 'Verify your email address with the sign-in provider first, then sign in again.',
  account_disabled: 'This account has been disabled by the site operator.',
  accounts_unavailable: 'Accounts are not available on this site right now.',
  rate_limited: 'Too many sign-in attempts. Wait a minute and try again.',
} as const;
export type SignInError = keyof typeof SIGN_IN_ERRORS;

/** GET /api/account/config (public). `enabled` is false whenever any account surface must be hidden. */
export interface AccountConfigResponse {
  enabled: boolean;
  /** New cloud workspaces can only be created by signed-in users (POST /api/v1/workspaces → 403 account_required). */
  requiredForNewWorkspaces: boolean;
}

export interface AccountUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
}

export interface AccountWorkspace extends Workspace {
  /** Whether the original workspace token (recovery key) still works. */
  recoveryKeyEnabled: boolean;
}

/** GET /api/account/session */
export interface AccountSessionResponse {
  user: AccountUser;
  workspace: AccountWorkspace | null;
  /** Send as `x-csrf-token` on every state-changing /api/account request. */
  csrfToken: string;
  session: { createdAt: number; expiresAt: number; deviceId: string | null };
}

/** POST /api/account/auth/start */
export interface StartSignInRequest {
  intent?: 'sign-in' | 'sign-up';
  returnTo?: string;
  /** Pre-fills the email on the AuthKit page. */
  loginHint?: string;
}

/** POST /api/account/workspace (create), /workspace/claim, /workspace/connect */
export interface DeviceTokenResponse {
  workspace: AccountWorkspace;
  /** This browser's own workspace token (`mi_ws_…`). Shown once; only its SHA-256 is stored. */
  token: string;
  deviceId: string;
  /** connect only: true when the presented device token was kept instead of minting a new one. */
  reused?: boolean;
}

export interface DeviceItem {
  id: string;
  label: string;
  createdAt: number;
  /** Most recent activity of a session linked to this device (account pages), if any. */
  lastSeenAt: number | null;
  /** Last authenticated API use of this device's token (sync, approvals), throttled. */
  lastUsedAt: number | null;
  signedIn: boolean;
  current: boolean;
}

/** GET /api/account/devices */
export interface DevicesResponse {
  devices: DeviceItem[];
}

/** POST /api/account/recovery-key/rotate */
export interface RecoveryKeyRotateResponse {
  recoveryKey: string;
}

/** DELETE /api/account (body: { confirm: <email>, deleteWorkspace: boolean }) */
export interface DeleteAccountResponse {
  deletedWorkspace: boolean;
  /** When the workspace is kept: a fresh recovery key so this browser can keep using it anonymously. */
  recoveryKey: string | null;
}

// ---------------------------------------------------------------------------
// return_to: same-origin path allowlist (open-redirect safe)
// ---------------------------------------------------------------------------

const RETURN_PATHS = new Set(['/', '/agents', '/agents/approve', '/account', '/clients']);
const RETURN_PARAMS: Record<string, RegExp> = {
  tab: /^settings$/,
  code: /^[A-Za-z0-9-]{4,16}$/,
};

/**
 * Returns a safe in-app path for after sign-in: only listed paths on this
 * origin, only known query parameters with expected values, no fragments.
 * Anything else becomes "/?tab=settings".
 */
export function safeReturnTo(raw: unknown): string {
  const fallback = '/?tab=settings';
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return fallback;
  // Must be an absolute path: no scheme, no protocol-relative "//", no backslashes or control characters.
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw)) return fallback;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw, 'https://origin.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://origin.invalid' || !RETURN_PATHS.has(url.pathname)) return fallback;
  const out = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    const re = RETURN_PARAMS[key];
    if (!re || !re.test(value) || out.has(key)) return fallback;
    out.set(key, value);
  }
  const qs = out.toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}`;
}

/** Short, human device label from a user agent ("Firefox on macOS"). Display only. */
export function deviceLabelFromUserAgent(ua: string | null | undefined): string {
  const s = ua ?? '';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad|iPod/.test(s)
    ? 'iOS'
    : /Android/.test(s)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(s)
        ? 'macOS'
        : /Windows/.test(s)
          ? 'Windows'
          : /CrOS/.test(s)
            ? 'ChromeOS'
            : /Linux/.test(s)
              ? 'Linux'
              : null;
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------------------
// Operator console (private, /api/operator/accounts)
// ---------------------------------------------------------------------------

export interface OperatorAccountItem {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
  lastSignInAt: number | null;
  workspaceId: string | null;
  activeDevices: number;
  disabled: boolean;
  disabledAt: number | null;
  disabledReason: string | null;
}

export interface OperatorAccountsResponse {
  enabled: boolean;
  /** Workspaces owned by an account. When accounts are off their device tokens keep working (see README). */
  linkedWorkspaces: number;
  requiredForNewWorkspaces: boolean;
  accounts: OperatorAccountItem[];
  next: string | null;
}
