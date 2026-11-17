import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { InvoiceFormData } from '@/types/invoice';
import { formatCurrency, formatDate } from '@/lib/invoice-utils';
import { sanitizeInvoiceData } from '@/lib/sanitize';
import { printableInvoiceName } from '@/lib/invoiceName';

interface InvoicePreviewProps {
  data: InvoiceFormData;
}

/** The card is always laid out at the A4 width the PDF uses (595 px = 595 pt). */
export const PREVIEW_WIDTH = 595;

/**
 * Scale that fits the fixed-width card into its container, and the card's
 * scaled height. On phones (and in narrow columns) the card is shrunk as a
 * whole with a CSS transform instead of being reflowed, so it stays a 1:1
 * picture of the PDF. 1 when there is room.
 */
function useFitToWidth(outer: React.RefObject<HTMLDivElement | null>, inner: React.RefObject<HTMLDivElement | null>) {
  const [fit, setFit] = useState<{ scale: number; height: number | null }>({ scale: 1, height: null });
  useLayoutEffect(() => {
    const measure = () => {
      const width = outer.current?.clientWidth ?? PREVIEW_WIDTH;
      const scale = width > 0 && width < PREVIEW_WIDTH ? width / PREVIEW_WIDTH : 1;
      const height = scale < 1 && inner.current ? inner.current.offsetHeight * scale : null;
      setFit((prev) => (prev.scale === scale && prev.height === height ? prev : { scale, height }));
    };
    measure();
    let observer: ResizeObserver | undefined;
    try {
      observer = new ResizeObserver(measure);
      if (outer.current) observer.observe(outer.current);
      if (inner.current) observer.observe(inner.current);
    } catch {
      // No ResizeObserver (old browsers, some test environments): fall back to window resizes.
      window.addEventListener('resize', measure);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [outer, inner]);
  return fit;
}

export const InvoicePreview = forwardRef<HTMLDivElement, InvoicePreviewProps>(
  ({ data }, ref) => {
    const outerRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const fit = useFitToWidth(outerRef, cardRef);
    // Sanitize all input data for safe rendering
    const safeData = useMemo(() => sanitizeInvoiceData(data), [data]);

    const subtotal = safeData.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );
    const tax = subtotal * (safeData.taxRate / 100);
    const total = subtotal + tax;
    // Only a name the user typed; never a generated dashboard label.
    const invoiceName = printableInvoiceName(safeData.invoiceName);

    return (
      <div
        ref={outerRef}
        className="w-full print:h-auto!"
        style={{ maxWidth: PREVIEW_WIDTH, height: fit.height ?? undefined }}
        data-preview-scale={fit.scale}
      >
      <div
        ref={(node) => {
          cardRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className="invoice-preview bg-card border border-border p-8 min-h-[800px] invoice-shadow fade-in origin-top-left print:transform-none!"
        style={{ width: PREVIEW_WIDTH, transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Invoice
            </p>
            <p className="text-lg font-semibold text-foreground">
              {safeData.invoiceNumber || 'INV-0001'}
            </p>
            {invoiceName && (
              <p className="mt-1 max-w-62 text-sm text-muted-foreground" data-testid="invoice-name">
                {invoiceName}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="flex gap-8">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Issue Date
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(safeData.issueDate)}
                </p>
              </div>
              {safeData.dueDate && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                    Due Date
                  </p>
                  <p className="text-sm text-foreground">
                    {formatDate(safeData.dueDate)}
                  </p>
                </div>
              )}
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
              <p className="font-medium text-foreground">{safeData.fromName || 'Your Name'}</p>
              <p className="text-muted-foreground whitespace-pre-line">
                {safeData.fromAddress || 'Your Address'}
              </p>
              <p className="text-muted-foreground">{safeData.fromEmail}</p>
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Bill To
            </p>
            <div className="text-sm space-y-0.5">
              <p className="font-medium text-foreground">{safeData.toName || 'Client Name'}</p>
              <p className="text-muted-foreground whitespace-pre-line">
                {safeData.toAddress || 'Client Address'}
              </p>
              <p className="text-muted-foreground">{safeData.toEmail}</p>
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
          {safeData.lineItems.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-12 gap-4 py-3 border-b border-border/50"
            >
              <p className="col-span-6 text-sm text-foreground">
                {item.description || 'Item description'}
              </p>
              <p className="col-span-2 text-sm text-foreground text-right">
                {item.quantity}
              </p>
              <p className="col-span-2 text-sm text-foreground text-right">
                {formatCurrency(item.price, safeData.currency)}
              </p>
              <p className="col-span-2 text-sm text-foreground text-right">
                {formatCurrency(item.quantity * item.price, safeData.currency)}
              </p>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">
                {formatCurrency(subtotal, safeData.currency)}
              </span>
            </div>
            {safeData.taxRate > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({safeData.taxRate}%)</span>
                <span className="text-foreground">
                  {formatCurrency(tax, safeData.currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-base pt-2 border-t border-border">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-semibold text-primary">
                {formatCurrency(total, safeData.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="grid grid-cols-2 gap-8 mt-auto">
          {safeData.paymentDetails && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Payment Details
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {safeData.paymentDetails}
              </p>
            </div>
          )}
          {safeData.notes && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Notes
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {safeData.notes}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
    );
  }
);

InvoicePreview.displayName = 'InvoicePreview';