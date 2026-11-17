/**
 * Recurring-schedule use-cases shared by the REST routes and the MCP tools
 * (contract: AGENT_API.md "Recurring invoices").
 *
 * Permissions:
 * - `recurring:read` lists and reads schedules; the preview also shows the
 *   template's content, so an agent needs `templates:read` for it.
 * - `recurring:write` changes schedules. A schedule creates invoices on its
 *   own, so creating, changing, resuming or running one as an agent also
 *   needs what creating such an invoice by hand needs: `invoices:write` and
 *   `templates:read`, plus `clients:read` when the schedule names a client.
 *   Pausing and deleting only stop generation and need `recurring:write`.
 * - Automatic emailing (`autoAction: send_email`) is the user's decision
 *   only: an agent can neither choose it nor change, resume or run a schedule
 *   that has it (it may still pause or delete one). Agents can create
 *   schedules that make drafts or mark invoices sent. Rationale: a recurring
 *   email reaches a third party every period without anyone reviewing it;
 *   granting an agent a scope at consent time is not the same as the user
 *   choosing unattended email to a client. (With the email feature, the user
 *   token also carries `invoices:send`.)
 *
 * Configuration changes bump `revision` (the ETag; If-Match like templates);
 * generation does not. Changing the cadence (frequency, start date, time
 * zone) recomputes the next run date from today; other edits keep it.
 */
import type { ApproveRecurringEmailResponse, ListRecurringResponse, RecurringPreviewResponse, RunRecurringNowResponse } from '../../shared/api';
import { describeSchedule, catchUpPlan, localDateIn, nextRunDate, upcomingRunDates, type RecurringError, type RecurringSchedule } from '../../shared/recurring';
import { calculateInvoiceTotals, formatInvoiceNumber } from '../../shared/invoice-totals';
import type { Actor } from '../../shared/types/invoice';
import { actorOf, hasScope, requireScope, requireUser, type Principal } from '../auth';
import { ApiError, errors } from '../errors';
import { activityWrite, activityWriteIf, changedFields } from '../services/activity';
import { clientRepo } from '../services/clients';
import { getInvoice, newInvoiceData, parseOrThrow, toApiInvoice, type RevisionPrecondition, type ServiceContext } from '../services/invoices';
import { templateRepo } from '../services/templates';
import { recurringEmailSender } from './autoActions';
import { createEmailRepository } from '../db/emailRepository';
import { normalizeEmail } from '../../shared/email-template';
import { buildPeriodInvoice, configOf, GenerationError, generatePeriod, recurringRepo } from './generate';
import { emailPeriodInvoice } from './emailSend';
import { reviewInvoice } from '../services/review';
import type { ScheduleRow, StoredScheduleData } from './repository';
import { recurringInputSchema, recurringPatchSchema, runNowSchema, type RecurringInputParsed } from './schemas';

export const CURRENT_SCHEDULE_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The recurring-schedule entity in the activity log. */
const LABEL = (workspaceId: string, id: string) => ({ sql: 'SELECT name FROM recurring_schedules WHERE workspace_id = ? AND id = ?', params: [workspaceId, id] });

export function parseRecurringId(id: string): string {
  if (!UUID_RE.test(id)) throw errors.badRequest('Recurring schedule id must be a UUID', { id });
  return id.toLowerCase();
}

const parseJson = <T>(text: string | null): T | null => (text ? (JSON.parse(text) as T) : null);

