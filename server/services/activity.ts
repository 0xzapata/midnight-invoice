/**
 * Workspace activity log: the one API every use-case calls to leave a trace
 * (contract: shared/activity.ts, AGENT_API.md "Activity log").
 *
 * Two ways to record, both never fail the caller's request:
 *
 * - `activityWrite(ctx, input)` → a `WriteAttachment` to hand to a repository
 *   write. The entry is committed in the SAME D1 batch as the write and only
 *   if the write changed a row (`changes() > 0`). Used by every invoice,
 *   client, settings and agent-access write. If the batch fails, the write is
 *   retried alone and the failure is logged (deps.logError).
 * - `recordActivity(ctx, input)` → inserts right after the fact, scheduled
 *   with `waitUntil` (the response does not wait for it); errors are caught
 *   and logged. Used for reads worth auditing (PDF downloads) and for
 *   rejected requests (a revoked key), where there is no write to attach to.
 *
 * Entries never contain document bodies or secrets: only field names, a
 * status transition, scopes, counts and a short label (invoice number,
 * client name, agent name).
 */
import { z } from 'zod';
import {
  ACTIVITY_PAGE,
  type ActivityAction,
  type ActivityActor,
  type ActivityChanges,
  type ActivityEntityType,
  type ActivityEntry,
  type ActivitySource,
  type ListActivityResponse,
} from '../../shared/activity';
import { statusOf, type InvoiceStatus } from '../../shared/invoice-status';
import { actorOf, requireScope, type Principal } from '../auth';
import type { AppDeps } from '../deps';
import { createActivityRepository, type ActivityRepository, type ActivityRow, type DedupeMode } from '../db/activityRepository';
import type { WriteAttachment } from '../db/repository';
import { errors } from '../errors';
import { isoDateTime, zodDetails } from '../schemas';

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

/** Where a request came from; built once per request by the REST layer or the MCP endpoint. */
export interface ActivityRequest {
  source: ActivitySource;
  /** MCP tool being called (set by server/mcp.ts per tool call). */
  tool?: string;
  requestId: string | null;
  /**
   * Bulk-upload batch id from `X-Midnight-Sync: bulk-upload; batch=<uuid>`
   * (only honoured for the workspace token): creates in that batch are
   * summarised in one `sync.bulk_upload` entry instead of one entry each.
   */
  bulkUploadId?: string;
  /** Keeps background work alive after the response (ExecutionContext.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Reports a failure the transport answers with 200 (MCP tool errors) to request telemetry (`setTelemetryDetail`). */
  telemetry?: (detail: { status: number; errorCode: string }) => void;
}

/** What recording needs. `ServiceContext` (services/invoices.ts) satisfies it. */
export interface ActivityContext {
  deps: AppDeps;
  principal?: Principal;
  activity?: ActivityRequest;
}

export interface ActivityInput {
  action: ActivityAction;
  entity?: { type: ActivityEntityType; id: string; label?: string | null } | null;
  changes?: ActivityChanges | null;
  /** Defaults to the request's principal. */
  actor?: ActivityActor;
  /** Defaults to the principal's workspace. */
  workspaceId?: string;
  /** Collapse repeats: one row per key (`ignore` keeps the first, `count` bumps `changes.counts[counter]`). */
  dedupe?: { key: string } & DedupeMode;
}

