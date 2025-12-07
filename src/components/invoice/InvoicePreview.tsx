import { forwardRef } from 'react';
import { InvoiceFormData } from '@/types/invoice';
import { formatCurrency, formatDate } from '@/lib/invoice-utils';

interface InvoicePreviewProps {
  data: InvoiceFormData;
}

export const InvoicePreview = forwardRef<HTMLDivElement, InvoicePreviewProps>(
  ({ data }, ref) => {
    const subtotal = data.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );
    const tax = subtotal * (data.taxRate / 100);
    const total = subtotal + tax;

    return (
      <div
        ref={ref}
        className="bg-card border border-border rounded-lg p-8 min-h-[800px] invoice-shadow fade-in"
        style={{ width: '100%', maxWidth: '595px' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Invoice
            </p>
            <p className="font-mono text-lg font-semibold text-foreground">
              {data.invoiceNumber || 'INV-0001'}
            </p>
          </div>
          <div className="text-right">
            <div className="flex gap-8">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Issue Date
                </p>
                <p className="font-mono text-sm text-foreground">
                  {formatDate(data.issueDate)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Due Date
                </p>
                <p className="font-mono text-sm text-foreground">
                  {formatDate(data.dueDate)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* From / To */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              From
            </p>
            <div className="text-sm space-y-0.5">
              <p className="font-medium text-foreground">{data.fromName || 'Your Name'}</p>
              <p className="text-muted-foreground whitespace-pre-line">
                {data.fromAddress || 'Your Address'}
              </p>
              <p className="text-muted-foreground">{data.fromEmail}</p>
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Bill To
            </p>
            <div className="text-sm space-y-0.5">
              <p className="font-medium text-foreground">{data.toName || 'Client Name'}</p>
              <p className="text-muted-foreground whitespace-pre-line">
                {data.toAddress || 'Client Address'}
              </p>
              <p className="text-muted-foreground">{data.toEmail}</p>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="mb-8">
          <div className="grid grid-cols-12 gap-4 pb-3 border-b border-border">
            <p className="col-span-6 text-[11px] uppercase tracking-wider text-muted-foreground">
              Description
            </p>
            <p className="col-span-2 text-[11px] uppercase tracking-wider text-muted-foreground text-right">
              Qty
            </p>
            <p className="col-span-2 text-[11px] uppercase tracking-wider text-muted-foreground text-right">
              Price
            </p>
            <p className="col-span-2 text-[11px] uppercase tracking-wider text-muted-foreground text-right">
              Total
            </p>
          </div>
          {data.lineItems.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-12 gap-4 py-3 border-b border-border/50"
            >
              <p className="col-span-6 text-sm text-foreground">
                {item.description || 'Item description'}
              </p>
              <p className="col-span-2 text-sm font-mono text-foreground text-right">
                {item.quantity}
              </p>
              <p className="col-span-2 text-sm font-mono text-foreground text-right">
                {formatCurrency(item.price, data.currency)}
              </p>
              <p className="col-span-2 text-sm font-mono text-foreground text-right">
                {formatCurrency(item.quantity * item.price, data.currency)}
              </p>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono text-foreground">
                {formatCurrency(subtotal, data.currency)}
              </span>
            </div>
            {data.taxRate > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({data.taxRate}%)</span>
                <span className="font-mono text-foreground">
                  {formatCurrency(tax, data.currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-base pt-2 border-t border-border">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-mono font-semibold text-primary">
                {formatCurrency(total, data.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="grid grid-cols-2 gap-8 mt-auto">
          {data.paymentDetails && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Payment Details
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {data.paymentDetails}
              </p>
            </div>
          )}
          {data.notes && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Notes
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {data.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
);

InvoicePreview.displayName = 'InvoicePreview';
