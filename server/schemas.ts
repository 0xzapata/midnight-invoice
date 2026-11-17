/**
 * Request schemas for the API. Invoice payloads are first parsed with the
 * bounded *input* schemas below, completed with defaults, then validated with
 * the app's own `invoiceFormSchema` (src/lib/validation.ts) so the API accepts
 * exactly what the invoice form would.
 */
import { z } from 'zod';
import { invoiceFormSchema } from '@/lib/validation';
import { currencies } from '@/lib/currencies';
import { SCOPES } from '../shared/api';
import { INVOICE_STATUSES } from '../shared/invoice-status';

export const LIMITS = {
  /** Max JSON body for invoice/settings writes. */
  invoiceBodyBytes: 256 * 1024,
  /** Max JSON body for agent registration, token polling, approvals. */
  smallBodyBytes: 4 * 1024,
  maxLineItems: 200,
  shortText: 200,
  email: 254,
  address: 1000,
  lineDescription: 1000,
  longText: 5000,
  invoiceNumber: 64,
  id: 64,
  agentName: 100,
  agentDescription: 500,
  listMax: 1000,
};

const CURRENCY_CODES = new Set(currencies.map((c) => c.value));

const text = (max: number) => z.string().max(max, `Must be at most ${max} characters`);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Invalid date');

export const isoDateTime = z.iso.datetime({ offset: true });

export const currencyCode = z
  .string()
  .refine((v) => CURRENCY_CODES.has(v), 'Unsupported currency code (use an ISO 4217 code such as USD)');

const money = z.number().finite().min(0, 'Must be 0 or greater').max(1e12, 'Too large');

export const lineItemInputSchema = z.object({
  id: z.string().min(1).max(LIMITS.id).optional(),
  description: text(LIMITS.lineDescription).min(1, 'Description is required'),
  quantity: z.number().finite().min(0, 'Quantity must be 0 or greater').max(1e9, 'Too large'),
  price: money,
});

const invoiceFields = {
  invoiceNumber: text(LIMITS.invoiceNumber).trim().min(1, 'Invoice number is required'),
  invoiceName: text(LIMITS.shortText),
  issueDate: isoDate,
  dueDate: z.union([isoDate, z.literal('')]),
  fromName: text(LIMITS.shortText),
  fromAddress: text(LIMITS.address),
  fromEmail: text(LIMITS.email),
  toName: text(LIMITS.shortText),
  toAddress: text(LIMITS.address),
  toEmail: text(LIMITS.email),
  lineItems: z.array(lineItemInputSchema).min(1, 'At least one line item is required').max(LIMITS.maxLineItems, `At most ${LIMITS.maxLineItems} line items`),
  taxRate: z.number().finite().min(0, 'Tax rate must be 0 or greater').max(100, 'Tax rate cannot exceed 100%'),
  notes: text(LIMITS.longText),
  paymentDetails: text(LIMITS.longText),
  currency: currencyCode,
  status: z.enum(INVOICE_STATUSES),
  sentAt: z.union([isoDate, z.literal(''), z.null()]),
  paidAt: z.union([isoDate, z.literal(''), z.null()]),
};

/** Reference to a saved client (`null` = no client). See server/services/invoiceClients.ts. */
const clientIdRef = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a client id (UUID)')
  .transform((v) => v.toLowerCase())
  .nullable();

/** POST /invoices and PUT /invoices/:id body. Unknown keys (e.g. totals echoed back) are stripped. */
export const invoiceInputSchema = z.object({
  invoiceNumber: invoiceFields.invoiceNumber.optional(),
  invoiceName: invoiceFields.invoiceName.optional(),
  issueDate: invoiceFields.issueDate.optional(),
  dueDate: invoiceFields.dueDate.optional(),
  fromName: invoiceFields.fromName.optional(),
  fromAddress: invoiceFields.fromAddress.optional(),
  fromEmail: invoiceFields.fromEmail.optional(),
  toName: invoiceFields.toName.optional(),
  toAddress: invoiceFields.toAddress.optional(),
  toEmail: invoiceFields.toEmail.optional(),
  lineItems: invoiceFields.lineItems,
  taxRate: invoiceFields.taxRate.optional(),
  notes: invoiceFields.notes.optional(),
  paymentDetails: invoiceFields.paymentDetails.optional(),
  currency: invoiceFields.currency.optional(),
  status: invoiceFields.status.optional(),
  sentAt: invoiceFields.sentAt.optional(),
  paidAt: invoiceFields.paidAt.optional(),
  createdAt: isoDateTime.optional(),
  id: z.string().optional(),
  clientId: clientIdRef.optional(),
});
export type InvoiceInputParsed = z.infer<typeof invoiceInputSchema>;

