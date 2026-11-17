import { z } from 'zod';

/**
 * Zod schema for line item validation.
 */
export const lineItemSchema = z.object({
    id: z.string(),
    description: z.string().min(1, 'Description is required'),
    quantity: z.number().min(0, 'Quantity must be 0 or greater'),
    price: z.number().min(0, 'Price must be 0 or greater'),
});

/**
 * Zod schema for invoice form data validation.
 * 
 * Validates:
 * - Required fields: invoiceNumber, issueDate
 * - Email format for fromEmail and toEmail (when provided)
 * - Tax rate between 0-100
 * - At least one line item
 * - Line items have valid quantity and price
 */
export const invoiceFormSchema = z.object({
    invoiceNumber: z.string().min(1, 'Invoice number is required'),
    invoiceName: z.string().optional(),
    issueDate: z.string().min(1, 'Issue date is required'),
    dueDate: z.string().optional(),
    fromName: z.string().min(1, 'Your name/company is required'),
    fromAddress: z.string().optional().default(''),
    fromEmail: z.string()
        .optional()
        .refine(
            (val) => !val || val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            'Invalid email format'
        )
        .default(''),
    toName: z.string().min(1, 'Client name/company is required'),
    toAddress: z.string().optional().default(''),
    toEmail: z.string()
        .optional()
        .refine(
            (val) => !val || val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            'Invalid email format'
        )
        .default(''),
    lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
    taxRate: z.number().min(0, 'Tax rate must be 0 or greater').max(100, 'Tax rate cannot exceed 100%'),
    notes: z.string().optional().default(''),
    paymentDetails: z.string().optional().default(''),
    currency: z.string().min(1, 'Currency is required'),
});

export type InvoiceFormSchema = z.infer<typeof invoiceFormSchema>;

/** What the invoice form calls each field, for messages shown outside the form. */
const FIELD_NAMES: Record<string, string> = {
    invoiceNumber: 'Invoice number',
    issueDate: 'Issue date',
    fromName: 'Your name / company',
    fromEmail: 'Your email',
    toName: 'Client name / company',
    toEmail: 'Client email',
    lineItems: 'Line items',
    taxRate: 'Tax rate',
    currency: 'Currency',
};

export interface InvoiceIssue {
    /** Form field name, e.g. `fromName` or `lineItems[1].description`. */
    field: string;
    /** Human-readable, e.g. "Line item 2: Description is required". */
    message: string;
}

/**
 * The problems that stop an invoice from being saved (and that the API would
 * reject on upload), checked with the same `invoiceFormSchema` as the form.
 * Empty when the invoice is valid.
 */
export function invoiceIssues(data: unknown): InvoiceIssue[] {
    const result = invoiceFormSchema.safeParse(data);
    if (result.success) return [];
    return result.error.issues.map((issue) => {
        const [head, index, sub] = issue.path;
        if (head === 'lineItems' && typeof index === 'number') {
            const field = sub === undefined ? `lineItems[${index}]` : `lineItems[${index}].${String(sub)}`;
            return { field, message: `Line item ${index + 1}: ${issue.message}` };
        }
        const field = issue.path.map(String).join('.') || 'invoice';
        const name = FIELD_NAMES[field];
        // "… is required" messages already name the field ("Your name/company is required").
        return { field, message: name && !/required/i.test(issue.message) ? `${name}: ${issue.message}` : issue.message };
    });
}
