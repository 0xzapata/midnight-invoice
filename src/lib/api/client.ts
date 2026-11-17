/**
 * Typed client for the Midnight Invoice API (`/api/v1`, same origin only).
 *
 * The workspace token is a bearer secret: it is only ever sent in the
 * `Authorization` header of same-origin requests to `/api/v1/*`, and never
 * appears in URLs, error messages or logs.
 */
import {
  API_BASE_PATH,
  type AgentRegistrationPreview,
  type ClientInput,
  type ClientResponse,
  type ListClientsResponse,
  type ApiErrorBody,
  type ApproveAgentResponse,
  type CreateWorkspaceResponse,
  type DenyAgentResponse,
  type GetWorkspaceResponse,
  type InvoiceInput,
  type InvoiceResponse,
  type ListAgentsResponse,
  type ListInvoicesResponse,
  type ListInvoiceEmailsResponse,
  type SendInvoiceEmailRequest,
  type SendInvoiceEmailResponse,
  type ListActivityResponse,
  type PutSettingsRequest,
  type Scope,
  type SettingsResponse,
} from '../../../shared/api';
import { ApiError, NetworkError, parseRetryAfter } from './errors';

export interface ApiClientOptions {
  /** Current workspace token, or null when cloud sync is off. */
  getToken: () => string | null;
  /** Called with the rejected token when the stored token gets a 401 (workspace deleted or token invalid). */
  onUnauthorized?: (rejectedToken: string) => void;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** `false` for unauthenticated endpoints; a string to authenticate with that token instead of the stored one. */
  auth?: boolean | string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface ListInvoicesParams {
  updatedSince?: string;
  afterId?: string;
  includeDeleted?: boolean;
  limit?: number;
}

/** Filters of GET /activity (see AGENT_API.md "Activity log"). */
export interface ActivityParams {
  /** `user`, `system` or `agent:<id>` (who did it). */
  actor?: string;
  /** Entries by or about this agent. */
  agentId?: string;
  /** Action codes or prefixes (OR). */
  action?: readonly string[];
  entityType?: string;
  entityId?: string;
  since?: string;
  until?: string;
  before?: string;
  limit?: number;
}

const activityQuery = (p: ActivityParams) => ({
  actor: p.actor,
  agent_id: p.agentId,
  action: p.action?.length ? p.action.join(',') : undefined,
  entity_type: p.entityType,
  entity_id: p.entityId,
  since: p.since,
  until: p.until,
  before: p.before,
  limit: p.limit,
});

export interface WritePreconditions {
  /** Last known revision: the write fails with 412 if the invoice changed meanwhile. */
  ifMatch?: number;
  /** Create only: 412 if the id already exists. */
  ifNoneMatch?: boolean;
  /** Part of a bulk upload (joining a workspace): batch id sent as `X-Midnight-Sync` so the activity log summarises it. */
  bulkUpload?: string;
}

const encode = (segment: string) => encodeURIComponent(segment);

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function createApiClient({ getToken, onUnauthorized, fetchImpl }: ApiClientOptions) {
  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    // Paths are fixed strings from this module; refuse anything that could leave the origin.
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API paths must be absolute paths');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    const url = `${API_BASE_PATH}${path}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    const auth = opts.auth ?? true;
    const usesStoredToken = auth === true;
    const token = typeof auth === 'string' ? auth : auth ? getToken() : null;
    if (auth !== false) {
      if (!token) throw new ApiError(401, 'unauthorized', 'Cloud sync is not enabled in this browser');
      headers.authorization = `Bearer ${token}`;
    }
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    if (isOffline()) throw new NetworkError(true);
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(url, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      // Deliberately drop the original error: it is not useful to users and must never carry request details.
      throw new NetworkError(isOffline());
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text().catch(() => '');
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const errorBody = (json as ApiErrorBody | undefined)?.error;
      const error =
        errorBody && typeof errorBody.code === 'string' && typeof errorBody.message === 'string'
          ? new ApiError(response.status, errorBody.code, errorBody.message, errorBody.details, retryAfterMs)
          : new ApiError(response.status, 'unknown', `Request failed (HTTP ${response.status})`, undefined, retryAfterMs);
      if (response.status === 401 && usesStoredToken && token) onUnauthorized?.(token);
      throw error;
    }
    if (json === undefined) throw new ApiError(response.status, 'unknown', 'The server sent an unexpected response');
    return json as T;
  }