export function toApiRecurring(row: ScheduleRow): RecurringSchedule {
  const { version: _v, ...cfg } = configOf(row);
  return {
    id: row.id,
    ...cfg,
    overrides: { notes: cfg.overrides?.notes ?? null, taxRate: cfg.overrides?.taxRate ?? null },
    status: row.status,
    nextRunDate: row.next_run_date,
    lastRunDate: row.last_run_date,
    lastInvoiceId: row.last_invoice_id,
    runCount: row.run_count,
    lastError: parseJson<RecurringError>(row.last_error),
    retryAt: row.retry_at,
    skippedCount: row.skipped_count,
    lastSkipped: parseJson(row.last_skipped),
    summary: describeSchedule(cfg, { nextRunDate: row.next_run_date, status: row.status }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    createdBy: JSON.parse(row.created_by) as Actor,
    updatedBy: JSON.parse(row.updated_by) as Actor,
  };
}

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

/**
 * What creating or running a schedule needs beyond recurring:write: what
 * creating its invoices by hand would need (the client billed is the
 * schedule's, else the template's default client).
 */
async function requireActivation(ctx: ServiceContext, cfg: Pick<StoredScheduleData, 'clientId' | 'templateId'>): Promise<void> {
  const p = ctx.principal;
  requireScope(p, 'invoices:write');
  requireScope(p, 'templates:read');
  if (p.type !== 'agent' || hasScope(p, 'clients:read')) return;
  let clientId = cfg.clientId;
  if (!clientId) {
    const t = await templateRepo(ctx).getTemplate(p.workspaceId, cfg.templateId);
    clientId = t && !t.deleted_at ? ((JSON.parse(t.data) as { clientId?: string | null }).clientId ?? null) : null;
  }
  if (clientId) requireScope(p, 'clients:read');
}

/**
 * Automatic emailing is the user's decision only (see the module comment).
 * Turning it on needs email to be set up on the server, and (whenever the
 * template or client changes) a client whose email address the user entered
 * themselves, so an unattended send can never go to an address an agent wrote.
 */
async function guardAutoEmail(ctx: ServiceContext, next: StoredScheduleData, current?: StoredScheduleData): Promise<void> {
  const p = ctx.principal;
  if (p.type === 'agent' && (next.autoAction === 'send_email' || current?.autoAction === 'send_email')) {
    throw errors.forbidden(
      'Only the user can set up or change a schedule that emails invoices automatically (autoAction "send_email"). Agents can create schedules that make drafts ("draft") or mark invoices sent ("mark_sent"); ask the user to turn on emailing in the app.',
    );
  }
  if (next.autoAction !== 'send_email') return;
  requireScope(p, 'invoices:send');
  const enabling = current?.autoAction !== 'send_email';
  if (enabling) {
    const sender = recurringEmailSender();
    if (!sender) throw errors.validation([{ path: 'autoAction', message: 'Email sending is not available on this server' }], 'Email sending is not available');
    const available = await sender.availability(ctx.deps);
    if (!available.ok) {
      throw new ApiError(503, 'email_not_configured', `Emailing invoices automatically needs email to be set up on this server. ${available.reason}`, { reason: available.reason });
    }
  }
  if (!enabling && next.clientId === current?.clientId && next.templateId === current?.templateId) return;
  const ws = p.workspaceId;
  let clientId = next.clientId;
  if (!clientId) {
    const t = await templateRepo(ctx).getTemplate(ws, next.templateId);
    clientId = t && !t.deleted_at ? ((JSON.parse(t.data) as { clientId?: string | null }).clientId ?? null) : null;
  }
  const noEmail = (message: string) => errors.validation([{ path: 'clientId', message }], 'No confirmed client email');
  if (!clientId) throw noEmail('Emailing invoices automatically needs a saved client with an email address (on the schedule or its template).');
  const row = await clientRepo(ctx).getClient(ws, clientId);
  const email = row && !row.deleted_at ? ((JSON.parse(row.data) as { email?: string }).email ?? '').trim() : '';
  if (!email) throw noEmail('The client has no email address. Add it on the Clients page first.');
  if (!(await createEmailRepository(ctx.deps.db).isUserEnteredAddress(ws, normalizeEmail(email)))) {
    throw noEmail('The client’s email address was added by an agent. Open the client on the Clients page and save it to confirm the address first.');
  }
}

/**
 * The user saving a `send_email` schedule approves automatic emailing of the
 * template and client as they are now (security fix M1): a later change by
 * an agent holds the email until the user re-approves.
 */
const approvesEmail = (ctx: ServiceContext, cfg: StoredScheduleData) => ctx.principal.type === 'user' && cfg.autoAction === 'send_email';

/** A newly set template or client must be live in this workspace. */
async function checkRefs(ctx: ServiceContext, cfg: StoredScheduleData, current?: StoredScheduleData): Promise<void> {
  const ws = ctx.principal.workspaceId;
  if (cfg.templateId !== current?.templateId) {
    const t = await templateRepo(ctx).getTemplate(ws, cfg.templateId);
    if (!t) throw errors.validation([{ path: 'templateId', message: 'No template with this id exists in this workspace' }], 'Unknown template');
    if (t.deleted_at) throw errors.validation([{ path: 'templateId', message: 'This template was deleted; pick another template' }], 'Template was deleted');
  }
  if (cfg.clientId && cfg.clientId !== current?.clientId) {
    const c = await clientRepo(ctx).getClient(ws, cfg.clientId);
    if (!c) throw errors.validation([{ path: 'clientId', message: 'No client with this id exists in this workspace' }], 'Unknown client');
    if (c.deleted_at) throw errors.validation([{ path: 'clientId', message: 'This client was deleted; pick another client or use null' }], 'Client was deleted');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStored(input: RecurringInputParsed, current?: StoredScheduleData): StoredScheduleData {
  return {
    version: CURRENT_SCHEDULE_VERSION,
    name: input.name,
    templateId: input.templateId,
    clientId: input.clientId ?? null,
    frequency: input.frequency,
    startDate: input.startDate,
    timezone: input.timezone ?? current?.timezone ?? 'UTC',
    endDate: input.endDate ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
    autoAction: input.autoAction ?? 'draft',
    overrides: { notes: input.overrides?.notes ?? null, taxRate: input.overrides?.taxRate ?? null },
  };
}

const todayIn = (ctx: ServiceContext, tz: string) => localDateIn(ctx.deps.clock(), tz);

/** Status and next run date after a configuration change (see the module comment). */
function scheduleState(ctx: ServiceContext, cfg: StoredScheduleData, row?: ScheduleRow, createStatus: 'active' | 'paused' = 'active') {
  const today = todayIn(ctx, cfg.timezone);
  if (!row) {
    const next = nextRunDate(cfg, { onOrAfter: today });
    return { status: next === null ? ('ended' as const) : createStatus, nextRunDate: next };
  }
  const before = configOf(row);
  const cadenceChanged = cfg.frequency !== before.frequency || cfg.startDate !== before.startDate || cfg.timezone !== before.timezone;
  let next: string | null;
  if (cadenceChanged || row.status === 'ended' || row.next_run_date === null) {
    next = nextRunDate(cfg, { onOrAfter: today, lastRunDate: row.last_run_date, runCount: row.run_count });
  } else {
    next = row.next_run_date;
    if ((cfg.endDate && next > cfg.endDate) || (cfg.maxOccurrences != null && row.run_count >= cfg.maxOccurrences)) next = null;
  }
  const status = next === null ? ('ended' as const) : row.status === 'ended' ? ('active' as const) : row.status;
  return { status, nextRunDate: next };
}

async function loadLive(ctx: ServiceContext, rawId: string): Promise<ScheduleRow> {
  const id = parseRecurringId(rawId);
  const row = await recurringRepo(ctx.deps).get(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Recurring schedule not found');
  if (row.deleted_at) throw errors.gone('Recurring schedule was deleted', { id, deletedAt: row.deleted_at });
  return row;
}

function checkIfMatch(pre: { ifMatch?: RevisionPrecondition }, row: ScheduleRow): void {
  if (typeof pre.ifMatch === 'number' && pre.ifMatch !== row.revision) {
    throw errors.preconditionFailed('Revision mismatch', { id: row.id, currentRevision: row.revision });
  }
}

async function raceOutcome(ctx: ServiceContext, id: string): Promise<never> {
  const now = await recurringRepo(ctx.deps).get(ctx.principal.workspaceId, id);
  if (!now) throw errors.notFound('Recurring schedule not found');
  if (now.deleted_at) throw errors.gone('Recurring schedule was deleted', { id, deletedAt: now.deleted_at });
  throw errors.preconditionFailed('The schedule changed meanwhile (revision mismatch); read it again and retry', { id, currentRevision: now.revision });
}

const entity = (row: Pick<ScheduleRow, 'id'>, name: string) => ({ type: 'recurring', id: row.id, label: name });

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listRecurring(ctx: ServiceContext, q: { status?: string[]; templateId?: string } = {}): Promise<ListRecurringResponse> {
  requireScope(ctx.principal, 'recurring:read');
  const rows = await recurringRepo(ctx.deps).list(ctx.principal.workspaceId, { statuses: q.status, templateId: q.templateId });
  const sender = recurringEmailSender();
  const available = sender ? await sender.availability(ctx.deps) : { ok: false as const, reason: 'Email sending is not available on this server.' };
  return { recurring: rows.map(toApiRecurring), email: available.ok ? { configured: true, reason: null } : { configured: false, reason: available.reason } };
}

export async function getRecurring(ctx: ServiceContext, rawId: string): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:read');
  return toApiRecurring(await loadLive(ctx, rawId));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function createRecurring(ctx: ServiceContext, body: unknown): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:write');
  const input = parseOrThrow(recurringInputSchema, body);
  const cfg = toStored(input);
  if (input.status !== 'paused') await requireActivation(ctx, cfg);
  else requireScope(ctx.principal, 'templates:read');
  await guardAutoEmail(ctx, cfg);
  await checkRefs(ctx, cfg);
  const id = ctx.deps.ids.uuid();
  const state = scheduleState(ctx, cfg, undefined, input.status ?? 'active');
  const max = ctx.deps.settings.get('recurring.maxSchedulesPerWorkspace');
  const row = await recurringRepo(ctx.deps).insert(
    { workspaceId: ctx.principal.workspaceId, id, data: cfg, status: state.status, nextRunDate: state.nextRunDate, actor: actorOf(ctx.principal), max, approveEmail: approvesEmail(ctx, cfg) },
    activityWrite(ctx, { action: 'recurring.created', entity: entity({ id }, cfg.name), changes: state.status === 'paused' ? { fields: ['status'] } : null }),
  );
  if (!row) throw new ApiError(409, 'limit_reached', `This workspace already has the maximum of ${max} recurring schedules. Delete one first.`, { max });
  return toApiRecurring(row);
}

async function writeConfig(ctx: ServiceContext, row: ScheduleRow, cfg: StoredScheduleData): Promise<RecurringSchedule> {
  const before = configOf(row);
  const fields = changedFields(before, cfg);
  if (fields.length === 0) return toApiRecurring(row);
  const state = scheduleState(ctx, cfg, row);
  const updated = await recurringRepo(ctx.deps).update(
    {
      workspaceId: ctx.principal.workspaceId,
      id: row.id,
      data: cfg,
      status: state.status,
      nextRunDate: state.nextRunDate,
      actor: actorOf(ctx.principal),
      expectedRevision: row.revision,
      resetFailures: true,
      approveEmail: approvesEmail(ctx, cfg),
    },
    activityWriteIf(ctx, { action: 'recurring.updated', entity: entity(row, cfg.name), changes: { fields } }),
  );
  if (!updated) return raceOutcome(ctx, row.id);
  return toApiRecurring(updated);
}

/** PUT /recurring/:id: replaces the configuration of an existing schedule (status and run history are kept). */
export async function putRecurring(ctx: ServiceContext, rawId: string, body: unknown, pre: { ifMatch?: RevisionPrecondition }): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:write');
  const input = parseOrThrow(recurringInputSchema, body);
  const row = await loadLive(ctx, rawId);
  if (input.id !== undefined && input.id.toLowerCase() !== row.id) throw errors.badRequest('Body id does not match the URL id', { bodyId: input.id, id: row.id });
  checkIfMatch(pre, row);
  const current = configOf(row);
  const cfg = toStored(input, current);
  await requireActivation(ctx, cfg);
  await guardAutoEmail(ctx, cfg, current);
  await checkRefs(ctx, cfg, current);
  return writeConfig(ctx, row, cfg);
}

/** PATCH /recurring/:id: any subset; `overrides` merged key by key. */
export async function patchRecurring(ctx: ServiceContext, rawId: string, body: unknown, pre: { ifMatch?: RevisionPrecondition }): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:write');
  const patch = parseOrThrow(recurringPatchSchema, body);
  const row = await loadLive(ctx, rawId);
  if (patch.id !== undefined && patch.id.toLowerCase() !== row.id) throw errors.badRequest('Body id does not match the URL id', { bodyId: patch.id, id: row.id });
  checkIfMatch(pre, row);
  const current = configOf(row);
  const cfg: StoredScheduleData = { ...current, overrides: { ...current.overrides }, version: CURRENT_SCHEDULE_VERSION };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'id') continue;
    if (key === 'overrides') {
      const o = value as { notes?: string | null; taxRate?: number | null };
      if (o.notes !== undefined) cfg.overrides.notes = o.notes;
      if (o.taxRate !== undefined) cfg.overrides.taxRate = o.taxRate;
    } else (cfg as unknown as Record<string, unknown>)[key] = value;
  }
  if (cfg.endDate && cfg.endDate < cfg.startDate) throw errors.validation([{ path: 'endDate', message: 'The end date must be on or after the start date' }]);
  await requireActivation(ctx, cfg);
  await guardAutoEmail(ctx, cfg, current);
  await checkRefs(ctx, cfg, current);
  return writeConfig(ctx, row, cfg);
}

