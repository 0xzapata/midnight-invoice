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
 * - Idempotency: the key is `recurring/<schedule>/<period>`, so a retry after a
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
import { sendInvoiceEmail } from '../services/invoiceEmail';
import type { ServiceContext } from '../services/invoices';

export interface RecurringEmailSender {
  /** Whether email can be sent on this server right now (and why not). */
  availability(deps: AppDeps): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Emails the generated invoice of `period`. Throws an ApiError when it cannot. */
  send(ctx: ServiceContext, args: { invoiceId: string; schedule: { id: string; name: string }; period: string }): Promise<{ invoice: ApiInvoice; replayed: boolean }>;
}

/** Idempotency key of a period's email: retries never send twice. */
export const recurringEmailKey = (scheduleId: string, period: string) => `recurring/${scheduleId}/${period}`;

export const serviceEmailSender: RecurringEmailSender = {
  async availability(deps) {
    const config = await loadEmailConfig(deps);
    return config.configured ? { ok: true } : { ok: false, reason: config.reason };
  },
  async send(ctx, { invoiceId, schedule, period }) {
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
