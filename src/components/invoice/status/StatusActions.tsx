import { useState } from 'react';
import { Ban, CheckCircle2, ListChecks, Mail, RotateCcw, Send } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { availableActions, STATUS_ACTION_LABELS, type StatusAction } from '../../../../shared/invoice-status';
import { useStatusAction } from './useInvoiceStatus';

const ACTION_ICONS: Record<StatusAction, typeof Send> = {
  mark_sent: Send,
  mark_paid: CheckCircle2,
  void: Ban,
  reopen: RotateCcw,
};

type StatusInvoice = Pick<Invoice, 'id' | 'invoiceNumber' | 'status' | 'sentAt'>;

/** Row menu with the status changes that apply to this invoice (dashboard list), plus "Send by email…" when given. */
export function StatusActionsMenu({ invoice, onSendEmail }: { invoice: StatusInvoice; onSendEmail?: () => void }) {
  const [open, setOpen] = useState(false);
  const run = useStatusAction();
  const actions = availableActions(invoice);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => e.stopPropagation()}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Change status"
          aria-label={`Change status of ${invoice.invoiceNumber}`}
        >
          <ListChecks className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
        <div role="group" aria-label={`Status actions for ${invoice.invoiceNumber}`} className="flex flex-col">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action];
            return (
              <button
                key={action}
                type="button"
                onClick={() => {
                  run(invoice, action);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden',
                  action === 'void' && 'text-destructive',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {STATUS_ACTION_LABELS[action]}
              </button>
            );
          })}
        </div>
        {onSendEmail && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSendEmail();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden',
                actions.length > 0 && 'mt-1 border-t border-border pt-2',
              )}
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              Send by email…
            </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Inline buttons for the invoice view; the main next step is the primary button. */
export function StatusActionButtons({ invoice, className }: { invoice: StatusInvoice; className?: string }) {
  const run = useStatusAction();
  const actions = availableActions(invoice);
  const primary = actions.find((a) => a === 'mark_sent' || a === 'mark_paid');
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {actions.map((action) => {
        const Icon = ACTION_ICONS[action];
        return (
          <Button
            key={action}
            size="sm"
            variant={action === primary ? 'default' : 'outline'}
            onClick={() => run(invoice, action)}
            className={cn(action === 'void' && 'text-destructive hover:text-destructive')}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {STATUS_ACTION_LABELS[action]}
          </Button>
        );
      })}
    </div>
  );
}
