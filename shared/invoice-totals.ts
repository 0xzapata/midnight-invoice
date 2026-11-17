import type { LineItem } from './types/invoice';

export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** Rounds to 2 decimal places (the precision the app displays). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes subtotal, tax and total exactly like the on-screen preview and the
 * PDF (sum of quantity * price; tax = subtotal * taxRate / 100), rounded to
 * 2 decimals for API consumers.
 */
export function calculateInvoiceTotals(data: { lineItems: Pick<LineItem, 'quantity' | 'price'>[]; taxRate: number }): InvoiceTotals {
  const subtotal = data.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxAmount = subtotal * (data.taxRate / 100);
  return {
    subtotal: roundMoney(subtotal),
    taxAmount: roundMoney(taxAmount),
    total: roundMoney(subtotal + taxAmount),
  };
}

/**
 * Numeric value of an invoice number, using the same rule as the browser
 * store's `getNextInvoiceNumber` (all digits concatenated). Null if none.
 */
export function invoiceNumberValue(invoiceNumber: string): number | null {
  const num = parseInt(invoiceNumber.replace(/\D/g, ''), 10);
  return Number.isSafeInteger(num) ? num : null;
}

/** Formats a sequence value like the store: INV-0001. */
export function formatInvoiceNumber(value: number): string {
  return `INV-${String(value).padStart(4, '0')}`;
}
