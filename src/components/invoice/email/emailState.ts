/**
 * Sending by email is a server-side feature: it needs cloud sync and the
 * invoice's latest version on the server. These helpers say whether an
 * invoice can be emailed from this browser right now, and turn API errors
 * into sentences for the dialog.
 */
import type { InvoiceEmail } from '../../../../shared/api';
import { statusOf } from '../../../../shared/invoice-status';
import type { Invoice } from '@/types/invoice';
import { useCloudStore } from '@/stores/useCloudStore';
import { ApiError, describeError, formatWait } from '@/lib/api';

export type EmailReadiness = 'sync_off' | 'not_synced' | 'uploading' | 'void' | 'ready';

export function useEmailReadiness(invoice: Pick<Invoice, 'id' | 'revision' | 'status'>): EmailReadiness {
  const token = useCloudStore((s) => s.token);
  const syncError = useCloudStore((s) => s.syncErrors[invoice.id]);
  const pending = useCloudStore((s) => s.queue.some((op) => op.type === 'upsert' && op.entityId === invoice.id && (op.collection ?? 'invoices') === 'invoices'));
  if (!token) return 'sync_off';
  if (statusOf(invoice) === 'void') return 'void';
  if (syncError) return 'not_synced';
  if (pending || invoice.revision === undefined) return 'uploading';
  return 'ready';
}

export const invoiceEmailsKey = (id: string) => ['invoice-emails', id] as const;

/** A sentence for a failed send (never contains credentials: messages come from the server). */
export function describeEmailError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'email_not_configured':
        return 'Email isn’t set up on this server yet. The site owner needs to connect an email provider.';
      case 'recipient_not_allowed':
      case 'validation_failed': {
        const detail = (error.details as { message?: string }[] | undefined)?.[0]?.message;
        return Array.isArray(error.details) && detail ? detail : error.message;
      }
      case 'rate_limited':
        return error.retryAfterMs !== null ? `${error.message} Try again in ${formatWait(error.retryAfterMs)}.` : error.message;
      case 'email_send_failed':
        return `Not sent: ${error.message}`;
      case 'not_found':
        return 'This invoice hasn’t reached your cloud workspace yet. Wait for it to sync and try again.';
      case 'invalid_status_transition':
        return 'Void invoices can’t be sent.';
    }
  }
  return describeError(error);
}

export function emailActorLabel(email: Pick<InvoiceEmail, 'sentBy'>): string {
  if (email.sentBy.type === 'system') return email.sentBy.recurringName ? `the recurring invoice “${email.sentBy.recurringName}”` : 'a recurring invoice';
  return email.sentBy.type === 'agent' ? (email.sentBy.agentName ?? 'an agent') : 'you';
}

const ERROR_REASONS: Record<string, string> = {
  provider_auth_failed: 'the server’s email account rejected its API key',
  provider_rejected: 'the email provider refused the message',
  provider_rate_limited: 'the email provider is busy',
  provider_unavailable: 'the email provider had a problem',
  provider_unreachable: 'the email provider could not be reached',
  attachment_too_large: 'the PDF was too large',
  pdf_render_failed: 'the PDF could not be generated',
};

export function emailFailureReason(email: Pick<InvoiceEmail, 'error'>): string {
  if (!email.error) return 'unknown error';
  return ERROR_REASONS[email.error.code] ?? email.error.code;
}
