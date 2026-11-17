/**
 * Saved-client use-cases shared by the REST routes and the MCP tools. Same
 * sync contract as invoices (AGENT_API.md "Sync semantics"): revisions/ETags,
 * If-Match / If-None-Match, D1-clock `updatedAt`, soft deletes that are final,
 * an inclusive `updated_since` feed with keyset paging.
 *
 * Scopes: `clients:read` for reads, `clients:write` for create/update/
 * archive/delete (a soft delete removes only address-book data and never
 * touches invoices, and an update can already blank every field, so a
 * separate delete scope would not protect anything).
 */
import type { ApiClientRecord, ListClientsResponse } from '../../shared/api';
import type { Actor } from '../../shared/types/invoice';
import { actorOf, hasScope, requireScope } from '../auth';
import { clientInputSchema, clientPatchSchema, type ClientInputParsed, type ClientPatchParsed } from '../clientSchemas';
import { createClientRepository, type ClientRepository, type ClientRow, type StoredClientData } from '../db/clientRepository';
import { errors } from '../errors';
import { LIMITS, zodDetails } from '../schemas';
import { parseIfMatch, type RevisionPrecondition, type ServiceContext } from './invoices';
import { activityWrite, activityWriteIf, clientChangedInput, clientCreatedInput, labelOf } from './activity';

export { parseIfMatch };

export const CURRENT_CLIENT_VERSION = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const repos = new WeakMap<D1Database, ClientRepository>();
export function clientRepo(ctx: ServiceContext): ClientRepository {
  let repo = repos.get(ctx.deps.db);
  if (!repo) {
    repo = createClientRepository(ctx.deps.db);
    repos.set(ctx.deps.db, repo);
  }
  return repo;
}

export function parseClientId(id: string): string {
  if (!UUID_RE.test(id)) throw errors.badRequest('Client id must be a UUID', { id });
  return id.toLowerCase();
}

export function toApiClient(row: ClientRow, invoiceCount?: number): ApiClientRecord {
  const data = JSON.parse(row.data) as StoredClientData;
  return {
    id: row.id,
    name: data.name,
    email: data.email,
    address: data.address,
    defaultCurrency: data.defaultCurrency ?? null,
    defaultTaxRate: data.defaultTaxRate ?? null,
    paymentTermsDays: data.paymentTermsDays ?? null,
    notes: data.notes ?? '',
    archivedAt: data.archivedAt ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    createdBy: JSON.parse(row.created_by) as Actor,
    updatedBy: JSON.parse(row.updated_by) as Actor,
    ...(invoiceCount === undefined ? {} : { invoiceCount }),
  };
}

function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import('zod').ZodError } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw errors.validation(zodDetails(result.error));
  return result.data;
}

function rejectBodyIdMismatch(bodyId: string | undefined, id: string) {
  if (bodyId !== undefined && bodyId.toLowerCase() !== id) throw errors.badRequest('Body id does not match the URL id', { bodyId, id });
}

const canonicalTime = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString() : null);

function toStored(input: ClientInputParsed): StoredClientData {
  return {
    version: CURRENT_CLIENT_VERSION,
    name: input.name,
    email: input.email ?? '',
    address: input.address ?? '',
    defaultCurrency: input.defaultCurrency ?? null,
    defaultTaxRate: input.defaultTaxRate ?? null,
    paymentTermsDays: input.paymentTermsDays ?? null,
    notes: input.notes ?? '',
    archivedAt: canonicalTime(input.archivedAt),
  };
}