export async function deleteRecurring(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition }): Promise<{ deleted: boolean }> {
  requireScope(ctx.principal, 'recurring:write');
  const id = parseRecurringId(rawId);
  const repo = recurringRepo(ctx.deps);
  const row = await repo.softDelete(
    { workspaceId: ctx.principal.workspaceId, id, actor: actorOf(ctx.principal), expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined },
    activityWrite(ctx, { action: 'recurring.deleted', entity: { type: 'recurring', id } }, { labelSql: LABEL(ctx.principal.workspaceId, id) }),
  );
  if (row) return { deleted: true };
  const existing = await repo.get(ctx.principal.workspaceId, id);
  if (!existing) throw errors.notFound('Recurring schedule not found');
  if (existing.deleted_at) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Recurring schedule was already deleted', { id, currentRevision: existing.revision });
    return { deleted: false };
  }
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
}

/** POST /recurring/:id/pause: no more invoices until resumed (idempotent). */
export async function pauseRecurring(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition } = {}): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:write');
  const row = await loadLive(ctx, rawId);
  checkIfMatch(pre, row);
  if (row.status === 'paused') return toApiRecurring(row);
  if (row.status === 'ended') throw errors.conflict('This schedule has ended; there is nothing to pause.', { status: row.status });
  const cfg = configOf(row);
  const updated = await recurringRepo(ctx.deps).update(
    { workspaceId: row.workspace_id, id: row.id, data: cfg, status: 'paused', nextRunDate: row.next_run_date, actor: actorOf(ctx.principal), expectedRevision: row.revision, resetFailures: false },
    activityWrite(ctx, { action: 'recurring.paused', entity: entity(row, cfg.name) }),
  );
  if (!updated) return raceOutcome(ctx, row.id);
  return toApiRecurring(updated);
}

