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
  'settings.updated',
  'agent.approved',
  'agent.denied',
  'agent.registered',
  'agent.revoked',
  'agent.revoked_key_used',
  'sync.bulk_upload',
  // Optional user accounts (server/accounts/activity.ts); entity = the device where relevant.
  'account.workspace_created',
  'account.workspace_claimed',
  'account.device_signed_in',
  'account.device_revoked',
  'account.signed_out_other_devices',
  'account.signed_out_everywhere',
  'account.recovery_key_created',
  'account.recovery_key_rotated',
  'account.recovery_key_disabled',
  'account.deleted',
  'account.disabled',
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
  access: { label: 'Agent access', prefixes: ['agent.'] },
  settings: { label: 'Settings', prefixes: ['settings.'] },
  sync: { label: 'Sync uploads', prefixes: ['sync.'] },
  account: { label: 'Account & devices', prefixes: ['account.'] },
} as const;
export type ActivityActionGroup = keyof typeof ACTIVITY_ACTION_GROUPS;

/** Kinds of things an entry can be about. Open for new features. */
export type ActivityEntityType = 'invoice' | 'client' | 'settings' | 'agent' | 'agent_registration' | (string & {});

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
  /** Scopes requested / granted (agent.approved, agent.registered). */
  scopes?: Scope[];
  /** Per-collection counts of a summarised bulk upload (`sync.bulk_upload`). */
  counts?: Record<string, number>;
  /** `agent.registered`: the registration whose `agent.approved` / entry belongs to this agent. */
  registrationId?: string;
  /** PDF theme (`invoice.pdf_downloaded`). */
  theme?: string;
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
