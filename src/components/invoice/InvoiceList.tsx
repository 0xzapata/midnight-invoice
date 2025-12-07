import { format, parseISO } from 'date-fns';
import { FileText, Trash2, Eye } from 'lucide-react';
import { Invoice } from '@/types/invoice';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/invoice-utils';

interface InvoiceListProps {
  invoices: Invoice[];
  onView: (invoice: Invoice) => void;
  onDelete: (id: string) => void;
}

export function InvoiceList({ invoices, onView, onDelete }: InvoiceListProps) {
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
            className="group flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-mono text-sm font-medium text-foreground">
                  {invoice.invoiceNumber}
                </p>
                <p className="text-xs text-muted-foreground">
                  {invoice.toName || 'No client'} · {format(parseISO(invoice.createdAt), 'MMM dd, yyyy')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <p className="font-mono text-sm font-medium text-primary">
                {formatCurrency(withTax, invoice.currency)}
              </p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onView(invoice)}
                  className="h-8 w-8"
                >
                  <Eye className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(invoice.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