/**
 * POST /recurring/:id/resume. The catch-up policy applies right away:
 * periods missed while paused are skipped and recorded, except the most
 * recent one, which becomes the next run date (generated by the next job
 * run, or with run-now).
 */
export async function resumeRecurring(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition } = {}): Promise<RecurringSchedule> {
  requireScope(ctx.principal, 'recurring:write');
  const row = await loadLive(ctx, rawId);
  checkIfMatch(pre, row);
  const cfg = configOf(row);
  await requireActivation(ctx, cfg);
  await guardAutoEmail(ctx, cfg, cfg);
  if (row.status === 'active') return toApiRecurring(row);
  if (row.status === 'ended') throw errors.conflict('This schedule has ended. Change its end date or number of invoices to continue it.', { status: row.status });
  const today = todayIn(ctx, cfg.timezone);
  let next = row.next_run_date;
  let skipped: { count: number; last: { from: string; to: string; count: number } } | null = null;
  let skippedPeriods: string[] = [];
  if (next && next <= today) {
    const plan = catchUpPlan(cfg, next, today);
    if (plan) {
      next = plan.period;
      if (plan.skippedCount > 0) {
        skipped = { count: plan.skippedCount, last: { from: plan.skipped[0], to: plan.skipped[plan.skipped.length - 1], count: plan.skippedCount } };
        skippedPeriods = plan.skipped;
      }
    } else next = nextRunDate(cfg, { onOrAfter: today, lastRunDate: row.last_run_date, runCount: row.run_count });
  }
  const repo = recurringRepo(ctx.deps);
  const updated = await repo.update(
    {
      workspaceId: row.workspace_id,
      id: row.id,
      data: cfg,
      status: next ? 'active' : 'ended',
      nextRunDate: next,
      actor: actorOf(ctx.principal),
      expectedRevision: row.revision,
      resetFailures: true,
      skipped,
      extra: repo.skippedRunStatements({ workspaceId: row.workspace_id, scheduleId: row.id, periods: skippedPeriods, via: 'schedule' }),
    },
    activityWrite(ctx, { action: 'recurring.resumed', entity: entity(row, cfg.name), changes: skipped ? { skipped: skipped.count } : null }),
  );
  if (!updated) return raceOutcome(ctx, row.id);
  return toApiRecurring(updated);
}

