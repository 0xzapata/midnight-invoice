/**
 * Emailing a generated invoice (`autoAction: send_email`) and retrying it.
 *
 * The invoice is generated first (generate.ts) and stays a draft until the
 * email actually went out. A send that cannot happen is recorded on the
 * schedule as `lastError` with `sendPending` and `nextAttemptAt` (kept apart
 * from `retry_at`, so a failing email never delays the next period's
 * invoice), and retried by the hourly job with backoff: only the SEND is
 * retried, with the same idempotency key, never the generation. Retrying
 * stops after MAX_SEND_ATTEMPTS, when the invoice was deleted or voided, when
 * it was emailed some other way meanwhile (e.g. by the user), or when the
 * provider refused the message for good. The next period's generation clears
 * the record (that invoice stays a draft with its failed attempt in the
 * email history and the activity log).
 */
import { ApiError } from '../errors';
import type { AppDeps } from '../deps';
import { createEmailRepository } from '../db/emailRepository';
import type { RecurringError } from '../../shared/recurring';
import { activityWrite } from '../services/activity';
import { recurringEmailSender } from './autoActions';
import { recurringRepo, retryDelayMs, systemContext } from './generate';
import type { ScheduleRow } from './repository';

export const MAX_SEND_ATTEMPTS = 8;

type ScheduleRef = Pick<ScheduleRow, 'workspace_id' | 'id' | 'name'>;

export interface SendFailure {
  code: string;
  message: string;
  /** Retry automatically (with backoff, or after `delayMs`). */
  retry: boolean;
  delayMs?: number;
}

/** What a failed send means for the schedule. */
export function sendFailureOf(error: unknown): SendFailure {
  if (!(error instanceof ApiError)) return { code: 'email_failed', message: 'Sending failed unexpectedly. It will be retried.', retry: true };
  const details = (error.details ?? {}) as { reason?: string; retryable?: boolean; retryAfterSeconds?: number };
  switch (error.code) {
    case 'email_not_configured':
      return { code: 'email_not_configured', message: `${error.message} The invoice was created as a draft; it is emailed once email is set up again.`, retry: true };
    case 'rate_limited':
      return { code: 'email_rate_limited', message: `${error.message} The invoice was created as a draft and is emailed later.`, retry: true, delayMs: (details.retryAfterSeconds ?? 3600) * 1000 };
    case 'recipient_not_allowed':
      return {
        code: 'email_address_not_confirmed',
        message: 'The client’s email address was not entered by you (an agent added it), so the invoice was not emailed. Open the client in the app and save it to confirm the address, or send the invoice yourself.',
        retry: true,
      };
    case 'invoice_needs_review':
      return { code: 'email_needs_review', message: `Needs your review: ${error.message}`, retry: true };
    case 'validation_failed':
      return { code: 'email_no_recipient', message: `The invoice was not emailed: ${error.message === 'No recipient' ? 'the client has no email address' : error.message}. Add the client’s email, or send the invoice yourself.`, retry: true };
    case 'email_send_failed':
      return { code: 'email_failed', message: `The email provider did not send it: ${error.message}`, retry: details.retryable !== false };
    case 'idempotency_conflict':
      return { code: 'email_failed', message: 'The email is still being sent; checking again shortly.', retry: true, delayMs: 5 * 60_000 };
    case 'gone':
    case 'not_found':
      return { code: 'email_failed', message: 'The generated invoice was deleted, so it was not emailed.', retry: false };
    case 'invalid_status_transition':
      return { code: 'email_failed', message: 'The generated invoice was voided, so it was not emailed.', retry: false };
    default:
      return { code: 'email_failed', message: error.message, retry: error.status >= 500 };
  }
}

