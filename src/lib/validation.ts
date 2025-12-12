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
