/**
 * Invoice use-cases shared by the REST routes and the MCP tools.
 * Sync semantics are documented in AGENT_API.md ("Sync semantics").
 */
import type { ApiInvoice, ListInvoicesResponse } from '../../shared/api';
import type { Actor, InvoiceFormData } from '../../shared/types/invoice';
import { DEFAULT_SETTINGS, type DefaultSettings } from '../../shared/settings';
import { calculateInvoiceTotals, formatInvoiceNumber, invoiceNumberValue } from '../../shared/invoice-totals';
import { daysOverdue, isOverdue, normalizeStatusFields, utcToday, type InvoiceStatusFields } from '../../shared/invoice-status';
import { CURRENT_INVOICE_VERSION } from '@/lib/storageMigrations';
import { actorOf, requireScope, type Principal } from '../auth';
import type { AppDeps } from '../deps';
import type { InvoiceListFilters, InvoiceRow, Repository, StoredInvoiceData } from '../db/repository';
import { errors } from '../errors';
import { statusForCreate, statusForPatch, statusForPut } from './statusFields';
import {
  invoiceInputSchema,
  invoicePatchSchema,
  LIMITS,
  storedInvoiceSchema,
  zodDetails,
  type InvoiceInputParsed,
  type InvoicePatchParsed,
} from '../schemas';
import { prefillInvoiceInput, prefillInvoicePatch } from './invoiceClients';

export interface ServiceContext {
  repo: Repository;
  deps: AppDeps;
  principal: Principal;
}

/** Precondition from an `If-Match` header: a revision number or `*`. */
export type RevisionPrecondition = number | '*' | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInvoiceId(id: string): string {
  if (!UUID_RE.test(id)) throw errors.badRequest('Invoice id must be a UUID', { id });
  return id.toLowerCase();
}

/** Parses `If-Match: "3"` / `W/"3"` / `3` / `*`. */
export function parseIfMatch(header: string | undefined | null): RevisionPrecondition {
  if (header === undefined || header === null || header.trim() === '') return undefined;
  const value = header.trim();
  if (value === '*') return '*';
  const match = /^(?:W\/)?"?(\d{1,15})"?$/.exec(value);
  if (!match) throw errors.badRequest('If-Match must be an ETag returned by this API, e.g. "3", or *');
  return Number(match[1]);
}

export function etagOf(invoice: Pick<ApiInvoice, 'revision'>): string {
  return `"${invoice.revision}"`;
}

export function toApiInvoice(row: InvoiceRow, todayDate: string = utcToday()): ApiInvoice {
  const data = JSON.parse(row.data) as StoredInvoiceData;
  const status = normalizeStatusFields(data, todayDate);
  return {
    ...data,
    id: row.id,
    invoiceNumber: row.invoice_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    createdBy: JSON.parse(row.created_by) as Actor,
    updatedBy: JSON.parse(row.updated_by) as Actor,
    ...calculateInvoiceTotals(data),
    ...status,
    isOverdue: isOverdue({ ...data, ...status }, todayDate),
    daysOverdue: daysOverdue({ ...data, ...status }, todayDate),
  };
}

export function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import('zod').ZodError } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw errors.validation(zodDetails(result.error));
  return result.data;
}

function assertUniqueLineItemIds(data: InvoiceFormData) {
  const ids = data.lineItems.map((li) => li.id);
  if (new Set(ids).size !== ids.length) {
    throw errors.validation([{ path: 'lineItems', message: 'Line item ids must be unique' }]);
  }
}

/** Final validation with the app's own form schema; returns the persisted shape. */
function finalize(data: InvoiceFormData & Partial<InvoiceStatusFields>, placeholderNumber = false): StoredInvoiceData {
  const candidate = placeholderNumber ? { ...data, invoiceNumber: 'INV-0000' } : data;
  const result = storedInvoiceSchema.safeParse(candidate);
  if (!result.success) throw errors.validation(zodDetails(result.error));
  assertUniqueLineItemIds(data);
  const stored: StoredInvoiceData = { ...data, version: CURRENT_INVOICE_VERSION };
  if (stored.invoiceName === undefined || stored.invoiceName === '') delete stored.invoiceName;
  if (!stored.clientId) delete stored.clientId;
  if (!stored.templateId) delete stored.templateId;
  return stored;
}

