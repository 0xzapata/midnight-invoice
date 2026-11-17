/**
 * Invoices billed to a saved client (`clientId`).
 *
 * The invoice keeps its own snapshot of the client's details; `clientId` is
 * only a reference. When an invoice write names a client:
 *
 * - The client must be a live (not deleted) client of the same workspace, and
 *   the credential needs `clients:read` — unless the invoice already
 *   referenced that client (an unchanged reference is never re-checked, so
 *   old invoices stay editable after their client is deleted, and agents
 *   without `clients:read` can still edit invoices that carry a clientId;
 *   omitted fields are then filled from the client only while it is still
 *   readable).
 * - Omitted fields are filled in this order (first that applies wins):
 *     toName / toAddress / toEmail: request → client name / address / email
 *     currency: request → client.defaultCurrency → settings.currency
 *     taxRate:  request → client.defaultTaxRate  → settings.taxRate
 *     dueDate:  request → issueDate + client.paymentTermsDays → ""
 *   ("settings" = workspace settings, applied afterwards by withDefaults.)
 * - PATCH that sets a *different* client refills the to-fields the patch
 *   omits from the new client; it never changes currency, tax rate or due
 *   date of an existing invoice. PATCH `clientId: null` unlinks.
 */
import { addDaysIso } from '../../shared/types/client';
import { hasScope, requireScope } from '../auth';
import type { StoredClientData } from '../db/clientRepository';
import { errors } from '../errors';
import type { InvoiceInputParsed, InvoicePatchParsed } from '../schemas';
import { clientRepo } from './clients';
import type { ServiceContext } from './invoices';

async function loadLiveClient(ctx: ServiceContext, clientId: string): Promise<StoredClientData> {
  requireScope(ctx.principal, 'clients:read');
  const row = await clientRepo(ctx).getClient(ctx.principal.workspaceId, clientId);
  if (!row) {
    throw errors.validation([{ path: 'clientId', message: 'No client with this id exists in this workspace' }], 'Unknown client');
  }
  if (row.deleted_at) {
    throw errors.validation([{ path: 'clientId', message: 'This client was deleted; pick another client or omit clientId' }], 'Client was deleted');
  }
  return JSON.parse(row.data) as StoredClientData;
}

const TO_FIELDS = ['toName', 'toAddress', 'toEmail'] as const;

/**
 * POST / PUT: validates `clientId` and fills omitted fields from the client.
 * `currentClientId` is the stored invoice's reference (PUT on an existing invoice).
 */
export async function prefillInvoiceInput(
  ctx: ServiceContext,
  input: InvoiceInputParsed,
  today: string,
  currentClientId?: string,
): Promise<InvoiceInputParsed> {
  const clientId = input.clientId;
  if (!clientId) return { ...input, clientId: undefined };
  const needsFill =
    TO_FIELDS.some((f) => input[f] === undefined) || input.currency === undefined || input.taxRate === undefined || input.dueDate === undefined;
  let client: StoredClientData;
  if (clientId === currentClientId) {
    // Unchanged reference: fill from the client while it is still available, never fail because of it.
    if (!needsFill || !hasScope(ctx.principal, 'clients:read')) return input;
    const row = await clientRepo(ctx).getClient(ctx.principal.workspaceId, clientId);
    if (!row || row.deleted_at) return input;
    client = JSON.parse(row.data) as StoredClientData;
  } else {
    client = await loadLiveClient(ctx, clientId);
  }
  const issueDate = input.issueDate ?? today;
  return {
    ...input,
    toName: input.toName ?? client.name,
    toAddress: input.toAddress ?? client.address,
    toEmail: input.toEmail ?? client.email,
    currency: input.currency ?? client.defaultCurrency ?? undefined,
    taxRate: input.taxRate ?? client.defaultTaxRate ?? undefined,
    dueDate: input.dueDate ?? (client.paymentTermsDays != null ? addDaysIso(issueDate, client.paymentTermsDays) : undefined),
  };
}

/** PATCH: validates a changed `clientId` and refills the to-fields the patch omits. */
export async function prefillInvoicePatch(ctx: ServiceContext, patch: InvoicePatchParsed, currentClientId?: string): Promise<InvoicePatchParsed> {
  const clientId = patch.clientId;
  if (!clientId || clientId === currentClientId) return patch;
  const client = await loadLiveClient(ctx, clientId);
  return {
    ...patch,
    toName: patch.toName ?? client.name,
    toAddress: patch.toAddress ?? client.address,
    toEmail: patch.toEmail ?? client.email,
  };
}