const BULK_HEADER_RE = /^bulk-upload;\s*batch=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Parses the browser's `X-Midnight-Sync` header; undefined unless it is a well-formed bulk-upload marker. */
export function parseBulkUploadHeader(value: string | undefined | null): string | undefined {
  const match = value ? BULK_HEADER_RE.exec(value.trim()) : null;
  return match ? match[1].toLowerCase() : undefined;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

let lastMs = 0;
let seq = 0;

/** `act_` + 9 base36 chars of epoch ms + 4 of a per-isolate sequence + 6 random: sorts by time, then creation order. */
export function newActivityId(nowMs: number): string {
  const ms = Math.max(nowMs, lastMs);
  seq = ms === lastMs ? seq + 1 : 0;
  lastMs = ms;
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
  return `act_${ms.toString(36).padStart(9, '0')}${seq.toString(36).padStart(4, '0')}${random}`;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const repos = new WeakMap<D1Database, ActivityRepository>();
function activityRepo(deps: AppDeps): ActivityRepository {
  let repo = repos.get(deps.db);
  if (!repo) {
    repo = createActivityRepository(deps.db);
    repos.set(deps.db, repo);
  }
  return repo;
}

const LABEL_MAX = 200;

function rowOf(ctx: ActivityContext, input: ActivityInput) {
  const actor = input.actor ?? (ctx.principal ? (actorOf(ctx.principal) as ActivityActor) : ({ type: 'system' } as const));
  const workspaceId = input.workspaceId ?? ctx.principal?.workspaceId;
  if (!workspaceId) throw new Error('recordActivity needs a workspace');
  const now = ctx.deps.clock();
  const req = ctx.activity;
  const changes = input.changes && Object.keys(input.changes).length > 0 ? JSON.stringify(input.changes) : null;
  return {
    workspace_id: workspaceId,
    id: newActivityId(now.getTime()),
    time: now.toISOString(),
    actor_type: actor.type,
    agent_id: actor.type === 'agent' ? actor.agentId : null,
    agent_name: actor.type === 'agent' ? actor.agentName : null,
    action: input.action,
    entity_type: input.entity?.type ?? null,
    entity_id: input.entity?.id ?? null,
    entity_label: input.entity?.label ? input.entity.label.slice(0, LABEL_MAX) : null,
    changes,
    source: req?.source ?? 'system',
    tool: req?.source === 'mcp' ? (req.tool ?? null) : null,
    request_id: req?.requestId ?? null,
    dedupe_key: input.dedupe?.key ?? null,
  };
}

function background(ctx: ActivityContext, promise: Promise<unknown>): void {
  if (ctx.activity?.waitUntil) ctx.activity.waitUntil(promise);
  else void promise;
}

const logFailure = (ctx: ActivityContext) => (error: unknown) => ctx.deps.logError?.('Activity entry not recorded', error);

/**
 * Atomic recording: returns the attachment for a repository write
 * (`repo.updateInvoice(args, activityWrite(ctx, input))`). The entry is
 * committed with the write, only if the write changed a row.
 */
export function activityWrite(
  ctx: ActivityContext,
  input: ActivityInput,
  opts: { labelSql?: { sql: string; params: unknown[] }; when?: { sql: string; params: unknown[] } } = {},
): WriteAttachment {
  const row = rowOf(ctx, input);
  return {
    statements: [
      activityRepo(ctx.deps).insertStatement(row, {
        when: opts.when ?? { sql: 'changes() > 0', params: [] },
        labelSql: input.entity ? opts.labelSql : undefined,
        dedupe: input.dedupe,
      }),
    ],
    onError: logFailure(ctx),
  };
}

/** `activityWrite` when there is something to record, else no attachment (no-op writes are not logged). */
export function activityWriteIf(ctx: ActivityContext, input: ActivityInput | null, opts?: Parameters<typeof activityWrite>[2]) {
  return input ? activityWrite(ctx, input, opts) : undefined;
}

/**
 * Records an entry right after the fact (no write to attach to). Scheduled
 * with waitUntil; the returned promise never rejects (failures are logged),
 * so callers may also await it.
 */
export function recordActivity(ctx: ActivityContext, input: ActivityInput): Promise<void> {
  let promise: Promise<void>;
  try {
    const row = rowOf(ctx, input);
    promise = activityRepo(ctx.deps)
      .insertStatement(row, { dedupe: input.dedupe })
      .run()
      .then(() => undefined, logFailure(ctx));
  } catch (error) {
    logFailure(ctx)(error);
    promise = Promise.resolve();
  }
  background(ctx, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Change summaries
// ---------------------------------------------------------------------------

const blank = (v: unknown) => v === undefined || v === null || v === '';

/** Names of top-level fields whose values differ (undefined, null and "" count as equal). */
export function changedFields(before: object | null | undefined, after: object, ignore: readonly string[] = ['version']): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const x = a[key];
    const y = b[key];
    if (blank(x) && blank(y)) continue;
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(key);
  }
  return out.sort();
}

const STATUS_FIELDS = ['status', 'sentAt', 'paidAt'];

/** If a user's write belongs to a browser bulk upload, the summary entry that counts it. */
function bulkUploadInput(ctx: ActivityContext, counter: 'invoices' | 'clients' | 'templates'): ActivityInput | null {
  const batch = ctx.activity?.bulkUploadId;
  if (!batch || ctx.principal?.type !== 'user') return null;
  return {
    action: 'sync.bulk_upload',
    changes: { counts: { [counter]: 1 } },
    dedupe: { key: `bulk-upload:${batch}`, mode: 'count', counter },
  };
}

type InvoiceLike = { invoiceNumber: string; status?: InvoiceStatus | null; sentAt?: string | null; paidAt?: string | null };

/** Entry for a new invoice (or its share of a bulk upload). The label is filled in SQL when the number is allocated. */
export function invoiceCreatedInput(ctx: ActivityContext, id: string, data: InvoiceLike): ActivityInput {
  const bulk = bulkUploadInput(ctx, 'invoices');
  if (bulk) return bulk;
  const status = statusOf(data);
  return {
    action: 'invoice.created',
    entity: { type: 'invoice', id, label: data.invoiceNumber || null },
    changes: status === 'draft' ? null : { status: { from: null, to: status } },
  };
}

/**
 * Entry for a change to an existing invoice, or null when nothing changed
 * (routine sync PUTs of unchanged content are not logged). A status change
 * is `invoice.status_changed` (other changed fields listed too).
 */
export function invoiceChangedInput(id: string, before: InvoiceLike & object, after: InvoiceLike & object): ActivityInput | null {
  const from = statusOf(before);
  const to = statusOf(after);
  const fields = changedFields(before, after);
  const statusChanged = from !== to;
  const other = statusChanged ? fields.filter((f) => !STATUS_FIELDS.includes(f)) : fields;
  if (!statusChanged && other.length === 0) return null;
  return {
    action: statusChanged ? 'invoice.status_changed' : 'invoice.updated',
    entity: { type: 'invoice', id, label: after.invoiceNumber || null },
    changes: statusChanged ? { status: { from, to }, ...(other.length ? { fields: other } : {}) } : { fields: other },
  };
}

export function clientCreatedInput(ctx: ActivityContext, id: string, name: string): ActivityInput {
  return bulkUploadInput(ctx, 'clients') ?? { action: 'client.created', entity: { type: 'client', id, label: name } };
}

/** client.updated / client.archived / client.unarchived, or null when nothing changed. */
export function clientChangedInput(id: string, before: { name: string; archivedAt?: string | null }, after: { name: string; archivedAt?: string | null }): ActivityInput | null {
  const fields = changedFields(before, after);
  if (fields.length === 0) return null;
  const entity = { type: 'client', id, label: after.name };
  if (fields.length === 1 && fields[0] === 'archivedAt') {
    return { action: after.archivedAt ? 'client.archived' : 'client.unarchived', entity };
  }
  return { action: 'client.updated', entity, changes: { fields } };
}

export function templateCreatedInput(ctx: ActivityContext, id: string, name: string): ActivityInput {
  return bulkUploadInput(ctx, 'templates') ?? { action: 'template.created', entity: { type: 'template', id, label: name } };
}

/**
 * template.updated / template.archived / template.unarchived, or null when
 * nothing changed. Only field *names* are recorded (never line text or notes).
 */
export function templateChangedInput(id: string, before: { name: string; archivedAt?: string | null }, after: { name: string; archivedAt?: string | null }): ActivityInput | null {
  const fields = changedFields(before, after);
  if (fields.length === 0) return null;
  const entity = { type: 'template', id, label: after.name };
  if (fields.length === 1 && fields[0] === 'archivedAt') {
    return { action: after.archivedAt ? 'template.archived' : 'template.unarchived', entity };
  }
  return { action: 'template.updated', entity, changes: { fields } };
}

/** SQL label of an entity the write is about to touch (e.g. a deleted invoice's number). */
export const labelOf = {
  invoice: (workspaceId: string, id: string) => ({ sql: 'SELECT invoice_number FROM invoices WHERE workspace_id = ? AND id = ?', params: [workspaceId, id] }),
  client: (workspaceId: string, id: string) => ({ sql: 'SELECT name FROM clients WHERE workspace_id = ? AND id = ?', params: [workspaceId, id] }),
  template: (workspaceId: string, id: string) => ({ sql: 'SELECT name FROM templates WHERE workspace_id = ? AND id = ?', params: [workspaceId, id] }),
  agent: (workspaceId: string, id: string) => ({ sql: 'SELECT name FROM agents WHERE workspace_id = ? AND id = ?', params: [workspaceId, id] }),
};

// ---------------------------------------------------------------------------
// Rejected requests: a revoked agent key
// ---------------------------------------------------------------------------

/**
 * Called when a request with an agent key was rejected (401). If the key
 * belonged to an agent that was revoked, records `agent.revoked_key_used`
 * at most once per agent and hour. Unknown keys are not attributable to a
 * workspace and are not recorded.
 */
export async function noteRejectedAgentKey(ctx: ActivityContext, keyHash: string): Promise<void> {
  try {
    const agent = await activityRepo(ctx.deps).findRevokedAgentByKeyHash(keyHash);
    if (!agent) return;
    const hour = Math.floor(ctx.deps.clock().getTime() / 3_600_000);
    await recordActivity(ctx, {
      workspaceId: agent.workspace_id,
      actor: { type: 'agent', agentId: agent.id, agentName: agent.name },
      action: 'agent.revoked_key_used',
      entity: { type: 'agent', id: agent.id, label: agent.name },
      dedupe: { key: `revoked-key:${agent.id}:${hour}`, mode: 'ignore' },
    });
  } catch (error) {
    ctx.deps.logError?.('Could not check a rejected agent key', error);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const ACTION_RE = /^[a-z][a-z_]*(\.[a-z_]*)?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const listActivityQuerySchema = z.object({
  actor: z
    .string()
    .regex(/^(user|system|agent:[A-Za-z0-9_-]{1,64})$/, 'actor must be user, system or agent:<id>')
    .optional(),
  agent_id: z.string().regex(ID_RE, 'Invalid agent id').optional(),
  action: z
    .string()
    .max(500)
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().regex(ACTION_RE, 'Invalid action code or prefix')).max(20))
    .optional(),
  entity_type: z.string().regex(/^[a-z_]{1,32}$/, 'Invalid entity type').optional(),
  entity_id: z.string().regex(ID_RE, 'Invalid entity id').optional(),
  since: isoDateTime.optional(),
  until: isoDateTime.optional(),
  before: z.string().regex(/^act_[0-9a-z]{19}$/, 'before must be an activity id from next.before').optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE.max).optional(),
});
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

export function parseActivityQuery(raw: unknown): ListActivityQuery {
  const parsed = listActivityQuerySchema.safeParse(raw);
  if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
  return parsed.data;
}

export function toActivityEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    time: row.time,
    actor:
      row.actor_type === 'agent'
        ? { type: 'agent', agentId: row.agent_id ?? '', agentName: row.agent_name ?? '' }
        : row.actor_type === 'system'
          ? { type: 'system' }
          : { type: 'user' },
    action: row.action as ActivityAction,
    entity: row.entity_type && row.entity_id ? { type: row.entity_type, id: row.entity_id, label: row.entity_label } : null,
    changes: row.changes ? (JSON.parse(row.changes) as ActivityChanges) : null,
    source: row.source,
    tool: row.tool,
    requestId: row.request_id,
  };
}

