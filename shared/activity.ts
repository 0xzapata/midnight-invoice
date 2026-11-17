/**
 * Workspace activity log contract (GET /api/v1/activity), shared by the
 * Worker and the browser app. Rows are written by server/services/activity.ts
 * (`recordActivity` / `activityWrite`); see AGENT_API.md "Activity log".
 */
import type { Scope } from './api';
import type { InvoiceStatus } from './invoice-status';

/**
 * Stable action codes. New features add their own `<entity>.<verb>` codes
 * (e.g. `template.created`); clients must render unknown codes generically.
 */
export const ACTIVITY_ACTIONS = [
  'invoice.created',
  'invoice.updated',
  'invoice.status_changed',
  'invoice.deleted',
  'invoice.pdf_downloaded',
  'client.created',
  'client.updated',
  'client.archived',
  'client.unarchived',
  'client.deleted',
  'template.created',
  'template.updated',
  'template.archived',
  'template.unarchived',
  'template.deleted',
  'settings.updated',
  'agent.approved',
  'agent.denied',
  'agent.registered',
  'agent.revoked',
  'agent.revoked_key_used',
  'sync.bulk_upload',
  // OAuth (MCP clients)
  'agent.oauth_authorized',
  'agent.oauth_denied',
  'agent.oauth_connected',
  'agent.oauth_scopes_changed',
  'agent.oauth_reuse_detected',
  // Recurring invoices
  'recurring.created',
  'recurring.updated',
  'recurring.paused',
  'recurring.resumed',
  'recurring.ended',
  'recurring.deleted',
  'recurring.run_failed',
] as const;

export type KnownActivityAction = (typeof ACTIVITY_ACTIONS)[number];
/** A known code or a future feature's `<entity>.<verb>` code. */
export type ActivityAction = KnownActivityAction | `${string}.${string}`;

/** Filter groups offered by the app (prefixes for `action=`). */
export const ACTIVITY_ACTION_GROUPS = {
  invoices: { label: 'Invoices', prefixes: ['invoice.'] },
  payments: { label: 'Status changes', prefixes: ['invoice.status_changed'] },
  downloads: { label: 'PDF downloads', prefixes: ['invoice.pdf_downloaded'] },
  clients: { label: 'Clients', prefixes: ['client.'] },
  templates: { label: 'Templates', prefixes: ['template.'] },
  recurring: { label: 'Recurring invoices', prefixes: ['recurring.'] },
  access: { label: 'Agent access', prefixes: ['agent.'] },
  settings: { label: 'Settings', prefixes: ['settings.'] },
  sync: { label: 'Sync uploads', prefixes: ['sync.'] },
} as const;
export type ActivityActionGroup = keyof typeof ACTIVITY_ACTION_GROUPS;

/** Kinds of things an entry can be about. Open for new features. */
export type ActivityEntityType = 'invoice' | 'client' | 'template' | 'recurring' | 'settings' | 'agent' | 'agent_registration' | (string & {});

export type ActivityActor =
  | { type: 'user' }
  | { type: 'agent'; agentId: string; agentName: string }
  | { type: 'system' };

/**
 * Compact summary of what changed. Never a document body, never a secret:
 * field *names*, a status transition, scopes, counts.
 */
export interface ActivityChanges {
  /** Names of the fields that changed (e.g. `["dueDate", "lineItems"]`). */
  fields?: string[];
  /** Status transition; `from` is null on create. */
  status?: { from: InvoiceStatus | null; to: InvoiceStatus };
  /** Scopes requested / granted (agent.approved, agent.registered, agent.oauth_*). */
  scopes?: Scope[];
  /** OAuth consent: what the client asked for (when `scopes` is narrower, the user unticked some). */
  requestedScopes?: Scope[];
  /** `agent.oauth_scopes_changed`: the agent's permissions before the re-authorisation. */
  previousScopes?: Scope[];
  /** `agent.oauth_reuse_detected`: which single-use credential was presented twice. */
  credential?: 'refresh_token' | 'authorization_code';
  /** Per-collection counts of a summarised bulk upload (`sync.bulk_upload`). */
  counts?: Record<string, number>;
  /** `agent.registered`: the registration whose `agent.approved` / entry belongs to this agent. */
  registrationId?: string;
  /** PDF theme (`invoice.pdf_downloaded`). */
  theme?: string;
  /** `invoice.created` from a template: which one (name snapshot taken at the time). */
  template?: { id: string; label: string | null };
  /** `invoice.created` by a recurring schedule: which one (name snapshot). */
  recurring?: { id: string; label: string | null };
  /** Recurring: the period (run date, YYYY-MM-DD) an entry is about. */
  period?: string;
  /** `recurring.run_failed`: stable reason code (template_deleted, client_deleted, validation_failed, …). */
  reason?: string;
  /** `invoice.created` by a recurring schedule: older missed periods skipped by the catch-up policy. */
  skipped?: number;
  /** How a recurring run was started: by the schedule or by "run now". */
  trigger?: 'schedule' | 'run_now';
}

export type ActivitySource = 'rest' | 'mcp' | 'system';

export interface ActivityEntry {
  /** Time-ordered id (`act_…`); newest first = descending id. */
  id: string;
  time: string;
  actor: ActivityActor;
  action: ActivityAction;
  /** What the entry is about, with a label snapshot taken at the time (invoice number, client name…). */
  entity: { type: ActivityEntityType; id: string; label: string | null } | null;
  changes: ActivityChanges | null;
  source: ActivitySource;
  /** MCP tool name when `source` is `mcp`. */
  tool: string | null;
  requestId: string | null;
}

/** GET /api/v1/activity and GET /api/v1/agents/:id/activity (newest first). */
export interface ListActivityResponse {
  activity: ActivityEntry[];
  hasMore: boolean;
  /** Present when `hasMore`: pass `before` to get the next (older) page. */
  next: { before: string } | null;
}

export const ACTIVITY_PAGE = { default: 50, max: 200 } as const;

/**
 * Retention defaults: entries older than `days` or beyond the newest `maxRows`
 * per workspace are pruned by the daily `activity.retention` job. Operators
 * change them with the `activity.retentionDays` / `activity.maxRowsPerWorkspace`
 * runtime settings.
 */
export const ACTIVITY_RETENTION = { days: 365, maxRows: 10_000 } as const;
