/**
 * Request schemas for /api/v1/recurring (same conventions as
 * server/schemas.ts: bounded inputs, unknown keys stripped, so a full
 * response object can be sent back on PUT).
 */
import { z } from 'zod';
import { isValidTimeZone, RECURRING_AUTO_ACTIONS, RECURRING_FREQUENCIES, RECURRING_LIMITS } from '../../shared/recurring';
import { isoDate } from '../schemas';

const uuidRef = (what: string) =>
  z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `Must be a ${what} id (UUID)`)
    .transform((v) => v.toLowerCase());

export const RECURRING_FIELDS = {
  name: z.string().max(RECURRING_LIMITS.name, `Must be at most ${RECURRING_LIMITS.name} characters`).trim().min(1, 'Schedule name is required'),
  templateId: uuidRef('template'),
  clientId: uuidRef('client').nullable(),
  frequency: z.enum(RECURRING_FREQUENCIES),
  startDate: isoDate,
  timezone: z
    .string()
    .trim()
    .max(RECURRING_LIMITS.timezone)
    .refine(isValidTimeZone, 'Unknown time zone (use an IANA name such as Europe/Berlin or America/New_York)'),
  endDate: isoDate.nullable(),
  maxOccurrences: z
    .number()
    .int('Must be a whole number')
    .min(1, 'Must be at least 1')
    .max(RECURRING_LIMITS.maxOccurrences, `At most ${RECURRING_LIMITS.maxOccurrences}`)
    .nullable(),
  autoAction: z.enum(RECURRING_AUTO_ACTIONS),
  overrides: z.object({
    notes: z.string().max(RECURRING_LIMITS.notes, `Must be at most ${RECURRING_LIMITS.notes} characters`).nullable().optional(),
    taxRate: z.number().finite().min(0, 'Tax rate must be 0 or greater').max(100, 'Tax rate cannot exceed 100%').nullable().optional(),
  }),
};

const endAfterStart = (v: { startDate?: string; endDate?: string | null }) => !v.endDate || !v.startDate || v.endDate >= v.startDate;

/** POST /recurring and PUT /recurring/:id. */
export const recurringInputSchema = z
  .object({
    name: RECURRING_FIELDS.name,
    templateId: RECURRING_FIELDS.templateId,
    clientId: RECURRING_FIELDS.clientId.optional(),
    frequency: RECURRING_FIELDS.frequency,
    startDate: RECURRING_FIELDS.startDate,
    timezone: RECURRING_FIELDS.timezone.optional(),
    endDate: RECURRING_FIELDS.endDate.optional(),
    maxOccurrences: RECURRING_FIELDS.maxOccurrences.optional(),
    autoAction: RECURRING_FIELDS.autoAction.optional(),
    overrides: RECURRING_FIELDS.overrides.optional(),
    status: z.enum(['active', 'paused']).optional(),
    id: z.string().optional(),
  })
  .refine(endAfterStart, { path: ['endDate'], message: 'The end date must be on or after the start date' });
export type RecurringInputParsed = z.infer<typeof recurringInputSchema>;

/** PATCH /recurring/:id: any subset; `overrides` is merged key by key. */
export const recurringPatchSchema = z
  .object({
    name: RECURRING_FIELDS.name.optional(),
    templateId: RECURRING_FIELDS.templateId.optional(),
    clientId: RECURRING_FIELDS.clientId.optional(),
    frequency: RECURRING_FIELDS.frequency.optional(),
    startDate: RECURRING_FIELDS.startDate.optional(),
    timezone: RECURRING_FIELDS.timezone.optional(),
    endDate: RECURRING_FIELDS.endDate.optional(),
    maxOccurrences: RECURRING_FIELDS.maxOccurrences.optional(),
    autoAction: RECURRING_FIELDS.autoAction.optional(),
    overrides: RECURRING_FIELDS.overrides.optional(),
    id: z.string().optional(),
  })
  .refine(endAfterStart, { path: ['endDate'], message: 'The end date must be on or after the start date' });
export type RecurringPatchParsed = z.infer<typeof recurringPatchSchema>;

export const runNowSchema = z.object({ period: isoDate.optional() });

export const listRecurringQuerySchema = z.object({
  status: z
    .string()
    .max(50)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['active', 'paused', 'ended'])).min(1))
    .optional(),
  template_id: uuidRef('template').optional(),
});

export const previewQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(RECURRING_LIMITS.previewMax).optional(),
});