/** PATCH /invoices/:id body: any subset; `lineItems` replaces the list. */
export const invoicePatchSchema = z.object({
  invoiceNumber: invoiceFields.invoiceNumber.optional(),
  invoiceName: invoiceFields.invoiceName.optional(),
  issueDate: invoiceFields.issueDate.optional(),
  dueDate: invoiceFields.dueDate.optional(),
  fromName: invoiceFields.fromName.optional(),
  fromAddress: invoiceFields.fromAddress.optional(),
  fromEmail: invoiceFields.fromEmail.optional(),
  toName: invoiceFields.toName.optional(),
  toAddress: invoiceFields.toAddress.optional(),
  toEmail: invoiceFields.toEmail.optional(),
  lineItems: invoiceFields.lineItems.optional(),
  taxRate: invoiceFields.taxRate.optional(),
  notes: invoiceFields.notes.optional(),
  paymentDetails: invoiceFields.paymentDetails.optional(),
  currency: invoiceFields.currency.optional(),
  status: invoiceFields.status.optional(),
  sentAt: invoiceFields.sentAt.optional(),
  paidAt: invoiceFields.paidAt.optional(),
  id: z.string().optional(),
  clientId: clientIdRef.optional(),
});
export type InvoicePatchParsed = z.infer<typeof invoicePatchSchema>;

/** Final check on the completed invoice: the app's form schema. */
export const storedInvoiceSchema = invoiceFormSchema;

export const settingsSchema = z.object({
  fromName: text(LIMITS.shortText),
  fromEmail: text(LIMITS.email).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email format'),
  fromAddress: text(LIMITS.address),
  paymentDetails: text(LIMITS.longText),
  notes: text(LIMITS.longText),
  taxRate: invoiceFields.taxRate,
  currency: currencyCode,
});

export const scopeSchema = z.enum(SCOPES);

export const scopeListSchema = z
  .array(scopeSchema)
  .min(1, 'At least one scope is required')
  .max(SCOPES.length)
  .refine((s) => new Set(s).size === s.length, 'Scopes must not repeat');

export const registerAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(LIMITS.agentName),
  description: z.string().trim().max(LIMITS.agentDescription).optional(),
  scopes: scopeListSchema,
});

export const approveAgentSchema = z.object({ scopes: scopeListSchema.optional() });

export const tokenRequestSchema = z.object({ device_code: z.string().min(1).max(200) });

export const listInvoicesQuerySchema = z.object({
  updated_since: isoDateTime.optional(),
  after_id: z.string().min(1).max(LIMITS.id).optional(),
  include_deleted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.listMax).optional(),
  // Status / due-date filters (comma list of statuses, plus the virtual "overdue").
  status: z
    .string()
    .max(100)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum([...INVOICE_STATUSES, 'overdue'])).min(1, 'At least one status'))
    .optional(),
  due_before: isoDate.optional(),
  due_after: isoDate.optional(),
  client: z.string().trim().min(1).max(LIMITS.shortText).optional(),
  client_id: clientIdRef.unwrap().optional(),
});

export const summaryQuerySchema = z.object({
  oldest_overdue_limit: z.coerce.number().int().min(0).max(50).optional(),
});

export const markSentSchema = z.object({ sentAt: isoDate.optional() });
export const markPaidSchema = z.object({ paidAt: isoDate.optional() });

/** Turns a ZodError into `details` for a 400 response. */
export function zodDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
