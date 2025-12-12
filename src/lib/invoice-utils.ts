import { format, parseISO } from 'date-fns';

/**
 * Formats a numeric amount as a currency string.
 *
 * @param amount - The numeric amount to format
 * @param currency - ISO 4217 currency code (default: 'USD')
 * @returns Formatted currency string (e.g., '$1,234.56')
 *
 * @example
 * formatCurrency(1234.5, 'USD') // '$1,234.50'
 * formatCurrency(1000, 'EUR')   // '€1,000.00'
 * formatCurrency(1000, 'INVALID') // '$1,000.00' (falls back to USD)
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch (error) {
    // Fallback to USD if currency code is invalid
    console.warn(`Invalid currency code: ${currency}, falling back to USD`);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  }
}

/**
 * Formats an ISO date string into a human-readable format.
 *
 * @param dateString - ISO 8601 date string (e.g., '2024-01-15')
 * @returns Formatted date string (e.g., 'Jan 15, 2024') or '-' if empty
 *
 * @example
 * formatDate('2024-01-15') // 'Jan 15, 2024'
 * formatDate('')           // '-'
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '-';
  try {
    return format(parseISO(dateString), 'MMM dd, yyyy');
  } catch {
    return dateString;
  }
}

/**
 * Generates a random invoice number.
 *
 * @returns Invoice number in format 'INV-XXXX' where X is a digit
 *
 * @deprecated Use `useInvoiceStore.getNextInvoiceNumber()` for sequential numbers
 *
 * @example
 * generateInvoiceNumber() // 'INV-0042'
 */
export function generateInvoiceNumber(): string {
  return `INV-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
}

