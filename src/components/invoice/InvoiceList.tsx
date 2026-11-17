import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { FileText, Trash2, Pencil, Copy } from 'lucide-react';
import { Invoice } from '@/types/invoice';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatCurrency } from '@/lib/invoice-utils';
import { AgentBadge } from '@/components/AgentBadge';
import { useCloudStore } from '@/stores/useCloudStore';
import { invoiceIssues } from '@/lib/validation';
import { invoiceListLabel } from '@/lib/invoiceName';

/** The fields the API rejects (or the server's message), for the "Not synced" badge. */
function notSyncedSummary(invoice: Invoice, serverMessage: string): string {
  const issues = invoiceIssues(invoice).map((issue) => issue.message);
  return `Not synced: ${issues.length > 0 ? issues.join('; ') : serverMessage}`;
}
import { StatusBadge } from '@/components/invoice/status/StatusBadge';
import { StatusActionsMenu } from '@/components/invoice/status/StatusActions';
import { useToday } from '@/components/invoice/status/useInvoiceStatus';
import { SendInvoiceEmailDialog } from '@/components/invoice/email/SendInvoiceEmailDialog';

interface InvoiceListProps {
  invoices: Invoice[];
  onView: (invoice: Invoice) => void;
  onLoadSession: (invoice: Invoice) => void;
  onDuplicate: (invoice: Invoice) => void;
  onDelete: (id: string) => void;
}

export function InvoiceList({ invoices, onView, onLoadSession, onDuplicate, onDelete }: InvoiceListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);
  const emailInvoice = emailInvoiceId ? invoices.find((i) => i.id === emailInvoiceId) : undefined;
  const syncErrors = useCloudStore((state) => state.syncErrors);
  const today = useToday();

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-1">No invoices yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first invoice to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {invoices.map((invoice) => {
        const total = invoice.lineItems.reduce(
          (sum, item) => sum + item.quantity * item.price,
          0
        );
        const withTax = total * (1 + invoice.taxRate / 100);

        return (
          <div
            key={invoice.id}
            // Phones: name, badges and details full width, then amount + actions on one row.
            // sm+: icon | details over amount | actions.
            className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:gap-y-1"
            onClick={() => onView(invoice)}
            data-testid="invoice-row"
          >
              <div className="hidden w-10 h-10 shrink-0 rounded-md bg-secondary items-center justify-center self-start mt-1 sm:flex sm:row-span-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 break-words font-medium text-foreground">
                    {invoiceListLabel(invoice)}
                  </p>
                  <StatusBadge invoice={invoice} today={today} />
                  <AgentBadge invoice={invoice} />
                  {syncErrors[invoice.id] && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onLoadSession(invoice); }}
                      className="border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600 hover:bg-amber-500/20 hover:underline dark:text-amber-400"
                      title={notSyncedSummary(invoice, syncErrors[invoice.id])}
                      aria-label={`${notSyncedSummary(invoice, syncErrors[invoice.id])}. Edit to fix`}
                    >
                      Not synced
                    </button>
                  )}
                </div>
                {/* Wraps only between the three parts, never inside a date or number. */}
                <p className="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                  <span className="font-mono whitespace-nowrap">{invoice.invoiceNumber}</span>
                  <span className="min-w-0 max-w-full truncate"><span aria-hidden="true">· </span>{invoice.toName || 'No client'}</span>
                  <span className="whitespace-nowrap"><span aria-hidden="true">· </span>{format(parseISO(invoice.createdAt), 'MMM dd, yyyy')}</span>
                </p>
              </div>
              <p className="min-w-0 truncate font-mono text-sm font-medium text-primary sm:col-start-2 sm:row-start-2">
                {formatCurrency(withTax, invoice.currency)}
              </p>
            <div className="-mr-2 flex shrink-0 items-center justify-end gap-0.5 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mr-0 sm:gap-1">
              <StatusActionsMenu invoice={invoice} onSendEmail={() => setEmailInvoiceId(invoice.id)} />
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onLoadSession(invoice); }}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Load Session"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDuplicate(invoice); }}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Duplicate Invoice"
              >
                <Copy className="w-4 h-4" />
              </Button>
              
              <AlertDialog open={deleteDialogOpen === invoice.id} onOpenChange={(open) => setDeleteDialogOpen(open ? invoice.id : null)}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Delete Invoice"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Invoice?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete invoice <span className="font-mono font-medium">{invoice.invoiceNumber}</span>?
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(invoice.id);
                        setDeleteDialogOpen(null);
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        );
      })}
      {emailInvoice && (
        <SendInvoiceEmailDialog invoice={emailInvoice} open onOpenChange={(open) => !open && setEmailInvoiceId(null)} />
      )}
    </div>
  );
}
