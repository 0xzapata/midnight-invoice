/**
 * Request schemas for /api/v1/clients. Same conventions as server/schemas.ts:
 * bounded inputs, unknown keys stripped (so a full response object can be
 * sent back), emails validated like the invoice form.
 */
import { z } from 'zod';
import { CLIENT_LIMITS } from '../shared/types/client';
import { currencyCode, isoDateTime, LIMITS } from './schemas';

const text = (max: number) => z.string().max(max, `Must be at most ${max} characters`);
const email = text(CLIENT_LIMITS.email).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email format');

const clientFields = {
  name: text(CLIENT_LIMITS.name).trim().min(1, 'Client name is required'),
  email,
  address: text(CLIENT_LIMITS.address),
  defaultCurrency: currencyCode.nullable(),
  defaultTaxRate: z.number().finite().min(0, 'Tax rate must be 0 or greater').max(100, 'Tax rate cannot exceed 100%').nullable(),
  paymentTermsDays: z
    .number()
    .int('Payment terms must be a whole number of days')
    .min(0, 'Payment terms must be 0 or more days')
    .max(CLIENT_LIMITS.maxPaymentTermsDays, `At most ${CLIENT_LIMITS.maxPaymentTermsDays} days`)
    .nullable(),
  notes: text(CLIENT_LIMITS.notes),
  archivedAt: isoDateTime.nullable(),
};

/** POST /clients and PUT /clients/:id. Only `name` is required. */
export const clientInputSchema = z.object({
  name: clientFields.name,
  email: clientFields.email.optional(),
  address: clientFields.address.optional(),
  defaultCurrency: clientFields.defaultCurrency.optional(),
  defaultTaxRate: clientFields.defaultTaxRate.optional(),
  paymentTermsDays: clientFields.paymentTermsDays.optional(),
  notes: clientFields.notes.optional(),
  archivedAt: clientFields.archivedAt.optional(),
  createdAt: isoDateTime.optional(),
  id: z.string().optional(),
});
export type ClientInputParsed = z.infer<typeof clientInputSchema>;

/** PATCH /clients/:id: any subset. */
export const clientPatchSchema = z.object({
  name: clientFields.name.optional(),
  email: clientFields.email.optional(),
  address: clientFields.address.optional(),
  defaultCurrency: clientFields.defaultCurrency.optional(),
  defaultTaxRate: clientFields.defaultTaxRate.optional(),
  paymentTermsDays: clientFields.paymentTermsDays.optional(),
  notes: clientFields.notes.optional(),
  archivedAt: clientFields.archivedAt.optional(),
  id: z.string().optional(),
});
export type ClientPatchParsed = z.infer<typeof clientPatchSchema>;

export const listClientsQuerySchema = z.object({
  q: z.string().trim().max(CLIENT_LIMITS.name).optional(),
  updated_since: isoDateTime.optional(),
  after_id: z.string().min(1).max(LIMITS.id).optional(),
  include_deleted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.listMax).optional(),
});

/** Max JSON body for client writes. */
export const CLIENT_BODY_BYTES = 32 * 1024;
