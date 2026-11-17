import { format, parseISO } from 'date-fns';
import type { Invoice } from '@/types/invoice';
import { cn } from '@/lib/utils';
import { statusOf } from '../../../../shared/invoice-status';
import { StatusBadge } from './StatusBadge';
import { StatusActionButtons } from './StatusActions';
import { useToday } from './useInvoiceStatus';

const fmt = (date: string | null | undefined) => {
  if (!date) return null;
  try {
    return format(parseISO(date), 'MMM d, yyyy');
  } catch {
    return date;
  }
};

/** Status, key dates and quick actions above the invoice preview (not printed). */
export function InvoiceStatusBar({ invoice, className }: { invoice: Invoice; className?: string }) {
  const today = useToday();
  const status = statusOf(invoice);
  const facts: string[] = [];
  if (invoice.dueDate) facts.push(`Due ${fmt(invoice.dueDate)}`);
  if (status !== 'draft' && invoice.sentAt) facts.push(`Sent ${fmt(invoice.sentAt)}`);
  if (status === 'paid' && invoice.paidAt) facts.push(`Paid ${fmt(invoice.paidAt)}`);
  return (
    <section
      aria-label="Invoice status"
      className={cn(
        'mx-auto mb-6 flex w-full max-w-[595px] flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between print:hidden',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge invoice={invoice} today={today} className="text-xs" />
        {facts.length > 0 && <span className="text-xs text-muted-foreground">{facts.join(' · ')}</span>}
      </div>
      <StatusActionButtons invoice={invoice} className="sm:shrink-0 sm:flex-nowrap" />
    </section>
  );
}
