/**
 * Status fields of invoice writes (POST, PUT, PATCH). The rules themselves
 * live in shared/invoice-status.ts and are the same in the browser.
 *
 * - create (POST, or PUT of a new id): `status` defaults to draft; any status
 *   may be given (an agent can record an already-paid invoice);
 * - PUT replace: a full-state write used by sync, so any status is accepted
 *   (the browser has already applied the transition rules locally, and a
 *   sequence of offline changes such as draft → sent → paid arrives as one
 *   PUT); an omitted status keeps the current one;
 * - PATCH: a status change must be an allowed transition (409
 *   invalid_status_transition otherwise), like the mark-* endpoints.
 */
import { normalizeStatusFields, transitionStatus, type InvoiceStatus, type InvoiceStatusFields } from '../../shared/invoice-status';
import { ApiError } from '../errors';

type StatusInput = { status?: InvoiceStatus; sentAt?: string | null; paidAt?: string | null };

const emptyToNull = (v: string | null | undefined) => (v === '' ? null : v);

export function invalidTransition(result: { from: InvoiceStatus; to: InvoiceStatus; allowed: readonly InvoiceStatus[]; message: string }) {
  return new ApiError(409, 'invalid_status_transition', result.message, {
    from: result.from,
    to: result.to,
    allowed: [...result.allowed],
  });
}

export function statusForCreate(input: StatusInput, today: string): InvoiceStatusFields {
  return normalizeStatusFields(input, today);
}

export function statusForPut(input: StatusInput, existing: StatusInput, today: string): InvoiceStatusFields {
  if (input.status === undefined) {
    return normalizeStatusFields(
      {
        status: existing.status,
        sentAt: input.sentAt !== undefined ? emptyToNull(input.sentAt) : existing.sentAt,
        paidAt: input.paidAt !== undefined ? emptyToNull(input.paidAt) : existing.paidAt,
      },
      today,
    );
  }
  return normalizeStatusFields(input, today);
}

export function statusForPatch(current: StatusInput, patch: StatusInput, today: string): InvoiceStatusFields {
  if (patch.status === undefined && patch.sentAt === undefined && patch.paidAt === undefined) {
    return normalizeStatusFields(current, today);
  }
  const target = patch.status ?? normalizeStatusFields(current, today).status;
  const result = transitionStatus(current, target, {
    today,
    sentAt: emptyToNull(patch.sentAt) ?? undefined,
    paidAt: emptyToNull(patch.paidAt) ?? undefined,
  });
  if (!result.ok) throw invalidTransition(result);
  return result.fields;
}
