/**
 * Midnight Invoice HTTP API contract (v1), shared by the Worker and the
 * browser app. See AGENT_API.md and GET /api/v1/openapi.json.
 */
import type { Actor, Invoice } from './types/invoice';
import type { DefaultSettings } from './settings';

export const API_BASE_PATH = '/api/v1';
export const MCP_PATH = '/api/mcp';

/** Permissions an agent can be granted. A workspace token implicitly has all of them. */
export const SCOPES = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  'invoices:read': 'List and read invoices, next invoice number, download PDFs',
  'invoices:write': 'Create and update invoices',
  'invoices:delete': 'Delete invoices',
  'settings:read': 'Read the default sender settings',
};

/** Credential prefixes (all secrets are 256-bit random, base64url). */
export const TOKEN_PREFIX = {
  workspace: 'mi_ws_',
  deviceCode: 'mi_dc_',
  agentKey: 'mi_agent_',
} as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_json'
  | 'validation_failed'
  | 'invalid_scope'
  | 'unauthorized'
  | 'forbidden'
  | 'insufficient_scope'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'precondition_failed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'internal_error'
  // Device-flow errors (POST /agents/token), named as in RFC 8628 / RFC 6749
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  // Set by the site operator (operator console)
  | 'maintenance'
  | 'workspace_suspended'
  | 'registration_closed';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  createdAt: string;
}

/** POST /api/v1/workspaces → 201 */
export interface CreateWorkspaceResponse {
  workspace: Workspace;
  /** Workspace token (`mi_ws_…`). Shown once; only its SHA-256 hash is stored. */
  token: string;
}

/** GET /api/v1/workspace */
export interface GetWorkspaceResponse {
  workspace: Workspace;
}

// ---------------------------------------------------------------------------
// Agents (device-authorization flow)
// ---------------------------------------------------------------------------

/** POST /api/v1/agents/register request */
export interface RegisterAgentRequest {
  name: string;
  description?: string;
  scopes: Scope[];
}

/** POST /api/v1/agents/register → 201 */
export interface RegisterAgentResponse {
  registration_id: string;
  /** Secret the agent polls with (`mi_dc_…`). */
  device_code: string;
  /** Short code the user confirms, e.g. "WXYZ-2345". */
  user_code: string;
  verification_url: string;
  verification_url_complete: string;
  expires_in: number;
  interval: number;
}

/** GET /api/v1/agents/registrations/:user_code */
export interface AgentRegistrationPreview {
  registration: {
    id: string;
    userCode: string;
    name: string;
    description: string | null;
    requestedScopes: Scope[];
    createdAt: string;
    expiresAt: string;
  };
}

/** POST /api/v1/agents/registrations/:user_code/approve request (optional body) */
export interface ApproveAgentRequest {
  /** Subset of the requested scopes. Defaults to all requested scopes. */
  scopes?: Scope[];
}

/** POST …/approve → 200 */
export interface ApproveAgentResponse {
  registration: { id: string; status: 'approved'; scopes: Scope[] };
}

/** POST …/deny → 200 */
export interface DenyAgentResponse {
  registration: { id: string; status: 'denied' };
}

/** POST /api/v1/agents/token request */
export interface AgentTokenRequest {
  device_code: string;
}

/** POST /api/v1/agents/token → 200 (exactly once per device_code) */
export interface AgentTokenResponse {
  /** Agent API key (`mi_agent_…`). Returned exactly once. */
  api_key: string;
  token_type: 'Bearer';
  agent: {
    id: string;
    name: string;
    scopes: Scope[];
    workspace_id: string;
  };
}

/** Item of GET /api/v1/agents */
export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ListAgentsResponse {
  agents: AgentSummary[];
}

/** GET /api/v1/agents/me */
export interface AgentMeResponse {
  agent: {
    id: string;
    name: string;
    description: string | null;
    scopes: Scope[];
    workspace_id: string;
    createdAt: string;
  };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** An invoice as returned by the API: the app's Invoice plus server metadata and totals. */
export interface ApiInvoice extends Invoice {
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  createdBy: Actor;
  updatedBy: Actor;
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** GET /api/v1/invoices */
export interface ListInvoicesResponse {
  invoices: ApiInvoice[];
  /**
   * Server time at which this listing was taken. When `hasMore` is false, pass
   * it as `updated_since` on the next sync to receive every later change.
   */
  syncedAt: string;
  hasMore: boolean;
  /** Present when `hasMore`: query parameters for the next page. */
  next: { updated_since: string; after_id: string } | null;
}

export interface InvoiceResponse {
  invoice: ApiInvoice;
}

/** GET /api/v1/invoices/next-number */
export interface NextInvoiceNumberResponse {
  invoiceNumber: string;
}

/**
 * Body of POST /api/v1/invoices and PUT /api/v1/invoices/:id. Every field the
 * Invoice has, all optional except `toName` and `lineItems`; missing sender
 * fields, currency, tax rate and payment details come from workspace settings,
 * `issueDate` defaults to today (UTC), line-item ids are generated, and a
 * missing `invoiceNumber` is allocated atomically (INV-0001, INV-0002, …).
 * Server-managed fields (revision, updatedAt, totals, createdBy…) are ignored.
 */
export interface InvoiceInput {
  invoiceNumber?: string;
  invoiceName?: string;
  issueDate?: string;
  dueDate?: string;
  fromName?: string;
  fromAddress?: string;
  fromEmail?: string;
  toName: string;
  toAddress?: string;
  toEmail?: string;
  lineItems: { id?: string; description: string; quantity: number; price: number }[];
  taxRate?: number;
  notes?: string;
  paymentDetails?: string;
  currency?: string;
  /** PUT only: preserved when the PUT creates the invoice (browser sync). */
  createdAt?: string;
}

/** Body of PATCH /api/v1/invoices/:id — any subset of fields; lineItems replaces the whole list. */
export type InvoicePatch = Partial<Omit<InvoiceInput, 'createdAt'>>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  settings: DefaultSettings;
  /** Null until settings are first saved (defaults are returned). */
  updatedAt: string | null;
}

export type PutSettingsRequest = DefaultSettings;

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok';
  time: string;
}
