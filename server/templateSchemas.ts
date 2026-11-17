/**
 * Request schemas for /api/v1/templates. Same conventions as
 * server/schemas.ts and clientSchemas.ts: bounded inputs, unknown keys
 * stripped (so a full response object can be sent back).
 */
import { z } from 'zod';
import { TEMPLATE_LIMITS } from '../shared/types/template';
import { currencyCode, invoiceInputSchema, isoDate, isoDateTime, LIMITS, lineItemInputSchema } from './schemas';

const text = (max: number) => z.string().max(max, `Must be at most ${max} characters`);

const uuidRef = (what: string) =>
  z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `Must be a ${what} id (UUID)`)
    .transform((v) => v.toLowerCase());

const templateLineItem = z.object({
  id: z.string().min(1).max(LIMITS.id).optional(),
  description: text(TEMPLATE_LIMITS.lineDescription).min(1, 'Description is required'),
  quantity: z.number().finite().min(0, 'Quantity must be 0 or greater').max(1e9, 'Too large'),
  price: z.number().finite().min(0, 'Must be 0 or greater').max(1e12, 'Too large'),
});

const templateFields = {
  name: text(TEMPLATE_LIMITS.name).trim().min(1, 'Template name is required'),
  description: text(TEMPLATE_LIMITS.description),
  clientId: uuidRef('client').nullable(),
  lineItems: z.array(templateLineItem).max(TEMPLATE_LIMITS.maxLineItems, `At most ${TEMPLATE_LIMITS.maxLineItems} line items`),
  taxRate: z.number().finite().min(0, 'Tax rate must be 0 or greater').max(100, 'Tax rate cannot exceed 100%').nullable(),
  currency: currencyCode.nullable(),
  notes: text(TEMPLATE_LIMITS.notes),
  paymentDetails: text(TEMPLATE_LIMITS.paymentDetails),
  paymentTermsDays: z
    .number()
    .int('Payment terms must be a whole number of days')
    .min(0, 'Payment terms must be 0 or more days')
    .max(TEMPLATE_LIMITS.maxPaymentTermsDays, `At most ${TEMPLATE_LIMITS.maxPaymentTermsDays} days`)
    .nullable(),
  invoiceNamePattern: text(TEMPLATE_LIMITS.invoiceNamePattern),
  archivedAt: isoDateTime.nullable(),
};

/** POST /templates and PUT /templates/:id. Only `name` is required. */
export const templateInputSchema = z.object({
  name: templateFields.name,
  description: templateFields.description.optional(),
  clientId: templateFields.clientId.optional(),
  lineItems: templateFields.lineItems.optional(),
  taxRate: templateFields.taxRate.optional(),
  currency: templateFields.currency.optional(),
  notes: templateFields.notes.optional(),
  paymentDetails: templateFields.paymentDetails.optional(),
  paymentTermsDays: templateFields.paymentTermsDays.optional(),
  invoiceNamePattern: templateFields.invoiceNamePattern.optional(),
  archivedAt: templateFields.archivedAt.optional(),
  createdAt: isoDateTime.optional(),
  id: z.string().optional(),
});
export type TemplateInputParsed = z.infer<typeof templateInputSchema>;

/** PATCH /templates/:id: any subset; `lineItems` replaces the list. */
export const templatePatchSchema = z.object({
  name: templateFields.name.optional(),
  description: templateFields.description.optional(),
  clientId: templateFields.clientId.optional(),
  lineItems: templateFields.lineItems.optional(),
  taxRate: templateFields.taxRate.optional(),
  currency: templateFields.currency.optional(),
  notes: templateFields.notes.optional(),
  paymentDetails: templateFields.paymentDetails.optional(),
  paymentTermsDays: templateFields.paymentTermsDays.optional(),
  invoiceNamePattern: templateFields.invoiceNamePattern.optional(),
  archivedAt: templateFields.archivedAt.optional(),
  id: z.string().optional(),
});
export type TemplatePatchParsed = z.infer<typeof templatePatchSchema>;

/**
 * POST /templates/:id/instantiate: explicit values for the new invoice, all
 * optional. Every field given wins over the template (lineItems replaces the
 * template's lines); `clientId: null` bills no saved client even if the
 * template has one. The invoice is always created as a draft.
 */
export const instantiateTemplateSchema = invoiceInputSchema
  .omit({ status: true, sentAt: true, paidAt: true, createdAt: true, id: true, templateId: true, lineItems: true })
  .extend({ lineItems: z.array(lineItemInputSchema).min(1, 'At least one line item is required').max(LIMITS.maxLineItems).optional(), issueDate: isoDate.optional() });
export type InstantiateTemplateParsed = z.infer<typeof instantiateTemplateSchema>;

export const listTemplatesQuerySchema = z.object({
  q: z.string().trim().max(TEMPLATE_LIMITS.name).optional(),
  updated_since: isoDateTime.optional(),
  after_id: z.string().min(1).max(LIMITS.id).optional(),
  include_deleted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.listMax).optional(),
});

/** Max JSON body for template writes (up to 200 lines of 1000 characters). */
export const TEMPLATE_BODY_BYTES = 256 * 1024;
