/**
 * Invoice template use-cases shared by the REST routes and the MCP tools.
 * Same sync contract as invoices and clients (AGENT_API.md "Sync
 * semantics"): revisions/ETags, If-Match / If-None-Match, D1-clock
 * `updatedAt`, soft deletes that are final, an inclusive `updated_since` feed
 * with keyset paging.
 *
 * Scopes: `templates:read` for reads, `templates:write` for create/update/
 * archive/delete (like clients, a delete only removes the blueprint; invoices
 * made from it are snapshots and never change). Creating an invoice from a
 * template needs `invoices:write` + `templates:read` (+ `clients:read` when
 * the invoice is billed to a saved client, as for any invoice).
 *
 * A template's `clientId` follows the invoice rule (invoiceClients.ts): when
 * set or changed it must name a live client of the workspace and needs
 * `clients:read`; an unchanged reference is never re-checked, so a template
 * stays editable after its client is deleted.
 */
import type { ApiTemplate, InstantiateTemplateResponse, ListTemplatesResponse } from '../../shared/api';
import type { Actor } from '../../shared/types/invoice';
import { invoiceFieldsFromTemplate } from '../../shared/types/template';
import { placeholdersIn } from '../../shared/template-placeholders';
import { actorOf, hasScope, requireScope } from '../auth';
import { createTemplateRepository, type StoredTemplateData, type TemplateRepository, type TemplateRow } from '../db/templateRepository';
import { errors } from '../errors';
import { LIMITS } from '../schemas';
import {
  instantiateTemplateSchema,
  templateInputSchema,
  templatePatchSchema,
  type InstantiateTemplateParsed,
  type TemplateInputParsed,
  type TemplatePatchParsed,
} from '../templateSchemas';
import { clientRepo } from './clients';
import { createInvoice, nextInvoiceNumber, parseIfMatch, parseOrThrow, today, type RevisionPrecondition, type ServiceContext } from './invoices';
import type { StoredClientData } from '../db/clientRepository';

export { parseIfMatch };

export const CURRENT_TEMPLATE_VERSION = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const repos = new WeakMap<D1Database, TemplateRepository>();
export function templateRepo(ctx: ServiceContext): TemplateRepository {
  let repo = repos.get(ctx.deps.db);
  if (!repo) {
    repo = createTemplateRepository(ctx.deps.db);
    repos.set(ctx.deps.db, repo);
  }
  return repo;
}

export function parseTemplateId(id: string): string {
  if (!UUID_RE.test(id)) throw errors.badRequest('Template id must be a UUID', { id });
  return id.toLowerCase();
}

export function toApiTemplate(row: TemplateRow): ApiTemplate {
  const data = JSON.parse(row.data) as StoredTemplateData;
  return {
    id: row.id,
    name: data.name,
    description: data.description ?? '',
    clientId: data.clientId ?? null,
    lineItems: (data.lineItems ?? []).map(({ id, description, quantity, price }) => ({ id, description, quantity, price })),
    taxRate: data.taxRate ?? null,
    currency: data.currency ?? null,
    notes: data.notes ?? '',
    paymentDetails: data.paymentDetails ?? '',
    paymentTermsDays: data.paymentTermsDays ?? null,
    invoiceNamePattern: data.invoiceNamePattern ?? '',
    archivedAt: data.archivedAt ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    createdBy: JSON.parse(row.created_by) as Actor,
    updatedBy: JSON.parse(row.updated_by) as Actor,
  };
}

function rejectBodyIdMismatch(bodyId: string | undefined, id: string) {
  if (bodyId !== undefined && bodyId.toLowerCase() !== id) throw errors.badRequest('Body id does not match the URL id', { bodyId, id });
}

const canonicalTime = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString() : null);

function storedLines(ctx: ServiceContext, lines: TemplateInputParsed['lineItems']): StoredTemplateData['lineItems'] {
  const out = (lines ?? []).map((li) => ({ id: li.id ?? ctx.deps.ids.uuid(), description: li.description, quantity: li.quantity, price: li.price }));
  if (new Set(out.map((li) => li.id)).size !== out.length) {
    throw errors.validation([{ path: 'lineItems', message: 'Line item ids must be unique' }]);
  }
  return out;
}