/** Writes the send outcome on the schedule and, for a failure, one deduplicated `recurring.run_failed` entry. */
async function recordSendState(
  deps: AppDeps,
  schedule: ScheduleRef,
  invoiceId: string,
  error: RecurringError | null,
  guard: 'generated' | 'pending',
): Promise<void> {
  const repo = recurringRepo(deps);
  const ctx = { deps, principal: systemContext(deps, schedule.workspace_id).principal };
  try {
    await repo.batch([
      repo.sendStateStatement({ workspaceId: schedule.workspace_id, scheduleId: schedule.id, invoiceId, error, guard }),
      ...(error
        ? activityWrite(ctx, {
            actor: { type: 'system' },
            action: 'recurring.run_failed',
            entity: { type: 'recurring', id: schedule.id, label: schedule.name },
            changes: { reason: error.code, ...(error.period ? { period: error.period } : {}), counts: { attempts: 1 } },
            dedupe: { key: `recurring-failed:${schedule.id}:${error.period ?? '-'}:${error.code}`, mode: 'count', counter: 'attempts' },
          }).statements
        : []),
    ]);
  } catch (e) {
    deps.logError?.('Could not record a recurring email outcome', e);
  }
}

/**
 * Emails the invoice of `period` (attempt `attempt`, 1-based). Never throws:
 * the outcome is stored on the schedule.
 */
export async function emailPeriodInvoice(deps: AppDeps, schedule: ScheduleRef, period: string, invoiceId: string, attempt: number): Promise<boolean> {
  const guard = attempt === 1 ? 'generated' : 'pending';
  const sender = recurringEmailSender();
  const now = deps.clock();
  const fail = async (f: SendFailure) => {
    const pending = f.retry && attempt < MAX_SEND_ATTEMPTS;
    const next = new Date(now.getTime() + Math.max(f.delayMs ?? 0, retryDelayMs(attempt)));
    await recordSendState(
      deps,
      schedule,
      invoiceId,
      {
        code: f.code,
        message: pending ? f.message : `${f.message} Not retried any more.`,
        at: now.toISOString(),
        period,
        attempts: attempt,
        invoiceId,
        sendPending: pending,
        nextAttemptAt: pending ? next.toISOString() : null,
      },
      guard,
    );
    return false;
  };
  if (!sender) return fail({ code: 'email_unavailable', message: 'Emailing invoices is not available on this server, so the invoice was created as a draft.', retry: true });
  try {
    await sender.send(systemContext(deps, schedule.workspace_id), { invoiceId, schedule: { id: schedule.id, name: schedule.name }, period });
  } catch (error) {
    if (!(error instanceof ApiError)) deps.logError?.('Recurring email failed unexpectedly', error);
    return fail(sendFailureOf(error));
  }
  if (attempt > 1) await recordSendState(deps, schedule, invoiceId, null, guard);
  return true;
}

/**
 * Hourly retry pass over schedules with a pending email (bounded; skipped in
 * maintenance mode and for suspended workspaces, which keep their pending
 * state). Returns how many emails went out.
 */
export async function retryPendingEmails(deps: AppDeps, nowMs: number, limit: number): Promise<{ attempted: number; sent: number }> {
  if (deps.settings.get('maintenance.enabled')) return { attempted: 0, sent: 0 };
  const repo = recurringRepo(deps);
  const emails = createEmailRepository(deps.db);
  const rows = await repo.pendingSends(new Date(nowMs).toISOString(), limit);
  let attempted = 0;
  let sent = 0;
  for (const row of rows) {
    if (row.suspended) continue;
    const err = JSON.parse(row.last_error!) as RecurringError;
    if (!err.invoiceId || !err.period) continue;
    // Emailed some other way meanwhile (the user sent it): nothing left to do.
    if (await emails.lastDeliveredAt(row.workspace_id, err.invoiceId)) {
      await recordSendState(deps, row, err.invoiceId, null, 'pending');
      continue;
    }
    attempted++;
    if (await emailPeriodInvoice(deps, row, err.period, err.invoiceId, err.attempts + 1)) sent++;
  }
  return { attempted, sent };
}
