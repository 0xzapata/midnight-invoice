import { InvoiceFormData, LineItem } from '@/types/invoice';

/**
 * Sanitize text input for safe rendering in PDFs
 * - Removes potential script injections (HTML tags)
 * - Escapes HTML entities
 * - Normalizes whitespace (preserves line breaks)
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
 * Sanitize numeric input
 * Returns 0 if invalid, NaN, or not finite
 */
export function sanitizeNumber(input: number | string | undefined | null): number {
    if (input === undefined || input === null) return 0;
    const num = typeof input === 'string' ? parseFloat(input) : input;
    return isNaN(num) || !isFinite(num) ? 0 : num;
}

/**
 * Sanitize a single line item
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
 * Sanitize an entire invoice form data object
 * Safe for rendering in PDFs and preventing XSS
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
