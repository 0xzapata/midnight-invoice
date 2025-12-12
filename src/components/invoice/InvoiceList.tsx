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

interface InvoiceListProps {
  invoices: Invoice[];
  onView: (invoice: Invoice) => void;
  onLoadSession: (invoice: Invoice) => void;
  onDuplicate: (invoice: Invoice) => void;
  onDelete: (id: string) => void;
}

export function InvoiceList({ invoices, onView, onLoadSession, onDuplicate, onDelete }: InvoiceListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);

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
            className="group flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
            onClick={() => onView(invoice)}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center self-start mt-1">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-medium text-foreground">
                  {invoice.invoiceName || 'Invoice'}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{invoice.invoiceNumber}</span> · {invoice.toName || 'No client'} · {format(parseISO(invoice.createdAt), 'MMM dd, yyyy')}
                </p>
                <p className="font-mono text-sm font-medium text-primary">
                  {formatCurrency(withTax, invoice.currency)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
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
    </div>
  );
}
