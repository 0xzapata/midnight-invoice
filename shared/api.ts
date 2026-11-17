/**
 * Midnight Invoice HTTP API contract (v1), shared by the Worker and the
 * browser app. See AGENT_API.md and GET /api/v1/openapi.json.
 */
import type { Actor, Invoice } from './types/invoice';
import type { DefaultSettings } from './settings';
import type { Client } from './types/client';
import type { InvoiceStatus, InvoiceSummary } from './invoice-status';
export type { ActivityAction, ActivityActor, ActivityChanges, ActivityEntry, ActivityEntityType, ActivitySource, ListActivityResponse } from './activity';

export const API_BASE_PATH = '/api/v1';
export const MCP_PATH = '/api/mcp';

/** Permissions an agent can be granted. A workspace token implicitly has all of them. */
export const SCOPES = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read', 'clients:read', 'clients:write', 'activity:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  'invoices:read': 'List and read invoices, next invoice number, download PDFs',
  'invoices:write': 'Create and update invoices, including status changes (mark sent, paid or void)',
  'invoices:delete': 'Delete invoices',
  'settings:read': 'Read the default sender settings',
  'clients:read': 'List, search and read saved clients; bill invoices to a saved client (clientId)',
  'clients:write': 'Create, update, archive and delete saved clients (never changes existing invoices)',
  'activity:read': "Read this agent's own entries in the workspace activity log (never other agents' or the user's)",
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
  // Invoice status change not allowed from the current status (HTTP 409)
  | 'invalid_status_transition'
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
  /** Stored status; invoices saved before statuses existed read as `draft`. */
  status: InvoiceStatus;
  sentAt: string | null;
  paidAt: string | null;
  /** Derived: status `sent` and dueDate before today (UTC). Never stored. */
  isOverdue: boolean;
  /** Derived: whole days past dueDate (0 unless overdue). */
  daysOverdue: number;
}

/** `status` filter values of GET /invoices: the stored statuses plus the virtual `overdue`. */
export type InvoiceStatusFilter = InvoiceStatus | 'overdue';

/** GET /api/v1/invoices/summary (amounts grouped by currency, never summed across currencies). */
export type InvoiceSummaryResponse = InvoiceSummary;

/** POST /api/v1/invoices/:id/mark-paid (optional body) */
export interface MarkPaidRequest {
  /** Payment date, YYYY-MM-DD. Defaults to today (UTC). */
  paidAt?: string;
}

/** POST /api/v1/invoices/:id/mark-sent (optional body) */
export interface MarkSentRequest {
  /** Date sent, YYYY-MM-DD. Defaults to the existing sentAt, else today (UTC). */
  sentAt?: string;
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
 * Invoice has, all optional except `lineItems` and `toName` (which may be
 * omitted when `clientId` is given: the client fills it); missing sender
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
  toName?: string;
  toAddress?: string;
  toEmail?: string;
  lineItems: { id?: string; description: string; quantity: number; price: number }[];
  taxRate?: number;
  notes?: string;
  paymentDetails?: string;
  currency?: string;
  /**
   * Status (default `draft` on create; omitted on PUT/PATCH = unchanged).
   * PATCH enforces the transition rules; PUT (full replace, used by sync) accepts any status.
   * sentAt/paidAt (YYYY-MM-DD) default to today when the status needs them.
   */
  status?: InvoiceStatus;
  sentAt?: string | null;
  paidAt?: string | null;
  /** PUT only: preserved when the PUT creates the invoice (browser sync). */
  createdAt?: string;
  /**
   * Bill to a saved client (requires `clients:read` when it is set or changed).
   * Omitted to-fields are filled from the client; see AGENT_API.md "Billing a
   * saved client" for the defaults order. `null` unlinks (PATCH).
   */
  clientId?: string | null;
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

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** A saved client as returned by the API: the app's Client plus server metadata. */
export interface ApiClientRecord extends Client {
  defaultCurrency: string | null;
  defaultTaxRate: number | null;
  paymentTermsDays: number | null;
  notes: string;
  archivedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  createdBy: Actor;
  updatedBy: Actor;
  /** Live invoices that reference this client. Only present for credentials with `invoices:read`. */
  invoiceCount?: number;
}

/** GET /api/v1/clients (same paging and sync contract as GET /invoices). */
export interface ListClientsResponse {
  clients: ApiClientRecord[];
  syncedAt: string;
  hasMore: boolean;
  next: { updated_since: string; after_id: string } | null;
}

export interface ClientResponse {
  client: ApiClientRecord;
}

/** Body of POST /api/v1/clients and PUT /api/v1/clients/:id. Only `name` is required. */
export interface ClientInput {
  name: string;
  email?: string;
  address?: string;
  defaultCurrency?: string | null;
  defaultTaxRate?: number | null;
  paymentTermsDays?: number | null;
  notes?: string;
  /** ISO timestamp to archive, null to unarchive. */
  archivedAt?: string | null;
  /** PUT only: preserved when the PUT creates the client (browser sync). */
  createdAt?: string;
}

/** Body of PATCH /api/v1/clients/:id — any subset of fields. */
export type ClientPatch = Partial<Omit<ClientInput, 'createdAt'>>;