function toStored(ctx: ServiceContext, input: TemplateInputParsed): StoredTemplateData {
  return {
    version: CURRENT_TEMPLATE_VERSION,
    name: input.name,
    description: input.description ?? '',
    clientId: input.clientId ?? null,
    lineItems: storedLines(ctx, input.lineItems),
    taxRate: input.taxRate ?? null,
    currency: input.currency ?? null,
    notes: input.notes ?? '',
    paymentDetails: input.paymentDetails ?? '',
    paymentTermsDays: input.paymentTermsDays ?? null,
    invoiceNamePattern: input.invoiceNamePattern ?? '',
    archivedAt: canonicalTime(input.archivedAt),
  };
}

/** A newly set or changed template clientId must be a live client of this workspace (needs clients:read). */
async function checkClientRef(ctx: ServiceContext, clientId: string | null | undefined, currentClientId: string | null | undefined): Promise<void> {
  if (!clientId || clientId === currentClientId) return;
  requireScope(ctx.principal, 'clients:read');
  const row = await clientRepo(ctx).getClient(ctx.principal.workspaceId, clientId);
  if (!row) throw errors.validation([{ path: 'clientId', message: 'No client with this id exists in this workspace' }], 'Unknown client');
  if (row.deleted_at) throw errors.validation([{ path: 'clientId', message: 'This client was deleted; pick another client or use null' }], 'Client was deleted');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listTemplates(
  ctx: ServiceContext,
  opts: { q?: string; updatedSince?: string; afterId?: string; includeDeleted?: boolean; limit?: number },
): Promise<ListTemplatesResponse> {
  requireScope(ctx.principal, 'templates:read');
  if (opts.afterId && !opts.updatedSince) throw errors.badRequest('after_id requires updated_since');
  const limit = opts.limit ?? LIMITS.listMax;
  const updatedSince = opts.updatedSince ? new Date(opts.updatedSince).toISOString() : undefined;
  const { rows, syncedAt } = await templateRepo(ctx).listTemplates({
    workspaceId: ctx.principal.workspaceId,
    q: opts.q || undefined,
    updatedSince,
    afterId: opts.afterId,
    includeDeleted: opts.includeDeleted ?? false,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    templates: page.map(toApiTemplate),
    syncedAt,
    hasMore,
    next: hasMore && last ? { updated_since: last.updated_at, after_id: last.id } : null,
  };
}

async function loadLiveTemplate(ctx: ServiceContext, rawId: string): Promise<TemplateRow> {
  const id = parseTemplateId(rawId);
  const row = await templateRepo(ctx).getTemplate(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Template not found');
  if (row.deleted_at) throw errors.gone('Template was deleted', { id, deletedAt: row.deleted_at });
  return row;
}

export async function getTemplate(ctx: ServiceContext, rawId: string): Promise<ApiTemplate> {
  requireScope(ctx.principal, 'templates:read');
  return toApiTemplate(await loadLiveTemplate(ctx, rawId));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** POST /templates: server-generated id. */
export async function createTemplate(ctx: ServiceContext, body: unknown): Promise<ApiTemplate> {
  requireScope(ctx.principal, 'templates:write');
  const input = parseOrThrow(templateInputSchema, body);
  await checkClientRef(ctx, input.clientId, undefined);
  const row = await templateRepo(ctx).insertTemplate({
    workspaceId: ctx.principal.workspaceId,
    id: ctx.deps.ids.uuid(),
    data: toStored(ctx, input),
    createdAt: null,
    actor: actorOf(ctx.principal),
  });
  if (!row) throw errors.internal();
  return toApiTemplate(row);
}

async function raceOutcome(ctx: ServiceContext, id: string): Promise<never> {
  const now = await templateRepo(ctx).getTemplate(ctx.principal.workspaceId, id);
  if (!now) throw errors.notFound('Template not found');
  if (now.deleted_at) throw errors.gone('Template was deleted', { id, deletedAt: now.deleted_at });
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: now.revision });
}

/** PUT /templates/:id: create-or-replace with a client-chosen UUID (same rules as PUT /clients/:id). */
export async function putTemplate(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  pre: { ifMatch?: RevisionPrecondition; ifNoneMatchAny?: boolean },
  attempt = 0,
): Promise<{ template: ApiTemplate; created: boolean }> {
  requireScope(ctx.principal, 'templates:write');
  const id = parseTemplateId(rawId);
  const input = parseOrThrow(templateInputSchema, body);
  rejectBodyIdMismatch(input.id, id);
  const repo = templateRepo(ctx);
  const existing = await repo.getTemplate(ctx.principal.workspaceId, id);
  if (existing && pre.ifNoneMatchAny) throw errors.preconditionFailed('Template already exists', { id, currentRevision: existing.revision });
  if (existing?.deleted_at) throw errors.gone('Template was deleted and cannot be recreated with the same id', { id, deletedAt: existing.deleted_at });
  const currentClientId = existing ? (JSON.parse(existing.data) as StoredTemplateData).clientId : undefined;
  await checkClientRef(ctx, input.clientId, currentClientId);

  if (!existing) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Template does not exist', { id });
    const row = await repo.insertTemplate({
      workspaceId: ctx.principal.workspaceId,
      id,
      data: toStored(ctx, input),
      createdAt: canonicalTime(input.createdAt),
      actor: actorOf(ctx.principal),
    });
    if (row) return { template: toApiTemplate(row), created: true };
    if (attempt === 0) return putTemplate(ctx, rawId, body, pre, 1);
    throw errors.conflict('Concurrent write to the same template, retry');
  }
  if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
    throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
  }
  const row = await repo.updateTemplate({
    workspaceId: ctx.principal.workspaceId,
    id,
    data: toStored(ctx, input),
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  });
  if (!row) return raceOutcome(ctx, id);
  return { template: toApiTemplate(row), created: false };
}