/**
 * POST /recurring/:id/run-now: generates the schedule's next period now (the
 * invoice is dated with that period's run date). Idempotent per period: with
 * `period` (recommended), a retry returns the invoice already generated for
 * it instead of generating the following period.
 */
export async function runRecurringNow(ctx: ServiceContext, rawId: string, body: unknown): Promise<RunRecurringNowResponse> {
  requireScope(ctx.principal, 'recurring:write');
  const req = parseOrThrow(runNowSchema, body ?? {});
  const row = await loadLive(ctx, rawId);
  const cfg = configOf(row);
  await requireActivation(ctx, cfg);
  await guardAutoEmail(ctx, cfg, cfg);
  const repo = recurringRepo(ctx.deps);
  const loadInvoice = async (id: string | null) => {
    if (!id) return null;
    const inv = await ctx.repo.getInvoice(row.workspace_id, id);
    return inv && !inv.deleted_at ? toApiInvoice(inv) : null;
  };

  if (req.period) {
    const run = await repo.getRun(row.workspace_id, row.id, req.period);
    if (run?.outcome === 'generated') {
      return { period: req.period, generated: false, invoice: await loadInvoice(run.invoice_id), recurring: toApiRecurring(row) };
    }
    if (run?.outcome === 'skipped') throw errors.conflict(`The period ${req.period} was skipped by the catch-up policy and is not generated.`, { period: req.period });
  }
  if (!ctx.deps.settings.get('recurring.enabled')) {
    throw new ApiError(503, 'recurring_disabled', 'Recurring invoice generation is switched off on this server right now.', undefined, { 'retry-after': '3600' });
  }
  if (row.status === 'paused') throw errors.conflict('This schedule is paused. Resume it first.', { status: row.status });
  if (row.status === 'ended' || !row.next_run_date) throw errors.conflict('This schedule has ended.', { status: row.status });
  if (req.period && req.period !== row.next_run_date) {
    throw errors.conflict(`Only the next period (${row.next_run_date}) can be generated now.`, { nextRunDate: row.next_run_date });
  }
  let result;
  try {
    result = await generatePeriod({ ctx, row, period: row.next_run_date, skipped: [], skippedCount: 0, via: 'run_now' });
  } catch (error) {
    if (error instanceof GenerationError) {
      if (error.status >= 500) throw errors.internal();
      throw new ApiError(error.status === 409 ? 409 : 400, error.status === 409 ? 'conflict' : 'validation_failed', error.message, { reason: error.code });
    }
    throw error;
  }
  const after = await repo.get(row.workspace_id, row.id);
  return { period: row.next_run_date, generated: result.generated, invoice: result.invoice, recurring: toApiRecurring(after ?? row) };
}

