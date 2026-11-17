import { format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import type { InvoiceEmail } from '../../../../shared/api';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { emailActorLabel, emailFailureReason, invoiceEmailsKey, useEmailReadiness } from './emailState';

const when = (iso: string) => {
  try {
    return format(parseISO(iso), "MMM d, yyyy 'at' HH:mm");
  } catch {
    return iso;
  }
};

/** "Sent to x on …" and failures with the reason and a retry, under the status bar (cloud sync only). */
export function EmailHistory({ invoice, onRetry }: { invoice: Invoice; onRetry: () => void }) {
  const readiness = useEmailReadiness(invoice);
  // Uploading/not-synced invoices may still have a history on the server; only a browser without sync has none to show.
  if (readiness === 'sync_off' || invoice.revision === undefined) return null;
  return <HistoryList invoice={invoice} onRetry={onRetry} />;
}

function HistoryList({ invoice, onRetry }: { invoice: Invoice; onRetry: () => void }) {
  const query = useQuery({ queryKey: invoiceEmailsKey(invoice.id), queryFn: () => api.listInvoiceEmails(invoice.id), retry: false });
  const emails = query.data?.emails ?? [];
  if (emails.length === 0) return null;
  const latestIsFailure = emails[0].status === 'failed';
  return (
    <section aria-label="Email history" className="mx-auto mb-6 w-full max-w-[595px] border border-border bg-card p-3 text-xs print:hidden">
      <h2 className="mb-2 font-medium text-foreground">Email history</h2>
      <ul className="space-y-1.5">
        {emails.slice(0, 5).map((email) => (
          <EmailRow key={email.id} email={email} />
        ))}
      </ul>
      {emails.length > 5 && <p className="mt-1.5 text-muted-foreground">and {emails.length - 5} earlier</p>}
      {latestIsFailure && (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry sending
        </Button>
      )}
    </section>
  );
}

function EmailRow({ email }: { email: InvoiceEmail }) {
  const Icon = email.status === 'sent' ? CheckCircle2 : email.status === 'failed' ? AlertTriangle : Clock;
  const by = emailActorLabel(email);
  return (
    <li className="flex min-w-0 gap-2">
      <Icon
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          email.status === 'sent' ? 'text-primary' : email.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
      <p className="min-w-0 text-muted-foreground">
        {email.status === 'sent' && (
          <>
            <span className="text-foreground">Sent to </span>
            <span className="break-all font-code text-foreground">{email.to}</span>
            {email.cc.length > 0 && <span> (cc {email.cc.join(', ')})</span>} on {when(email.sentAt ?? email.createdAt)}
          </>
        )}
        {email.status === 'failed' && (
          <>
            <span className="text-destructive">Not sent</span> to <span className="break-all font-code">{email.to}</span> on {when(email.createdAt)}:{' '}
            {emailFailureReason(email)}
            {email.error?.message && <span className="block text-[11px]">{email.error.message}</span>}
          </>
        )}
        {email.status === 'queued' && (
          <>
            Sending to <span className="break-all font-code">{email.to}</span>…
          </>
        )}
        <span className="whitespace-nowrap">
          {' '}
          · by {by}
          {email.statusChanged && ' · marked sent'}
        </span>
      </p>
    </li>
  );
}