async function loadSettings(ctx: ServiceContext): Promise<DefaultSettings> {
  return (await ctx.repo.getSettings(ctx.principal.workspaceId))?.settings ?? DEFAULT_SETTINGS;
}

/** Completes a create/replace payload with workspace defaults. */
function withDefaults(input: InvoiceInputParsed, settings: DefaultSettings, today: string, uuid: () => string): InvoiceFormData {
  return {
    invoiceNumber: input.invoiceNumber ?? '',
    invoiceName: input.invoiceName,
    issueDate: input.issueDate ?? today,
    dueDate: input.dueDate ?? '',
    fromName: input.fromName ?? settings.fromName,
    fromAddress: input.fromAddress ?? settings.fromAddress,
    fromEmail: input.fromEmail ?? settings.fromEmail,
    toName: input.toName ?? '',
    toAddress: input.toAddress ?? '',
    toEmail: input.toEmail ?? '',
    lineItems: input.lineItems.map((li) => ({
      id: li.id ?? uuid(),
      description: li.description,
      quantity: li.quantity,
      price: li.price,
    })),
    taxRate: input.taxRate ?? settings.taxRate,
    notes: input.notes ?? '',
    paymentDetails: input.paymentDetails ?? settings.paymentDetails,
    currency: input.currency ?? settings.currency,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
  };
}

export function today(deps: AppDeps): string {
  return deps.clock().toISOString().slice(0, 10);
}