  const preconditionHeaders = (pre: WritePreconditions = {}): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (pre.ifMatch !== undefined) headers['if-match'] = `"${pre.ifMatch}"`;
    if (pre.ifNoneMatch) headers['if-none-match'] = '*';
    if (pre.bulkUpload) headers['x-midnight-sync'] = `bulk-upload; batch=${pre.bulkUpload}`;
    return headers;
  };

  return {
    request,

    // Workspaces
    createWorkspace: () => request<CreateWorkspaceResponse>('POST', '/workspaces', { auth: false }),
    /** With `token`, checks that token (e.g. a pasted recovery key) instead of the stored one. */
    getWorkspace: (token?: string) => request<GetWorkspaceResponse>('GET', '/workspace', { auth: token ?? true }),
    deleteWorkspace: () => request<void>('DELETE', '/workspace'),

    // Invoices
    listInvoices: (p: ListInvoicesParams = {}) =>
      request<ListInvoicesResponse>('GET', '/invoices', {
        query: {
          updated_since: p.updatedSince,
          after_id: p.afterId,
          include_deleted: p.includeDeleted ? 'true' : undefined,
          limit: p.limit,
        },
      }),
    getInvoice: (id: string) => request<InvoiceResponse>('GET', `/invoices/${encode(id)}`),
    putInvoice: (id: string, body: InvoiceInput, pre?: WritePreconditions) =>
      request<InvoiceResponse>('PUT', `/invoices/${encode(id)}`, { body, headers: preconditionHeaders(pre) }),
    deleteInvoice: (id: string, pre?: WritePreconditions) =>
      request<void>('DELETE', `/invoices/${encode(id)}`, { headers: preconditionHeaders(pre) }),

    // Email (server-side feature: needs cloud sync and an uploaded invoice)
    sendInvoiceEmail: (id: string, body: SendInvoiceEmailRequest, idempotencyKey: string) =>
      request<SendInvoiceEmailResponse>('POST', `/invoices/${encode(id)}/send`, { body, headers: { 'idempotency-key': idempotencyKey } }),
    listInvoiceEmails: (id: string) => request<ListInvoiceEmailsResponse>('GET', `/invoices/${encode(id)}/emails`),

    // Clients
    listClients: (p: ListInvoicesParams & { q?: string } = {}) =>
      request<ListClientsResponse>('GET', '/clients', {
        query: {
          q: p.q,
          updated_since: p.updatedSince,
          after_id: p.afterId,
          include_deleted: p.includeDeleted ? 'true' : undefined,
          limit: p.limit,
        },
      }),
    getClient: (id: string) => request<ClientResponse>('GET', `/clients/${encode(id)}`),
    putClient: (id: string, body: ClientInput, pre?: WritePreconditions) =>
      request<ClientResponse>('PUT', `/clients/${encode(id)}`, { body, headers: preconditionHeaders(pre) }),
    deleteClient: (id: string, pre?: WritePreconditions) =>
      request<void>('DELETE', `/clients/${encode(id)}`, { headers: preconditionHeaders(pre) }),

    // Settings
    getSettings: () => request<SettingsResponse>('GET', '/settings'),
    putSettings: (settings: PutSettingsRequest) => request<SettingsResponse>('PUT', '/settings', { body: settings }),

    // Agents
    getRegistration: (userCode: string) => request<AgentRegistrationPreview>('GET', `/agents/registrations/${encode(userCode)}`),
    approveRegistration: (userCode: string, scopes: Scope[]) =>
      request<ApproveAgentResponse>('POST', `/agents/registrations/${encode(userCode)}/approve`, { body: { scopes } }),
    denyRegistration: (userCode: string) => request<DenyAgentResponse>('POST', `/agents/registrations/${encode(userCode)}/deny`),
    listAgents: () => request<ListAgentsResponse>('GET', '/agents'),
    revokeAgent: (id: string) => request<void>('DELETE', `/agents/${encode(id)}`),

    // Activity log
    listActivity: (p: ActivityParams = {}) => request<ListActivityResponse>('GET', '/activity', { query: activityQuery(p) }),
    listAgentActivity: (id: string, p: Omit<ActivityParams, 'agentId'> = {}) =>
      request<ListActivityResponse>('GET', `/agents/${encode(id)}/activity`, { query: activityQuery(p) }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
