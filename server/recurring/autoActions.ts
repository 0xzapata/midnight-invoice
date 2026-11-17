/**
 * Integration point for the `send_email` auto action. Recurring invoices do
 * not send email themselves: an email feature registers a sender here
 * (`setRecurringEmailSender`) and from then on `send_email` schedules can be
 * created (by the user only, never by an agent) and each generated invoice is
 * handed to it. Without a registered sender, `send_email` is refused with
 * 400 `validation_failed` and existing ones fail with `email_unavailable`.
 */
import type { ServiceContext } from '../services/invoices';

export interface RecurringEmailSender {
  /**
   * Sends the generated invoice to its client, as `POST /invoices/:id/send`
   * would for the workspace owner (marks it sent, records the activity).
   * Throws an ApiError when it cannot.
   */
  send(ctx: ServiceContext, invoiceId: string): Promise<void>;
}

let sender: RecurringEmailSender | null = null;

export function setRecurringEmailSender(next: RecurringEmailSender | null): void {
  sender = next;
}

export function recurringEmailSender(): RecurringEmailSender | null {
  return sender;
}
