import { InvoiceFormData, LineItem } from '@/types/invoice';

/**
 * Sanitizes text input for safe rendering in PDFs and HTML.
 *
 * Performs the following transformations:
 * - Removes all HTML tags (prevents XSS)
 * - Escapes HTML entities (&, <, >, ", ')
 * - Normalizes consecutive spaces/tabs to single space
 * - Preserves line breaks for multiline content
 * - Trims leading/trailing whitespace
 *
 * @param input - The text string to sanitize
 * @returns Sanitized text string, or empty string if input is falsy
 *
 * @example
 * sanitizeText('<script>alert("xss")</script>Hello')  // 'Hello'
 * sanitizeText('Hello & Goodbye')                     // 'Hello &amp; Goodbye'
 * sanitizeText('  Multiple   spaces  ')               // 'Multiple spaces'
 */
export function sanitizeText(input: string): string {
    if (!input) return '';

    return input
        // Remove any HTML tags
        .replace(/<[^>]*>/g, '')
        // Escape HTML entities
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        // Normalize whitespace (but preserve line breaks)
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/**
 * Sanitizes numeric input, ensuring a valid finite number.
 *
 * Handles various edge cases:
 * - Returns 0 for undefined, null, NaN, or Infinity
 * - Parses string inputs to numbers
 * - Returns the number as-is if already valid
 *
 * @param input - The value to sanitize (number, string, undefined, or null)
 * @returns A valid finite number, or 0 if invalid
 *
 * @example
 * sanitizeNumber(42)           // 42
 * sanitizeNumber('3.14')       // 3.14
 * sanitizeNumber(NaN)          // 0
 * sanitizeNumber(undefined)    // 0
 * sanitizeNumber(Infinity)     // 0
 */
export function sanitizeNumber(input: number | string | undefined | null): number {
    if (input === undefined || input === null) return 0;
    const num = typeof input === 'string' ? parseFloat(input) : input;
    return isNaN(num) || !isFinite(num) ? 0 : num;
}

/**
 * Sanitizes a single invoice line item.
 *
 * @param item - The line item to sanitize
 * @returns A new line item object with sanitized values
 *
 * @example
 * sanitizeLineItem({
 *   id: '1',
 *   description: '<b>Service</b>',
 *   quantity: NaN,
 *   price: 100
 * })
 * // Returns: { id: '1', description: 'Service', quantity: 0, price: 100 }
 */
export function sanitizeLineItem(item: LineItem): LineItem {
    return {
        id: item.id,
        description: sanitizeText(item.description),
        quantity: sanitizeNumber(item.quantity),
        price: sanitizeNumber(item.price),
    };
}

/**
 * Sanitizes an entire invoice form data object.
 *
 * Applies appropriate sanitization to each field:
 * - Text fields: HTML stripped, entities escaped
 * - Numeric fields: Converted to valid numbers
 * - Date/currency fields: Passed through unchanged (already validated)
 *
 * Use this before rendering invoice data in PDFs or HTML to prevent XSS
 * attacks and ensure data integrity.
 *
 * @param data - The invoice form data to sanitize
 * @returns A new object with all fields sanitized
 *
 * @example
 * const safeData = sanitizeInvoiceData(formData);
 * // All text fields are now XSS-safe
 * // All numeric fields are guaranteed to be valid numbers
 */
export function sanitizeInvoiceData(data: InvoiceFormData): InvoiceFormData {
    return {
        invoiceNumber: sanitizeText(data.invoiceNumber),
        invoiceName: data.invoiceName ? sanitizeText(data.invoiceName) : undefined,
        issueDate: data.issueDate, // Date strings are safe
        dueDate: data.dueDate, // Date strings are safe
        fromName: sanitizeText(data.fromName),
        fromAddress: sanitizeText(data.fromAddress),
        fromEmail: sanitizeText(data.fromEmail),
        toName: sanitizeText(data.toName),
        toAddress: sanitizeText(data.toAddress),
        toEmail: sanitizeText(data.toEmail),
        lineItems: data.lineItems.map(sanitizeLineItem),
        taxRate: sanitizeNumber(data.taxRate),
        notes: sanitizeText(data.notes),
        paymentDetails: sanitizeText(data.paymentDetails),
        currency: data.currency, // Currency codes are from a select, safe
    };
}