/** PATCH /templates/:id: shallow merge (lineItems replaces the list) with compare-and-retry. */
export async function patchTemplate(ctx: ServiceContext, rawId: string, body: unknown, pre: { ifMatch?: RevisionPrecondition }): Promise<ApiTemplate> {
  requireScope(ctx.principal, 'templates:write');
  const id = parseTemplateId(rawId);
  const patch: TemplatePatchParsed = parseOrThrow(templatePatchSchema, body);
  rejectBodyIdMismatch(patch.id, id);
  const repo = templateRepo(ctx);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await repo.getTemplate(ctx.principal.workspaceId, id);
    if (!existing) throw errors.notFound('Template not found');
    if (existing.deleted_at) throw errors.gone('Template was deleted', { id, deletedAt: existing.deleted_at });
    if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
      throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
    }
    const current = JSON.parse(existing.data) as StoredTemplateData;
    await checkClientRef(ctx, patch.clientId, current.clientId);
    const merged: StoredTemplateData = { ...current, version: CURRENT_TEMPLATE_VERSION };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === 'id') continue;
      if (key === 'lineItems') merged.lineItems = storedLines(ctx, value as TemplatePatchParsed['lineItems']);
      else if (key === 'archivedAt') merged.archivedAt = canonicalTime(value as string | null);
      else (merged as unknown as Record<string, unknown>)[key] = value;
    }
    const row = await repo.updateTemplate({
      workspaceId: ctx.principal.workspaceId,
      id,
      data: merged,
      actor: actorOf(ctx.principal),
      expectedRevision: existing.revision,
    });
    if (row) return toApiTemplate(row);
    if (typeof pre.ifMatch === 'number') return raceOutcome(ctx, id);
  }
  throw errors.conflict('Template is being modified concurrently, retry');
}

/** DELETE /templates/:id: soft delete; invoices created from it are unaffected. */
export async function deleteTemplate(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition }): Promise<{ deleted: boolean }> {
  requireScope(ctx.principal, 'templates:write');
  const id = parseTemplateId(rawId);
  const repo = templateRepo(ctx);
  const row = await repo.softDeleteTemplate({
    workspaceId: ctx.principal.workspaceId,
    id,
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  });
  if (row) return { deleted: true };
  const existing = await repo.getTemplate(ctx.principal.workspaceId, id);
  if (!existing) throw errors.notFound('Template not found');
  if (existing.deleted_at) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Template was already deleted', { id, currentRevision: existing.revision });
    return { deleted: false };
  }
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
}

