/**
 * Generating the invoice of one period of a recurring schedule, exactly once.
 *
 * Exactly-once, even with retries, overlapping cron runs and concurrent
 * isolates (or "run now" racing the job):
 *
 * 1. The invoice id is derived from (workspace, schedule, period), so a second
 *    attempt for the same period can only hit the invoices primary key
 *    (`INSERT … ON CONFLICT DO NOTHING`): there is never a second invoice,
 *    even after the first one was deleted (its tombstone keeps the id).
 * 2. In the same D1 batch (one transaction) as the insert: the activity entry,
 *    the `recurring_runs` row (primary key = schedule + period) and the
 *    schedule's compare-and-set advance (`WHERE next_run_date = <the period
 *    the attempt was planned from>`), so one attempt wins and the others
 *    change nothing.
 * 3. An attempt whose insert hit an existing id (an earlier attempt that
 *    committed the invoice but not the rest) completes the bookkeeping
 *    without creating anything.
 *
 * Invoice content: the template through `invoiceFieldsFromTemplate` and the
 * placeholder resolver (issue date = the period's run date), the schedule's
 * client winning over the template's, the overrides winning over the
 * template, then the usual client defaults and workspace settings
 * (newInvoiceData). The invoice number comes from the atomic allocator.
 */
import { SCOPES } from '../../shared/api';
import type { ActivityActor } from '../../shared/activity';
import type { ApiInvoice } from '../../shared/api';
import { addDays, nextRunDate } from '../../shared/recurring';
import { invoiceFieldsFromTemplate, type InvoiceTemplate } from '../../shared/types/template';
import { placeholdersIn } from '../../shared/template-placeholders';
import type { Actor } from '../../shared/types/invoice';
import { sha256Hex } from '../crypto';
import type { StoredClientData } from '../db/clientRepository';
import { createRepository } from '../db/repository';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { activityWrite } from '../services/activity';
import { clientRepo } from '../services/clients';
import { createInvoiceIfAbsent, getInvoice, toApiInvoice, type ServiceContext } from '../services/invoices';
import { templateRepo, toApiTemplate } from '../services/templates';
import { recurringEmailSender } from './autoActions';
import { createRecurringRepository, type RecurringRepository, type ScheduleRow, type StoredScheduleData } from './repository';
import { formatInvoiceNumber } from '../../shared/invoice-totals';

/** A reason the period cannot be generated (recorded on the schedule as lastError). */
export class GenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

const repos = new WeakMap<D1Database, RecurringRepository>();
export function recurringRepo(deps: Pick<AppDeps, 'db'>): RecurringRepository {
  let repo = repos.get(deps.db);
  if (!repo) {
    repo = createRecurringRepository(deps.db);
    repos.set(deps.db, repo);
  }
  return repo;
}

/** The generator acts for the workspace (it was authorised when the schedule was set up). */
export function systemContext(deps: AppDeps, workspaceId: string): ServiceContext {
  return { repo: createRepository(deps.db), deps, principal: { type: 'user', workspaceId, scopes: SCOPES } };
}

export const systemActorOf = (row: Pick<ScheduleRow, 'id' | 'name'>): Actor => ({ type: 'system', recurringId: row.id, recurringName: row.name });

