/**
 * Data access for invoice templates. Same rules as repository.ts and
 * clientRepository.ts: parameterised statements only, every query scoped by
 * workspace_id, D1's clock for all timestamps, single-statement atomic writes.
 */
import type { Actor } from '../../shared/types/invoice';
import { firstWith, type WriteAttachment } from './repository';

const DB_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  data: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
}

/** Template body persisted in `templates.data` (JSON). */
export interface StoredTemplateData {
  version: number;
  name: string;
  description: string;
  clientId: string | null;
  lineItems: { id: string; description: string; quantity: number; price: number }[];
  taxRate: number | null;
  currency: string | null;
  notes: string;
  paymentDetails: string;
  paymentTermsDays: number | null;
  invoiceNamePattern: string;
  archivedAt: string | null;
}

const TEMPLATE_COLUMNS = 'id, workspace_id, name, data, revision, created_at, updated_at, deleted_at, created_by, updated_by';

/** Escapes LIKE wildcards; used with `ESCAPE '\'`. */
const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createTemplateRepository(db: D1Database) {
  return {
    async getTemplate(workspaceId: string, id: string): Promise<TemplateRow | null> {
      return db
        .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE workspace_id = ? AND id = ?`)
        .bind(workspaceId, id)
        .first<TemplateRow>();
    },

    /**
     * Lists templates ordered by (updated_at, id) for keyset pagination, like
     * listClients. `q` matches name or description (case-insensitive
     * substring). Returns D1's clock *before* the read as `syncedAt`.
     */
    async listTemplates(args: {
      workspaceId: string;
      q?: string;
      updatedSince?: string;
      afterId?: string;
      includeDeleted: boolean;
      limit: number;
    }): Promise<{ rows: TemplateRow[]; syncedAt: string }> {
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
        where.push(`(lower(name) LIKE ? ESCAPE '\\' OR lower(json_extract(data, '$.description')) LIKE ? ESCAPE '\\')`);
        params.push(likePattern(args.q), likePattern(args.q));
      }
      params.push(args.limit);
      const [now, list] = await db.batch([
        db.prepare(`SELECT ${DB_NOW} AS now`),
        db.prepare(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE ${where.join(' AND ')} ORDER BY updated_at, id LIMIT ?`).bind(...params),
      ]);
      return { syncedAt: (now.results[0] as { now: string }).now, rows: list.results as unknown as TemplateRow[] };
    },

    /** Inserts a new template; null if the id already exists (live or tombstone). */
    async insertTemplate(args: { workspaceId: string; id: string; data: StoredTemplateData; createdAt: string | null; actor: Actor }, also?: WriteAttachment): Promise<TemplateRow | null> {
      const actor = JSON.stringify(args.actor);
      const stmt = db
        .prepare(
          `INSERT INTO templates (${TEMPLATE_COLUMNS})
           VALUES (?1, ?2, ?3, ?4, 1, COALESCE(?5, ${DB_NOW}), ${DB_NOW}, NULL, ?6, ?6)
           ON CONFLICT (workspace_id, id) DO NOTHING
           RETURNING ${TEMPLATE_COLUMNS}`,
        )
        .bind(args.id, args.workspaceId, args.data.name, JSON.stringify(args.data), args.createdAt, actor);
      return firstWith<TemplateRow>(db, stmt, also);
    },

    /** Replaces a live template's body; with `expectedRevision` only if it still matches. Null if nothing matched. */
    async updateTemplate(args: { workspaceId: string; id: string; data: StoredTemplateData; actor: Actor; expectedRevision?: number }, also?: WriteAttachment): Promise<TemplateRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?6';
      const params: unknown[] = [args.data.name, JSON.stringify(args.data), JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      const stmt = db
        .prepare(
          `UPDATE templates
              SET name = ?1, data = ?2, updated_by = ?3, revision = revision + 1, updated_at = ${DB_NOW}
            WHERE workspace_id = ?4 AND id = ?5 AND deleted_at IS NULL${revisionClause}
        RETURNING ${TEMPLATE_COLUMNS}`,
        )
        .bind(...params);
      return firstWith<TemplateRow>(db, stmt, also);
    },

    /** Soft delete (tombstone). Null if nothing matched. */
    async softDeleteTemplate(args: { workspaceId: string; id: string; actor: Actor; expectedRevision?: number }, also?: WriteAttachment): Promise<TemplateRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?4';
      const params: unknown[] = [JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      const stmt = db
        .prepare(
          `UPDATE templates
              SET deleted_at = ${DB_NOW}, updated_at = ${DB_NOW}, updated_by = ?1, revision = revision + 1
            WHERE workspace_id = ?2 AND id = ?3 AND deleted_at IS NULL${revisionClause}
        RETURNING ${TEMPLATE_COLUMNS}`,
        )
        .bind(...params);
      return firstWith<TemplateRow>(db, stmt, also);
    },
  };
}

export type TemplateRepository = ReturnType<typeof createTemplateRepository>;