function rejectBodyIdMismatch(bodyId: string | undefined, id: string) {
  if (bodyId !== undefined && bodyId.toLowerCase() !== id) {
    throw errors.badRequest('Body id does not match the URL id', { bodyId, id });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Status / due-date / client filters from parsed list parameters (REST query or MCP args); undefined if none. */
export function listFiltersOf(q: {
  status?: string[];
  due_before?: string;
  due_after?: string;
  client?: string;
  client_id?: string;
}): Omit<InvoiceListFilters, 'today'> | undefined {
  const statuses = q.status?.filter((s) => s !== 'overdue');
  const overdue = q.status?.includes('overdue') ?? false;
  if (!q.status?.length && !q.due_before && !q.due_after && !q.client && !q.client_id) return undefined;
  return {
    statuses: statuses && statuses.length > 0 ? [...new Set(statuses)] : undefined,
    overdue,
    dueBefore: q.due_before,
    dueAfter: q.due_after,
    client: q.client,
    clientId: q.client_id,
  };
}

export async function listInvoices(
  ctx: ServiceContext,
  opts: { updatedSince?: string; afterId?: string; includeDeleted?: boolean; limit?: number; filters?: Omit<InvoiceListFilters, 'today'> },
): Promise<ListInvoicesResponse> {
  requireScope(ctx.principal, 'invoices:read');
  if (opts.afterId && !opts.updatedSince) throw errors.badRequest('after_id requires updated_since');
  const limit = opts.limit ?? LIMITS.listMax;
  // Normalise any offset to the canonical UTC form stored by D1 so string comparison is correct.
  const updatedSince = opts.updatedSince ? new Date(opts.updatedSince).toISOString() : undefined;
  const { rows, syncedAt } = await ctx.repo.listInvoices({
    workspaceId: ctx.principal.workspaceId,
    updatedSince,
    afterId: opts.afterId,
    includeDeleted: opts.includeDeleted ?? false,
    limit: limit + 1,
    filters: opts.filters ? { ...opts.filters, today: today(ctx.deps) } : undefined,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    invoices: page.map((row) => toApiInvoice(row, today(ctx.deps))),
    syncedAt,
    hasMore,
    next: hasMore && last ? { updated_since: last.updated_at, after_id: last.id } : null,
  };
}

export async function getInvoice(ctx: ServiceContext, rawId: string): Promise<ApiInvoice> {
  requireScope(ctx.principal, 'invoices:read');
  const id = parseInvoiceId(rawId);
  const row = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Invoice not found');
  if (row.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: row.deleted_at });
  return toApiInvoice(row, today(ctx.deps));
}

export async function nextInvoiceNumber(ctx: ServiceContext): Promise<string> {
  requireScope(ctx.principal, 'invoices:read');
  return formatInvoiceNumber((await ctx.repo.maxInvoiceNumberValue(ctx.principal.workspaceId)) + 1);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function insertNew(ctx: ServiceContext, id: string, data: StoredInvoiceData, createdAt: string | null) {
  const allocate = data.invoiceNumber === '';
  return ctx.repo.insertInvoice({
    workspaceId: ctx.principal.workspaceId,
    id,
    data,
    numberValue: allocate ? null : invoiceNumberValue(data.invoiceNumber),
    allocateNumber: allocate,
    createdAt,
    actor: actorOf(ctx.principal),
  });
}

/** POST /invoices: server-generated id; missing invoiceNumber is allocated atomically. */
export async function createInvoice(ctx: ServiceContext, body: unknown): Promise<ApiInvoice> {
  requireScope(ctx.principal, 'invoices:write');
  const input = await prefillInvoiceInput(ctx, parseOrThrow(invoiceInputSchema, body), today(ctx.deps));
  const settings = await loadSettings(ctx);
  const data = finalize(
    { ...withDefaults(input, settings, today(ctx.deps), ctx.deps.ids.uuid), ...statusForCreate(input, today(ctx.deps)) },
    input.invoiceNumber === undefined,
  );
  const row = await insertNew(ctx, ctx.deps.ids.uuid(), data, null);
  if (!row) throw errors.internal();
  return toApiInvoice(row, today(ctx.deps));
}

/**
 * PUT /invoices/:id: create-or-replace with a client-chosen UUID.
 * - absent → created (201), honouring body.createdAt;
 * - live → replaced (200), createdAt/createdBy kept; missing invoiceNumber keeps the current one;
 * - tombstone → 410 (deleted invoices are never resurrected);
 * - If-Match: "<revision>" must equal the current revision, else 412;
 *   If-None-Match: * makes it create-only (412 if the id exists).
 */
export async function putInvoice(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  pre: { ifMatch?: RevisionPrecondition; ifNoneMatchAny?: boolean },
  attempt = 0,
): Promise<{ invoice: ApiInvoice; created: boolean }> {
  requireScope(ctx.principal, 'invoices:write');
  const id = parseInvoiceId(rawId);
  const input = parseOrThrow(invoiceInputSchema, body);
  rejectBodyIdMismatch(input.id, id);
  const settings = await loadSettings(ctx);
  const existing = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);

  if (existing && pre.ifNoneMatchAny) throw errors.preconditionFailed('Invoice already exists', { id, currentRevision: existing.revision });
  if (existing?.deleted_at) throw errors.gone('Invoice was deleted and cannot be recreated with the same id', { id, deletedAt: existing.deleted_at });

  const storedClientId = existing ? (JSON.parse(existing.data) as StoredInvoiceData).clientId : undefined;
  const filled = await prefillInvoiceInput(ctx, input, today(ctx.deps), storedClientId);
  const completed = withDefaults(filled, settings, today(ctx.deps), ctx.deps.ids.uuid);

  if (!existing) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Invoice does not exist', { id });
    const data = finalize({ ...completed, ...statusForCreate(input, today(ctx.deps)) }, input.invoiceNumber === undefined);
    const row = await insertNew(ctx, id, data, input.createdAt ? new Date(input.createdAt).toISOString() : null);
    if (row) return { invoice: toApiInvoice(row, today(ctx.deps)), created: true };
    // Lost a race with a concurrent create of the same id: re-evaluate once as a replace.
    if (attempt === 0) return putInvoice(ctx, rawId, body, pre, 1);
    throw errors.conflict('Concurrent write to the same invoice, retry');
  }

  if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
    throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
  }
  if (input.invoiceNumber === undefined) completed.invoiceNumber = existing.invoice_number;
  const data = finalize({ ...completed, ...statusForPut(input, JSON.parse(existing.data) as StoredInvoiceData, today(ctx.deps)) });
  const row = await ctx.repo.updateInvoice({
    workspaceId: ctx.principal.workspaceId,
    id,
    data,
    numberValue: invoiceNumberValue(data.invoiceNumber),
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  });
  if (!row) return raceOutcome(ctx, id);
  return { invoice: toApiInvoice(row, today(ctx.deps)), created: false };
}