/** Invoice id of a schedule's period: a UUID (version 8 layout) from SHA-256(workspace, schedule, period). */
export async function periodInvoiceId(workspaceId: string, scheduleId: string, period: string): Promise<string> {
  const hex = await sha256Hex(`midnight-invoice/recurring/${workspaceId}/${scheduleId}/${period}`);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const configOf = (row: Pick<ScheduleRow, 'data'>): StoredScheduleData => JSON.parse(row.data) as StoredScheduleData;

// ---------------------------------------------------------------------------
// Building the invoice of a period
// ---------------------------------------------------------------------------

export interface PeriodInvoice {
  /** POST /invoices body. */
  input: Record<string, unknown>;
  template: InvoiceTemplate;
  placeholders: { unknown: string[]; unresolved: string[] };
  warnings: string[];
}

/**
 * The invoice input for `period` (issue date = the run date), or a
 * GenerationError (template or client gone, nothing to bill). Pure reads.
 */
export async function buildPeriodInvoice(ctx: ServiceContext, scheduleId: string, cfg: StoredScheduleData, period: string): Promise<PeriodInvoice> {
  const workspaceId = ctx.principal.workspaceId;
  const templateRow = await templateRepo(ctx).getTemplate(workspaceId, cfg.templateId);
  if (!templateRow) throw new GenerationError('template_not_found', 'The template of this schedule does not exist. Pick another template.');
  if (templateRow.deleted_at) throw new GenerationError('template_deleted', 'The template of this schedule was deleted. Pick another template.');
  const template = toApiTemplate(templateRow);

  // Precedence: the schedule's client → the template's default client.
  const clientId = cfg.clientId ?? template.clientId ?? null;
  let client: StoredClientData | undefined;
  if (clientId) {
    const row = await clientRepo(ctx).getClient(workspaceId, clientId);
    if (!row || row.deleted_at) {
      throw new GenerationError(
        'client_deleted',
        cfg.clientId ? 'The client of this schedule was deleted. Pick another client.' : 'The default client of the template was deleted. Pick a client for this schedule or fix the template.',
      );
    }
    client = JSON.parse(row.data) as StoredClientData;
  }

  const notes = cfg.overrides.notes ?? template.notes;
  const texts = [template.invoiceNamePattern, notes, ...template.lineItems.map((li) => li.description)];
  // {{invoice_number}} needs the number up front (the same rule as POST /templates/:id/instantiate).
  const invoiceNumber = texts.some((t) => placeholdersIn(t).includes('invoice_number'))
    ? formatInvoiceNumber((await ctx.repo.maxInvoiceNumberValue(workspaceId)) + 1)
    : undefined;
  const application = invoiceFieldsFromTemplate({ ...template, clientId: null, notes }, { issueDate: period, clientName: client?.name, invoiceNumber }, () => ctx.deps.ids.uuid());
  if (application.fields.lineItems.length === 0) {
    throw new GenerationError('validation_failed', 'The template has no line items, so there is nothing to invoice. Add line items to the template.');
  }
  const input: Record<string, unknown> = {
    ...application.fields,
    issueDate: period,
    templateId: template.id,
    recurringId: scheduleId,
  };
  if (invoiceNumber) input.invoiceNumber = invoiceNumber;
  if (clientId) input.clientId = clientId;
  if (cfg.overrides.taxRate != null) input.taxRate = cfg.overrides.taxRate;
  if (cfg.autoAction === 'mark_sent') {
    input.status = 'sent';
    input.sentAt = period;
  }
  const warnings: string[] = [];
  if (application.unknown.length) warnings.push(`Unknown placeholders left as typed: ${application.unknown.map((n) => `{{${n}}}`).join(', ')}`);
  if (application.unresolved.length) warnings.push(`Placeholders without a value: ${application.unresolved.map((n) => `{{${n}}}`).join(', ')}`);
  return { input, template, placeholders: { unknown: application.unknown, unresolved: application.unresolved }, warnings };
}

/** Maps an error while building/creating to the code and message stored on the schedule. */
export function generationErrorOf(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;
  if (error instanceof ApiError) {
    if (error.code === 'validation_failed') {
      const details = Array.isArray(error.details) ? (error.details as { path?: string; message?: string }[]) : [];
      const first = details[0];
      const message = first?.message ? `The generated invoice is not valid: ${first.message}${first.path ? ` (${first.path})` : ''}.` : `The generated invoice is not valid: ${error.message}.`;
      return new GenerationError('validation_failed', message);
    }
    return new GenerationError(error.code, error.message, error.status);
  }
  return new GenerationError('internal_error', 'The invoice could not be generated because of a server error. It will be retried.', 500);
}

// ---------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------

export interface GenerateArgs {
  /** For "run now": the caller's context (its scopes, request origin and actor for the activity entry). */
  ctx: ServiceContext;
  row: ScheduleRow;
  period: string;
  /** Older missed periods skipped by the catch-up policy. */
  skipped: string[];
  skippedCount: number;
  via: 'schedule' | 'run_now';
}

export interface GenerateResult {
  generated: boolean;
  invoice: ApiInvoice | null;
  invoiceId: string;
  ended: boolean;
}

/**
 * Generates the invoice of `period` and advances the schedule (see the
 * module comment). Throws a GenerationError when it cannot be built; a
 * failure of the e-mail auto action is recorded on the schedule instead (the
 * invoice exists).
 */
export async function generatePeriod(args: GenerateArgs): Promise<GenerateResult> {
  const { ctx, row, period } = args;
  const deps = ctx.deps;
  const repo = recurringRepo(deps);
  const cfg = configOf(row);
  const workspaceId = row.workspace_id;
  const expected = row.next_run_date!;

  if (cfg.autoAction === 'send_email' && !recurringEmailSender()) {
    throw new GenerationError('email_unavailable', 'This schedule emails invoices, but email sending is not available on this server. Change what happens on generation.', 409);
  }
  const built = await buildPeriodInvoice(ctx, row.id, cfg, period);
  const invoiceId = await periodInvoiceId(workspaceId, row.id, period);
  const runCount = row.run_count + 1;
  const next = nextRunDate(cfg, { onOrAfter: addDays(period, 1), lastRunDate: period, runCount });
  const lastSkipped = args.skippedCount > 0 ? { from: args.skipped[0], to: args.skipped[args.skipped.length - 1], count: args.skippedCount } : null;
  const system: ActivityActor = { type: 'system' };
  const sysCtx = { deps, principal: ctx.principal };

  const bookkeeping = (): D1PreparedStatement[] => [
    repo.generatedRunStatement({ workspaceId, scheduleId: row.id, period, invoiceId, via: args.via }),
    ...repo.skippedRunStatements({ workspaceId, scheduleId: row.id, periods: args.skipped, via: args.via }),
    repo.advanceStatement({
      workspaceId,
      scheduleId: row.id,
      expectedNextRunDate: expected,
      period,
      invoiceId,
      nextRunDate: next,
      skippedCount: args.skippedCount,
      lastSkipped,
    }),
    // Guarded by the advance (changes() > 0): only the attempt that advanced the schedule records the end.
    ...(next === null
      ? activityWrite(sysCtx, { actor: system, action: 'recurring.ended', entity: { type: 'recurring', id: row.id, label: row.name }, changes: { period } }).statements
      : []),
  ];

  let invoice: ApiInvoice | null;
  try {
    invoice = await createInvoiceIfAbsent(ctx, built.input, {
      id: invoiceId,
      actor: systemActorOf(row),
      // Generated by the schedule: the system. "Run now": whoever pressed it.
      activityActor: args.via === 'schedule' ? system : undefined,
      fromTemplate: { id: built.template.id, label: built.template.name },
      fromRecurring: { id: row.id, label: row.name },
      activityChanges: { trigger: args.via, ...(args.skippedCount > 0 ? { skipped: args.skippedCount } : {}) },
      also: bookkeeping(),
    });
  } catch (error) {
    throw generationErrorOf(error);
  }
  let generated = true;
  if (!invoice) {
    // An earlier attempt created this period's invoice: finish its bookkeeping (idempotent), create nothing.
    generated = false;
    await repo.batch(bookkeeping());
    const existing = await ctx.repo.getInvoice(workspaceId, invoiceId);
    invoice = existing && !existing.deleted_at ? toApiInvoice(existing) : null;
  }

  if (generated && cfg.autoAction === 'send_email') {
    try {
      await recurringEmailSender()!.send(ctx, invoiceId);
      invoice = await getInvoice(ctx, invoiceId).catch(() => invoice);
    } catch (error) {
      // The invoice exists (a draft): record why it was not sent; never retried automatically (no double sends).
      const reason = generationErrorOf(error);
      await recordFailure(deps, { ...row, next_run_date: next }, { code: 'email_failed', message: `Invoice ${invoice!.invoiceNumber} was created but not emailed: ${reason.message}` }, period, { retry: false });
    }
  }
  return { generated, invoice, invoiceId, ended: next === null };
}

// ---------------------------------------------------------------------------
// Failures and ending
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;

/** Retry delay after `attempts` consecutive failures: 1 h, 2 h, 4 h … capped at 24 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(24 * HOUR, HOUR * 2 ** Math.max(0, attempts - 1));
}

/**
 * Records a failed attempt on the schedule (visible reason, attempt count,
 * next retry) and one `recurring.run_failed` entry per schedule, period and
 * reason (repeats bump its attempt counter). Never throws.
 */
export async function recordFailure(
  deps: AppDeps,
  row: Pick<ScheduleRow, 'workspace_id' | 'id' | 'name' | 'next_run_date' | 'failure_count'>,
  failure: { code: string; message: string },
  period: string | null,
  opts: { retry?: boolean; delayMs?: number } = {},
): Promise<void> {
  try {
    const now = deps.clock();
    const attempts = row.failure_count + 1;
    const retryAt = new Date(now.getTime() + (opts.retry === false ? 0 : (opts.delayMs ?? retryDelayMs(attempts)))).toISOString();
    const repo = recurringRepo(deps);
    const ctx = { deps, principal: systemContext(deps, row.workspace_id).principal };
    await repo.batch([
      repo.failureStatement({
        workspaceId: row.workspace_id,
        scheduleId: row.id,
        expectedNextRunDate: row.next_run_date,
        error: { code: failure.code, message: failure.message, at: now.toISOString(), period, attempts },
        failureCount: opts.retry === false ? 0 : attempts,
        retryAt: opts.retry === false ? null : retryAt,
      }),
      ...activityWrite(ctx, {
        actor: { type: 'system' },
        action: 'recurring.run_failed',
        entity: { type: 'recurring', id: row.id, label: row.name },
        changes: { reason: failure.code, ...(period ? { period } : {}), counts: { attempts: 1 } },
        dedupe: { key: `recurring-failed:${row.id}:${period ?? '-'}:${failure.code}`, mode: 'count', counter: 'attempts' },
      }).statements,
    ]);
  } catch (error) {
    deps.logError?.('Could not record a recurring-invoice failure', error);
  }
}

/** Ends an active schedule whose end date passed or whose occurrences are used up. */
export async function endSchedule(deps: AppDeps, row: Pick<ScheduleRow, 'workspace_id' | 'id' | 'name' | 'next_run_date'>): Promise<void> {
  const repo = recurringRepo(deps);
  const ctx = { deps, principal: systemContext(deps, row.workspace_id).principal };
  await repo.batch([
    repo.endStatement({ workspaceId: row.workspace_id, scheduleId: row.id, expectedNextRunDate: row.next_run_date }),
    ...activityWrite(ctx, { actor: { type: 'system' }, action: 'recurring.ended', entity: { type: 'recurring', id: row.id, label: row.name } }).statements,
  ]);
}