/**
 * GET /recurring/:id/preview: the next run dates and the next invoice as it
 * would be generated now (placeholders resolved for its run date; the
 * invoice number is the one the next invoice would get right now).
 */
export async function previewRecurring(ctx: ServiceContext, rawId: string, count = 6): Promise<RecurringPreviewResponse> {
  requireScope(ctx.principal, 'recurring:read');
  requireScope(ctx.principal, 'templates:read');
  const row = await loadLive(ctx, rawId);
  const cfg = configOf(row);
  const upcoming = row.status === 'ended' ? [] : upcomingRunDates(cfg, row.next_run_date, count, row.run_count);
  const base = { recurring: toApiRecurring(row), upcoming, placeholders: { unknown: [] as string[], unresolved: [] as string[] }, warnings: [] as string[] };
  if (upcoming.length === 0) return { ...base, nextInvoice: null, problem: null };
  try {
    const built = await buildPeriodInvoice(ctx, row.id, cfg, upcoming[0]);
    const data = await newInvoiceData(ctx, built.input);
    const number = data.invoiceNumber || formatInvoiceNumber((await ctx.repo.maxInvoiceNumberValue(row.workspace_id)) + 1);
    const { version: _v, ...rest } = data;
    return {
      ...base,
      placeholders: built.placeholders,
      warnings: built.warnings,
      nextInvoice: { ...rest, invoiceNumber: number, ...calculateInvoiceTotals(data) },
      problem: null,
    };
  } catch (error) {
    if (error instanceof GenerationError) return { ...base, nextInvoice: null, problem: { code: error.code, message: error.message } };
    if (error instanceof ApiError && error.code === 'validation_failed') {
      const details = Array.isArray(error.details) ? (error.details as { message?: string }[]) : [];
      return { ...base, nextInvoice: null, problem: { code: 'validation_failed', message: details[0]?.message ?? error.message } };
    }
    throw error;
  }
}