export async function raceOutcome(ctx: ServiceContext, id: string): Promise<never> {
  const now = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
  if (!now) throw errors.notFound('Invoice not found');
  if (now.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: now.deleted_at });
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: now.revision });
}

/**
 * PATCH /invoices/:id: shallow merge of the given fields onto the stored
 * invoice (lineItems replaces the list), then full validation. The
 * read-modify-write is guarded by the read revision and retried, so
 * concurrent patches never silently drop each other's fields.
 */
export async function patchInvoice(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  pre: { ifMatch?: RevisionPrecondition },
): Promise<ApiInvoice> {
  requireScope(ctx.principal, 'invoices:write');
  const id = parseInvoiceId(rawId);
  const patch: InvoicePatchParsed = parseOrThrow(invoicePatchSchema, body);
  rejectBodyIdMismatch(patch.id, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
    if (!existing) throw errors.notFound('Invoice not found');
    if (existing.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: existing.deleted_at });
    if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
      throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
    }
    const current = JSON.parse(existing.data) as StoredInvoiceData;
    const merged: InvoiceFormData = { ...current, invoiceNumber: existing.invoice_number };
    const effective = await prefillInvoicePatch(ctx, patch, current.clientId);
    for (const [key, value] of Object.entries(effective)) {
      if (value === undefined || key === 'id') continue;
      if (key === 'lineItems') {
        merged.lineItems = (value as NonNullable<InvoicePatchParsed['lineItems']>).map((li) => ({
          id: li.id ?? ctx.deps.ids.uuid(),
          description: li.description,
          quantity: li.quantity,
          price: li.price,
        }));
      } else {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    const data = finalize({ ...merged, ...statusForPatch(current, patch, today(ctx.deps)) });
    const row = await ctx.repo.updateInvoice({
      workspaceId: ctx.principal.workspaceId,
      id,
      data,
      numberValue: invoiceNumberValue(data.invoiceNumber),
      actor: actorOf(ctx.principal),
      expectedRevision: existing.revision,
    });
    if (row) return toApiInvoice(row, today(ctx.deps));
    if (typeof pre.ifMatch === 'number') return raceOutcome(ctx, id);
  }
  throw errors.conflict('Invoice is being modified concurrently, retry');
}

/** DELETE /invoices/:id: soft delete (tombstone). Idempotent: deleting a tombstone is a no-op. */
export async function deleteInvoice(
  ctx: ServiceContext,
  rawId: string,
  pre: { ifMatch?: RevisionPrecondition },
): Promise<{ deleted: boolean }> {
  requireScope(ctx.principal, 'invoices:delete');
  const id = parseInvoiceId(rawId);
  const row = await ctx.repo.softDeleteInvoice({
    workspaceId: ctx.principal.workspaceId,
    id,
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  });
  if (row) return { deleted: true };
  const existing = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
  if (!existing) throw errors.notFound('Invoice not found');
  if (existing.deleted_at) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Invoice was already deleted', { id, currentRevision: existing.revision });
    return { deleted: false };
  }
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
}

export async function getSettings(ctx: ServiceContext) {
  requireScope(ctx.principal, 'settings:read');
  const stored = await ctx.repo.getSettings(ctx.principal.workspaceId);
  return { settings: stored?.settings ?? DEFAULT_SETTINGS, updatedAt: stored?.updatedAt ?? null };
}
