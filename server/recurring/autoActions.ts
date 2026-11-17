/**
 * The `send_email` auto action: a schedule that generates an invoice and
 * emails it to the client on file, through the email feature's own send
 * use-case (`sendInvoiceEmail`, the same code as `POST /invoices/:id/send`).
 *
 * - Unattended rules (see `UnattendedSend`): only the invoice's toEmail, only
 *   an address the user entered (an agent-written client email is held), and
 *   sender details that are the user's — payment details from the settings or
 *   from a template the user saved last; a template an agent changed last
 *   holds the send with "needs your review".
 * - Limits: counted like the user's own sends (workspace hourly/daily windows
 *   and the site-wide daily cap; never bypassed), per-invoice cooldown.
 * - Idempotency: the key is `internal:recurring/<schedule>/<period>` (a prefix clients cannot use), so a retry after a
 *   partial failure replays instead of sending twice (the provider also gets a
 *   key derived from the message id).
 * - Status: the invoice is generated as a draft and only becomes `sent` when
 *   the email went out (one `invoice.emailed` entry folds the status change in).
 *
 * The sender is swappable for tests (`setRecurringEmailSender`); null switches
 * the auto action off (`send_email` refused / recorded as email_unavailable).
 */
import type { ApiInvoice } from '../../shared/api';
import type { AppDeps } from '../deps';
import { loadEmailConfig } from '../email/config';
import { ApiError } from '../errors';
import { INTERNAL_KEY_PREFIX, sendInvoiceEmail } from '../services/invoiceEmail';
import { recurringRepo } from './generate';
import type { ServiceContext } from '../services/invoices';

export interface RecurringEmailSender {
  /** Whether email can be sent on this server right now (and why not). */
  availability(deps: AppDeps): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Emails the generated invoice of `period`. Throws an ApiError when it cannot. */
  send(ctx: ServiceContext, args: { invoiceId: string; schedule: { id: string; name: string }; period: string }): Promise<{ invoice: ApiInvoice; replayed: boolean }>;
}

/** Idempotency key of a period's email: retries never send twice. */
export const recurringEmailKey = (scheduleId: string, period: string) => `${INTERNAL_KEY_PREFIX}recurring/${scheduleId}/${period}`;

/**
 * Security fix M1: an unattended email sends what the user approved. The
 * schedule records the agent-edit sequence number current when the user last
 * saved or re-approved it; if the template, the client (its email) or the
 * generated invoice was changed by an agent since, the email is held as
 * `invoice_needs_review` (→ `email_needs_review` on the schedule) until the
 * user re-approves (POST /recurring/:id/approve-email). The user's own edits
 * are not logged and never hold it.
 */
async function requireApprovedContent(ctx: ServiceContext, scheduleId: string, invoiceId: string): Promise<void> {
  const ws = ctx.principal.workspaceId;
  const repo = recurringRepo(ctx.deps);
  const row = await repo.get(ws, scheduleId);
  const inv = await ctx.repo.getInvoice(ws, invoiceId);
  if (!row || !inv) return; // gone: sendInvoiceEmail reports it
  const data = JSON.parse(inv.data) as { templateId?: string | null; clientId?: string | null };
  const review = (message: string, details: Record<string, unknown>) =>
    new ApiError(403, 'invoice_needs_review', `${message} Review it and re-approve automatic emailing on the Recurring page; the invoice was created as a draft.`, {
      reason: 'changed_since_approval',
      ...details,
    });
  if (row.email_approved_seq === null) throw review('You have not approved automatic emailing for this schedule.', { changes: [] });
  const edits = await repo.agentEditsSince(ws, row.email_approved_seq, { templateId: data.templateId ?? null, clientIds: data.clientId ? [data.clientId] : [], invoiceId });
  if (edits.length === 0) return;
  const what = (e: (typeof edits)[number]) => {
    const by = e.agent_name ? `an agent (${e.agent_name})` : 'someone other than you';
    return e.entity_type === 'template' ? `the template was changed by ${by}` : e.entity_type === 'client' ? `the client’s email address was changed by ${by}` : `the invoice was changed by ${by}`;
  };
  const list = edits.map(what);
  throw review(`Since you approved automatic emailing, ${list.join(' and ')}.`, {
    changes: edits.map((e) => ({ entity: e.entity_type, id: e.entity_id, agentName: e.agent_name })),
  });
}

export const serviceEmailSender: RecurringEmailSender = {
  async availability(deps) {
    const config = await loadEmailConfig(deps);
    return config.configured ? { ok: true } : { ok: false, reason: config.reason };
  },
  async send(ctx, { invoiceId, schedule, period }) {
    await requireApprovedContent(ctx, schedule.id, invoiceId);
    const res = await sendInvoiceEmail(ctx, invoiceId, {}, {
      idempotencyKey: recurringEmailKey(schedule.id, period),
      unattended: {
        actor: { type: 'system', recurringId: schedule.id, recurringName: schedule.name },
        activityActor: { type: 'system' },
        recurring: { id: schedule.id, label: schedule.name },
      },
    });
    return { invoice: res.invoice, replayed: res.replayed };
  },
};

let sender: RecurringEmailSender | null = serviceEmailSender;

export function setRecurringEmailSender(next: RecurringEmailSender | null): void {
  sender = next;
}

export function recurringEmailSender(): RecurringEmailSender | null {
  return sender;
}