/**
 * POST /recurring/:id/approve-email (workspace token only): the user
 * re-approves automatic emailing after the template, the client's email or
 * the generated invoice was changed by an agent. Approves the content as it
 * is now and, when an email is held for review, sends it right away (the held
 * invoice's sender details and recipient come from that content, so they are
 * approved too — unless an agent edited the invoice itself, which the user
 * must review on the invoice page).
 */
export async function approveRecurringEmail(ctx: ServiceContext, rawId: string): Promise<ApproveRecurringEmailResponse> {
  requireUser(ctx.principal);
  const row = await loadLive(ctx, rawId);
  const cfg = configOf(row);
  if (cfg.autoAction !== 'send_email') throw errors.conflict('This schedule does not email invoices automatically; there is nothing to approve.', { autoAction: cfg.autoAction });
  const repo = recurringRepo(ctx.deps);
  const held = parseJson<RecurringError>(row.last_error);
  const pending = held?.sendPending && held.code === 'email_needs_review' && held.invoiceId && held.period ? held : null;
  const approved = await repo.approveEmail(row.workspace_id, row.id, activityWrite(ctx, { action: 'recurring.email_approved', entity: entity(row, cfg.name) }));
  if (!approved) return raceOutcome(ctx, row.id);
  let emailed = false;
  if (pending) {
    const invoiceRow = await ctx.repo.getInvoice(row.workspace_id, pending.invoiceId!);
    const editedByAgent = (await repo.agentEditsSince(row.workspace_id, null, { templateId: null, clientIds: [], invoiceId: pending.invoiceId! })).length > 0;
    if (invoiceRow && !invoiceRow.deleted_at && !editedByAgent) {
      // Sender details only: an address an agent wrote is confirmed on the Clients page or the invoice, never implicitly here.
      await reviewInvoice(ctx, invoiceRow.id, { ifMatch: invoiceRow.revision }, { recipient: false }).catch(() => undefined);
      emailed = await emailPeriodInvoice(ctx.deps, row, pending.period!, pending.invoiceId!, pending.attempts + 1);
    }
  }
  const after = await repo.get(row.workspace_id, row.id);
  return { recurring: toApiRecurring(after ?? approved), emailed };
}

/** Invoice of a generated period (null when deleted), for MCP answers. */
export async function invoiceOfRun(ctx: ServiceContext, id: string | null) {
  if (!id || !hasScope(ctx.principal, 'invoices:read')) return null;
  return getInvoice(ctx, id).catch(() => null);
}