const canonical = (iso: string | undefined) => (iso ? new Date(iso).toISOString() : undefined);

/**
 * GET /activity. The workspace token reads everything. An agent key needs
 * `activity:read` and only ever sees entries it made itself: asking for
 * anything else is 403.
 */
export async function listActivity(ctx: ActivityContext & { principal: Principal }, q: ListActivityQuery, opts: { involvingAgentId?: string } = {}): Promise<ListActivityResponse> {
  const p = ctx.principal;
  let actorAgentId: string | undefined;
  let actorType: 'user' | 'agent' | 'system' | undefined;
  if (q.actor?.startsWith('agent:')) actorAgentId = q.actor.slice('agent:'.length);
  else if (q.actor) actorType = q.actor as 'user' | 'system';
  let involvingAgentId = opts.involvingAgentId ?? q.agent_id;

  if (p.type === 'agent') {
    requireScope(p, 'activity:read');
    const other = (actorType && actorType !== 'agent') || (actorAgentId && actorAgentId !== p.agentId) || (involvingAgentId && involvingAgentId !== p.agentId);
    if (other) throw errors.forbidden('An agent key can only read its own activity');
    actorAgentId = p.agentId;
    involvingAgentId = undefined;
  }

  const limit = q.limit ?? ACTIVITY_PAGE.default;
  const rows = await activityRepo(ctx.deps).list({
    workspaceId: p.workspaceId,
    actorAgentId,
    actorType,
    involvingAgentId,
    actionPrefixes: q.action,
    entityType: q.entity_type,
    entityId: q.entity_id,
    since: canonical(q.since),
    until: canonical(q.until),
    before: q.before,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { activity: page.map(toActivityEntry), hasMore, next: hasMore ? { before: page[page.length - 1].id } : null };
}

/** GET /agents/:id/activity: entries by the agent or about it, including the user's approval of its registration. */
export async function listAgentActivity(ctx: ActivityContext & { principal: Principal }, agentId: string, q: ListActivityQuery): Promise<ListActivityResponse> {
  if (!ID_RE.test(agentId)) throw errors.notFound('Agent not found');
  if (ctx.principal.type === 'agent') {
    if (ctx.principal.agentId !== agentId) throw errors.forbidden('An agent key can only read its own activity');
  } else if (!(await activityRepo(ctx.deps).agentExists(ctx.principal.workspaceId, agentId))) {
    throw errors.notFound('Agent not found');
  }
  return listActivity(ctx, { ...q, agent_id: undefined }, { involvingAgentId: agentId });
}