/** Adds `invoiceCount` for credentials that may read invoices. */
async function withCounts(ctx: ServiceContext, rows: ClientRow[]): Promise<ApiClientRecord[]> {
  if (!hasScope(ctx.principal, 'invoices:read') || rows.length === 0) return rows.map((r) => toApiClient(r));
  const live = rows.filter((r) => !r.deleted_at).map((r) => r.id);
  const counts = live.length ? await clientRepo(ctx).countInvoicesByClient(ctx.principal.workspaceId, live) : new Map<string, number>();
  return rows.map((r) => toApiClient(r, r.deleted_at ? undefined : (counts.get(r.id) ?? 0)));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listClients(
  ctx: ServiceContext,
  opts: { q?: string; updatedSince?: string; afterId?: string; includeDeleted?: boolean; limit?: number },
): Promise<ListClientsResponse> {
  requireScope(ctx.principal, 'clients:read');
  if (opts.afterId && !opts.updatedSince) throw errors.badRequest('after_id requires updated_since');
  const limit = opts.limit ?? LIMITS.listMax;
  const updatedSince = opts.updatedSince ? new Date(opts.updatedSince).toISOString() : undefined;
  const { rows, syncedAt } = await clientRepo(ctx).listClients({
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
    clients: await withCounts(ctx, page),
    syncedAt,
    hasMore,
    next: hasMore && last ? { updated_since: last.updated_at, after_id: last.id } : null,
  };
}

export async function getClient(ctx: ServiceContext, rawId: string): Promise<ApiClientRecord> {
  requireScope(ctx.principal, 'clients:read');
  const id = parseClientId(rawId);
  const row = await clientRepo(ctx).getClient(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Client not found');
  if (row.deleted_at) throw errors.gone('Client was deleted', { id, deletedAt: row.deleted_at });
  return (await withCounts(ctx, [row]))[0];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** POST /clients: server-generated id. */
export async function createClient(ctx: ServiceContext, body: unknown): Promise<ApiClientRecord> {
  requireScope(ctx.principal, 'clients:write');
  const input = parseOrThrow(clientInputSchema, body);
  const id = ctx.deps.ids.uuid();
  const row = await clientRepo(ctx).insertClient({
    workspaceId: ctx.principal.workspaceId,
    id,
    data: toStored(input),
    createdAt: null,
    actor: actorOf(ctx.principal),
  }, activityWrite(ctx, clientCreatedInput(ctx, id, input.name)));
  if (!row) throw errors.internal();
  return toApiClient(row, hasScope(ctx.principal, 'invoices:read') ? 0 : undefined);
}

async function raceOutcome(ctx: ServiceContext, id: string): Promise<never> {
  const now = await clientRepo(ctx).getClient(ctx.principal.workspaceId, id);
  if (!now) throw errors.notFound('Client not found');
  if (now.deleted_at) throw errors.gone('Client was deleted', { id, deletedAt: now.deleted_at });
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: now.revision });
}

/** PUT /clients/:id: create-or-replace with a client-chosen UUID (same rules as PUT /invoices/:id). */
export async function putClient(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  pre: { ifMatch?: RevisionPrecondition; ifNoneMatchAny?: boolean },
  attempt = 0,
): Promise<{ client: ApiClientRecord; created: boolean }> {
  requireScope(ctx.principal, 'clients:write');
  const id = parseClientId(rawId);
  const input = parseOrThrow(clientInputSchema, body);
  rejectBodyIdMismatch(input.id, id);
  const repo = clientRepo(ctx);
  const existing = await repo.getClient(ctx.principal.workspaceId, id);
  if (existing && pre.ifNoneMatchAny) throw errors.preconditionFailed('Client already exists', { id, currentRevision: existing.revision });
  if (existing?.deleted_at) throw errors.gone('Client was deleted and cannot be recreated with the same id', { id, deletedAt: existing.deleted_at });

  if (!existing) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Client does not exist', { id });
    const row = await repo.insertClient({
      workspaceId: ctx.principal.workspaceId,
      id,
      data: toStored(input),
      createdAt: canonicalTime(input.createdAt),
      actor: actorOf(ctx.principal),
    }, activityWrite(ctx, clientCreatedInput(ctx, id, input.name)));
    if (row) return { client: (await withCounts(ctx, [row]))[0], created: true };
    if (attempt === 0) return putClient(ctx, rawId, body, pre, 1);
    throw errors.conflict('Concurrent write to the same client, retry');
  }
  if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
    throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
  }
  const data = toStored(input);
  const row = await repo.updateClient({
    workspaceId: ctx.principal.workspaceId,
    id,
    data,
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  }, activityWriteIf(ctx, clientChangedInput(id, JSON.parse(existing.data) as StoredClientData, data)));
  if (!row) return raceOutcome(ctx, id);
  return { client: (await withCounts(ctx, [row]))[0], created: false };
}

/** PATCH /clients/:id: shallow merge with compare-and-retry (like PATCH /invoices/:id). */
export async function patchClient(ctx: ServiceContext, rawId: string, body: unknown, pre: { ifMatch?: RevisionPrecondition }): Promise<ApiClientRecord> {
  requireScope(ctx.principal, 'clients:write');
  const id = parseClientId(rawId);
  const patch: ClientPatchParsed = parseOrThrow(clientPatchSchema, body);
  rejectBodyIdMismatch(patch.id, id);
  const repo = clientRepo(ctx);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await repo.getClient(ctx.principal.workspaceId, id);
    if (!existing) throw errors.notFound('Client not found');
    if (existing.deleted_at) throw errors.gone('Client was deleted', { id, deletedAt: existing.deleted_at });
    if (typeof pre.ifMatch === 'number' && pre.ifMatch !== existing.revision) {
      throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
    }
    const current = JSON.parse(existing.data) as StoredClientData;
    const merged: StoredClientData = { ...current, version: CURRENT_CLIENT_VERSION };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === 'id') continue;
      (merged as unknown as Record<string, unknown>)[key] = key === 'archivedAt' ? canonicalTime(value as string | null) : value;
    }
    const row = await repo.updateClient({
      workspaceId: ctx.principal.workspaceId,
      id,
      data: merged,
      actor: actorOf(ctx.principal),
      expectedRevision: existing.revision,
    }, activityWriteIf(ctx, clientChangedInput(id, current, merged)));
    if (row) return (await withCounts(ctx, [row]))[0];
    if (typeof pre.ifMatch === 'number') return raceOutcome(ctx, id);
  }
  throw errors.conflict('Client is being modified concurrently, retry');
}

/** DELETE /clients/:id: soft delete; invoices that reference the client keep their copy of its details. */
export async function deleteClient(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition }): Promise<{ deleted: boolean }> {
  requireScope(ctx.principal, 'clients:write');
  const id = parseClientId(rawId);
  const repo = clientRepo(ctx);
  const row = await repo.softDeleteClient({
    workspaceId: ctx.principal.workspaceId,
    id,
    actor: actorOf(ctx.principal),
    expectedRevision: typeof pre.ifMatch === 'number' ? pre.ifMatch : undefined,
  }, activityWrite(ctx, { action: 'client.deleted', entity: { type: 'client', id } }, { labelSql: labelOf.client(ctx.principal.workspaceId, id) }));
  if (row) return { deleted: true };
  const existing = await repo.getClient(ctx.principal.workspaceId, id);
  if (!existing) throw errors.notFound('Client not found');
  if (existing.deleted_at) {
    if (pre.ifMatch !== undefined) throw errors.preconditionFailed('Client was already deleted', { id, currentRevision: existing.revision });
    return { deleted: false };
  }
  throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
}
