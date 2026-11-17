/**
 * Data access for saved clients. Same rules as repository.ts: parameterised
 * statements only, every query scoped by workspace_id, D1's clock for all
 * timestamps, single-statement atomic writes.
 */
import type { Actor } from '../../shared/types/invoice';

const DB_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export interface ClientRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  data: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
}

/** Client body persisted in `clients.data` (JSON). */
export interface StoredClientData {
  version: number;
  name: string;
  email: string;
  address: string;
  defaultCurrency: string | null;
  defaultTaxRate: number | null;
  paymentTermsDays: number | null;
  notes: string;
  archivedAt: string | null;
}

const CLIENT_COLUMNS = 'id, workspace_id, name, email, data, revision, created_at, updated_at, deleted_at, created_by, updated_by';

/** Escapes LIKE wildcards; used with `ESCAPE '\'`. */
const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createClientRepository(db: D1Database) {
  return {
    async getClient(workspaceId: string, id: string): Promise<ClientRow | null> {
      return db
        .prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE workspace_id = ? AND id = ?`)
        .bind(workspaceId, id)
        .first<ClientRow>();
    },

    /**
     * Lists clients ordered by (updated_at, id) for keyset pagination, like
     * listInvoices. `q` matches name or email (case-insensitive substring).
     * Returns D1's clock *before* the read (same transaction) as `syncedAt`.
     */
    async listClients(args: {
      workspaceId: string;
      q?: string;
      updatedSince?: string;
      afterId?: string;
      includeDeleted: boolean;
      limit: number;
    }): Promise<{ rows: ClientRow[]; syncedAt: string }> {
      const where = ['workspace_id = ?'];
      const params: unknown[] = [args.workspaceId];
      if (args.updatedSince && args.afterId) {
        where.push('(updated_at > ? OR (updated_at = ? AND id > ?))');
        params.push(args.updatedSince, args.updatedSince, args.afterId);
      } else if (args.updatedSince) {
        where.push('updated_at >= ?');
        params.push(args.updatedSince);
      }
      if (!args.includeDeleted) where.push('deleted_at IS NULL');
      if (args.q) {
        where.push(`(lower(name) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')`);
        params.push(likePattern(args.q), likePattern(args.q));
      }
      params.push(args.limit);
      const [now, list] = await db.batch([
        db.prepare(`SELECT ${DB_NOW} AS now`),
        db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE ${where.join(' AND ')} ORDER BY updated_at, id LIMIT ?`).bind(...params),
      ]);
      return { syncedAt: (now.results[0] as { now: string }).now, rows: list.results as unknown as ClientRow[] };
    },

    /** Live invoices per client id (uses the generated invoices.client_id column). */
    async countInvoicesByClient(workspaceId: string, clientIds: string[]): Promise<Map<string, number>> {
      const counts = new Map<string, number>();
      // Stay well below D1's bound-parameter limit (100) per statement.
      for (let i = 0; i < clientIds.length; i += 90) {
        const chunk = clientIds.slice(i, i + 90);
        const { results } = await db
          .prepare(
            `SELECT client_id, COUNT(*) AS n FROM invoices
              WHERE workspace_id = ? AND deleted_at IS NULL AND client_id IN (${chunk.map(() => '?').join(', ')})
              GROUP BY client_id`,
          )
          .bind(workspaceId, ...chunk)
          .all<{ client_id: string; n: number }>();
        for (const r of results) counts.set(r.client_id, r.n);
      }
      return counts;
    },

    /** Inserts a new client; null if the id already exists (live or tombstone). */
    async insertClient(args: { workspaceId: string; id: string; data: StoredClientData; createdAt: string | null; actor: Actor }): Promise<ClientRow | null> {
      const actor = JSON.stringify(args.actor);
      return db
        .prepare(
          `INSERT INTO clients (${CLIENT_COLUMNS})
           VALUES (?1, ?2, ?3, ?4, ?5, 1, COALESCE(?6, ${DB_NOW}), ${DB_NOW}, NULL, ?7, ?7)
           ON CONFLICT (workspace_id, id) DO NOTHING
           RETURNING ${CLIENT_COLUMNS}`,
        )
        .bind(args.id, args.workspaceId, args.data.name, args.data.email, JSON.stringify(args.data), args.createdAt, actor)
        .first<ClientRow>();
    },

    /** Replaces a live client's body; with `expectedRevision` only if it still matches. Null if nothing matched. */
    async updateClient(args: { workspaceId: string; id: string; data: StoredClientData; actor: Actor; expectedRevision?: number }): Promise<ClientRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?7';
      const params: unknown[] = [args.data.name, args.data.email, JSON.stringify(args.data), JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      return db
        .prepare(
          `UPDATE clients
              SET name = ?1, email = ?2, data = ?3, updated_by = ?4, revision = revision + 1, updated_at = ${DB_NOW}
            WHERE workspace_id = ?5 AND id = ?6 AND deleted_at IS NULL${revisionClause}
        RETURNING ${CLIENT_COLUMNS}`,
        )
        .bind(...params)
        .first<ClientRow>();
    },

    /** Soft delete (tombstone). Null if nothing matched. */
    async softDeleteClient(args: { workspaceId: string; id: string; actor: Actor; expectedRevision?: number }): Promise<ClientRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?4';
      const params: unknown[] = [JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      return db
        .prepare(
          `UPDATE clients
              SET deleted_at = ${DB_NOW}, updated_at = ${DB_NOW}, updated_by = ?1, revision = revision + 1
            WHERE workspace_id = ?2 AND id = ?3 AND deleted_at IS NULL${revisionClause}
        RETURNING ${CLIENT_COLUMNS}`,
        )
        .bind(...params)
        .first<ClientRow>();
    },
  };
}

export type ClientRepository = ReturnType<typeof createClientRepository>;
