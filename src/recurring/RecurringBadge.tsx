import { Link } from 'react-router';
import { Repeat } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { cn } from '@/lib/utils';

/** Name of the schedule that generated an invoice (from its `createdBy`), if any. */
function recurringNameOf(invoice: Pick<Invoice, 'createdBy' | 'recurringId'>): string | null {
  if (!invoice.recurringId) return null;
  return invoice.createdBy?.type === 'system' && invoice.createdBy.recurringName ? invoice.createdBy.recurringName : null;
}

/** "Recurring" chip on invoices a schedule generated; links to /recurring. */
export function RecurringBadge({ invoice, className }: { invoice: Pick<Invoice, 'createdBy' | 'recurringId'>; className?: string }) {
  if (!invoice.recurringId) return null;
  const name = recurringNameOf(invoice);
  return (
    <Link
      to="/recurring"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex max-w-full items-center gap-1 border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-sky-700 hover:bg-sky-500/20 dark:text-sky-300',
        className,
      )}
      title={name ? `Created by the recurring schedule “${name}”` : 'Created by a recurring schedule'}
      aria-label={name ? `Recurring: created by the schedule ${name}` : 'Recurring: created by a schedule'}
    >
      <Repeat className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">Recurring</span>
    </Link>
  );
}

/** One-line provenance on the invoice page: which schedule and template generated it. */
export function RecurringOrigin({ invoice }: { invoice: Pick<Invoice, 'createdBy' | 'recurringId' | 'templateId' | 'issueDate'> }) {
  const template = useTemplateStore((s) => (invoice.templateId ? s.templates.find((t) => t.id === invoice.templateId) : undefined));
  if (!invoice.recurringId) return null;
  const name = recurringNameOf(invoice);
  return (
    <p className="mb-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs text-muted-foreground print:hidden" data-testid="recurring-origin">
      <Repeat className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden="true" />
      <span>
        Created automatically by the recurring schedule {name ? <span className="font-medium text-foreground">“{name}”</span> : 'a recurring schedule'}
        {template ? (
          <>
            {' '}
            from the template <span className="font-medium text-foreground">“{template.name}”</span>
          </>
        ) : null}
        .
      </span>
      <Link to="/recurring" className="text-primary underline-offset-4 hover:underline">
        Manage schedules
      </Link>
    </p>
  );
}
