import { AlertCircle, Ban, CheckCircle2, CircleDashed, Send } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import { cn } from '@/lib/utils';
import { overdueLabel } from './useInvoiceStatus';
import { bucketOf, daysOverdue, STATUS_LABELS, statusOf, type StatusBucket } from '../../../../shared/invoice-status';

const STYLES: Record<StatusBucket, string> = {
  draft: 'border-border bg-secondary text-muted-foreground',
  outstanding: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  overdue: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  paid: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  void: 'border-border bg-transparent text-muted-foreground line-through decoration-1',
};

const ICONS = { draft: CircleDashed, outstanding: Send, overdue: AlertCircle, paid: CheckCircle2, void: Ban } as const;

/**
 * Status chip: Draft / Sent / Paid / Void, and "N days overdue" (red) for
 * sent invoices past their due date. Overdue is derived from today's local date.
 */
export function StatusBadge({ invoice, today, className }: { invoice: Pick<Invoice, 'status' | 'dueDate'>; today: string; className?: string }) {
  const bucket = bucketOf(invoice, today);
  const Icon = ICONS[bucket];
  const label = bucket === 'overdue' ? overdueLabel(daysOverdue(invoice, today)) : STATUS_LABELS[statusOf(invoice)];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap',
        STYLES[bucket],
        className,
      )}
      data-status={bucket}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        <span className="sr-only">Status: </span>
        {label}
      </span>
    </span>
  );
}