// ---------------------------------------------------------------------------
// Instantiate: template → new draft invoice
// ---------------------------------------------------------------------------

/**
 * POST /templates/:id/instantiate. Builds the invoice input with this
 * precedence (first that applies wins), then creates it like POST /invoices:
 *
 *   explicit request field → template → client defaults → workspace settings
 *
 * - clientId: request (null = none) → template.clientId (skipped with a
 *   warning if that client was deleted). Billing a saved client needs
 *   clients:read, as for any invoice.
 * - lineItems: request (replaces all) → template lines (fresh ids).
 * - dueDate: request → issueDate + template.paymentTermsDays → client terms → "".
 * - taxRate / currency: request → template → client defaults → settings;
 *   paymentDetails: request → template → settings; notes / invoiceName:
 *   request → template → none.
 * - Placeholders in the template's invoice name, line descriptions and notes
 *   are resolved against the issue date, the final Bill To name and the
 *   invoice number (computed up front when the template uses
 *   {{invoice_number}} and no number is given). Values given in the request
 *   are used as typed.
 * - The invoice is a draft and records templateId.
 */
export async function instantiateTemplate(ctx: ServiceContext, rawId: string, body: unknown): Promise<InstantiateTemplateResponse> {
  requireScope(ctx.principal, 'templates:read');
  requireScope(ctx.principal, 'invoices:write');
  const req: InstantiateTemplateParsed = parseOrThrow(instantiateTemplateSchema, body ?? {});
  const template = toApiTemplate(await loadLiveTemplate(ctx, rawId));
  const warnings: string[] = [];
  const issueDate = req.issueDate ?? today(ctx.deps);

  // Which saved client: explicit (null = none) → the template's while it is a live client.
  let clientId: string | undefined;
  let client: StoredClientData | undefined;
  const candidate = req.clientId !== undefined ? (req.clientId ?? undefined) : (template.clientId ?? undefined);
  if (candidate) {
    requireScope(ctx.principal, 'clients:read');
    const row = await clientRepo(ctx).getClient(ctx.principal.workspaceId, candidate);
    if (row && !row.deleted_at) client = JSON.parse(row.data) as StoredClientData;
    // An explicit unknown or deleted id is rejected by the invoice validation below.
    if (client || req.clientId !== undefined) clientId = candidate;
    else warnings.push('The template’s default client no longer exists, so the invoice is not billed to a saved client.');
  }

  const usesInvoiceNumber = [template.invoiceNamePattern, template.notes, ...template.lineItems.map((li) => li.description)].some((t) =>
    placeholdersIn(t).includes('invoice_number'),
  );
  let invoiceNumber = req.invoiceNumber;
  if (invoiceNumber === undefined && usesInvoiceNumber) {
    if (hasScope(ctx.principal, 'invoices:read')) invoiceNumber = await nextInvoiceNumber(ctx);
    else warnings.push('{{invoice_number}} needs invoices:read (or an explicit invoiceNumber); it was left as is.');
  }

  // Only the template parts that are used: request values replace them and are taken verbatim.
  const application = invoiceFieldsFromTemplate(
    {
      ...template,
      clientId: null,
      lineItems: req.lineItems ? [] : template.lineItems,
      invoiceNamePattern: req.invoiceName !== undefined ? '' : template.invoiceNamePattern,
      notes: req.notes !== undefined ? '' : template.notes,
    },
    { issueDate, clientName: req.toName ?? client?.name, invoiceNumber },
    () => ctx.deps.ids.uuid(),
  );
  const input: Record<string, unknown> = { ...application.fields, ...req, issueDate, invoiceNumber, clientId, templateId: template.id };
  if (!req.lineItems) input.lineItems = application.fields.lineItems;
  if ((input.lineItems as unknown[]).length === 0) {
    throw errors.validation([{ path: 'lineItems', message: 'This template has no line items; pass lineItems' }]);
  }
  // Undefined keys fall through to the client defaults and the workspace settings.
  for (const [k, v] of Object.entries(input)) if (v === undefined) delete input[k];

  const invoice = await createInvoice(ctx, input);
  return {
    invoice,
    template: { id: template.id, name: template.name, revision: template.revision },
    placeholders: { unknown: application.unknown, unresolved: application.unresolved },
    warnings,
  };
}
