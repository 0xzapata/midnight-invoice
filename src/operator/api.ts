/**
 * Client for the private operator API (/api/operator/*). Same origin only;
 * authenticated by the HttpOnly session cookie (never readable here) plus the
 * CSRF token from GET /session on state-changing requests.
 */
import {
  OPERATOR_CSRF_HEADER,
  type AgentsResponse,
  type AuditResponse,
  type DeploymentsResponse,
  type EncryptionStatusResponse,
  type OperatorStatusResponse,
  type OverviewResponse,
  type RecoveryKeyResponse,
  type SecurityResponse,
  type SessionResponse,
  type SettingsResponse,
  type SetupStateResponse,
  type TelemetryResponse,
  type WorkspacesResponse,
} from '../../shared/operator';
import type { OperatorAccountsResponse } from '../../shared/accounts';

const BASE = '/api/operator';

export class OperatorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OperatorApiError';
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[OPERATOR_CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OperatorApiError(0, 'network_error', 'The server could not be reached.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new OperatorApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  const data = json as T;
  if (data && typeof data === 'object' && 'csrfToken' in data && typeof (data as { csrfToken: unknown }).csrfToken === 'string') {
    setCsrfToken((data as { csrfToken: string }).csrfToken);
  }
  return data;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const operatorApi = {
  status: () => request<OperatorStatusResponse>('GET', '/status'),
  session: () => request<SessionResponse>('GET', '/session'),
  bootstrapLogin: (password: string) => request<SessionResponse>('POST', '/bootstrap/login', { password }),
  startLogin: () => request<{ authorizationUrl: string }>('POST', '/auth/login'),
  logout: () => request<void>('POST', '/logout'),
  recover: (recoveryKey: string) => request<{ recovered: boolean }>('POST', '/recover', { recoveryKey }),

  setup: () => request<SetupStateResponse>('GET', '/setup'),
  createMasterKey: (input: { mode: 'generate' } | { mode: 'passphrase'; passphrase: string }) =>
    request<RecoveryKeyResponse>('POST', '/setup/encryption', input),
  confirmMasterKey: () => request<{ step: string }>('POST', '/setup/encryption/confirm', { saved: true }),
  saveWorkos: (apiKey: string, clientId: string) => request<{ step: string }>('POST', '/setup/workos', { apiKey, clientId }),
  startIdentity: (loginHint?: string) => request<{ authorizationUrl: string }>('POST', '/setup/identity', loginHint ? { loginHint } : {}),

  overview: () => request<OverviewResponse>('GET', '/overview'),
  telemetry: (range: string) => request<TelemetryResponse>('GET', `/telemetry${q({ range })}`),
  workspaces: (p: { q?: string; status?: string; cursor?: string }) => request<WorkspacesResponse>('GET', `/workspaces${q(p)}`),
  suspend: (id: string, reason?: string) => request<unknown>('POST', `/workspaces/${encodeURIComponent(id)}/suspend`, reason ? { reason } : {}),
  unsuspend: (id: string) => request<unknown>('POST', `/workspaces/${encodeURIComponent(id)}/unsuspend`),
  deleteWorkspace: (id: string, confirm: string) => request<void>('DELETE', `/workspaces/${encodeURIComponent(id)}`, { confirm }),
  agents: (p: { q?: string; status?: string; cursor?: string }) => request<AgentsResponse>('GET', `/agents${q(p)}`),
  revokeAgent: (id: string) => request<{ result: string }>('POST', `/agents/${encodeURIComponent(id)}/revoke`),
  accounts: (p: { q?: string; status?: string; cursor?: string }) => request<OperatorAccountsResponse>('GET', `/accounts${q(p)}`),
  disableAccount: (id: string, reason?: string) => request<unknown>('POST', `/accounts/${encodeURIComponent(id)}/disable`, reason ? { reason } : {}),
  enableAccount: (id: string) => request<unknown>('POST', `/accounts/${encodeURIComponent(id)}/enable`),
  settings: () => request<SettingsResponse>('GET', '/settings'),
  setSetting: (key: string, value: unknown) => request<{ ok: boolean }>('PUT', `/settings/${encodeURIComponent(key)}`, { value }),
  resetSetting: (key: string) => request<{ ok: boolean }>('DELETE', `/settings/${encodeURIComponent(key)}`),
  reload: () => request<{ configVersion: number; propagationSeconds: number }>('POST', '/runtime/reload'),
  deployments: () => request<DeploymentsResponse>('GET', '/deployments'),
  redeploy: () => request<{ dispatched: boolean; ref: string }>('POST', '/deployments/redeploy'),
  audit: (p: { action?: string; actor?: string; cursor?: string }) => request<AuditResponse>('GET', `/audit${q(p)}`),
  security: () => request<SecurityResponse>('GET', '/security'),
  addOperator: (email: string) => request<{ id: string }>('POST', '/operators', { email }),
  removeOperator: (id: string) => request<void>('DELETE', `/operators/${encodeURIComponent(id)}`),
  revokeSession: (id: string) => request<void>('DELETE', `/sessions/${encodeURIComponent(id)}`),
  rotateDek: () => request<{ dekVersion: number; reencrypted: number }>('POST', '/security/rotate-dek'),
  rotateMaster: (input: { mode: 'generate' } | { mode: 'passphrase'; passphrase: string }) =>
    request<RecoveryKeyResponse>('POST', '/security/rotate-master', input),
  prepareRewrap: (newInitialPassword: string) => request<{ pending: boolean }>('POST', '/security/rewrap', { newInitialPassword }),
  cancelPending: () => request<{ ok: boolean }>('POST', '/security/cancel-pending'),
  setHardened: (enabled: boolean) => request<EncryptionStatusResponse>('POST', '/security/hardened', { enabled }),
};

/** Full-page navigation to AuthKit (indirected so tests can observe it). */
export const browserNav = {
  assign: (url: string) => window.location.assign(url),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
