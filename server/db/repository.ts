/**
 * Data-access layer: every SQL statement of the API lives in this file, or
 * in the per-collection files next to it (clientRepository.ts).
 *
 * Rules:
 * - All statements are parameterised (`?` placeholders, `.bind()`).
 * - Every query on invoices, agents and settings is scoped by workspace_id.
 * - Steps that must be atomic are single statements (D1 executes statements
 *   one at a time against a single SQLite primary) or a `db.batch()`, which
 *   D1 runs as one transaction.
 */
import type { Actor, InvoiceFormData } from '../../shared/types/invoice';
import type { DefaultSettings } from '../../shared/settings';
import type { Scope } from '../../shared/api';
import type { InvoiceStatusFields } from '../../shared/invoice-status';

/** D1's own clock, ISO-8601 with milliseconds. Used for all invoice timestamps. */
const DB_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface WorkspaceRow {
  id: string;
  created_at: string;
}

export interface RegistrationRow {
  id: string;
  user_code: string;
  name: string;
  description: string | null;
  requested_scopes: string;
  status: 'pending' | 'approved' | 'denied' | 'redeemed';
  workspace_id: string | null;
  approved_scopes: string | null;
  agent_id: string | null;
  created_at: number;
  expires_at: number;
  last_polled_at: number | null;
}

export interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface InvoiceRow {
  id: string;
  workspace_id: string;
  invoice_number: string;
  data: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
}

/** Invoice body persisted in `invoices.data` (JSON). Status fields are absent on rows written before statuses existed. */
export type StoredInvoiceData = InvoiceFormData & Partial<InvoiceStatusFields> & { version: number };

/**
 * Optional filters of the invoice listing (migration 0002 generated columns).
 * `statuses` and `overdue` are OR-ed (`status=sent,overdue`); the date and
 * client filters are AND-ed with them.
 */
export interface InvoiceListFilters {
  statuses?: string[];
  /** Include sent invoices with due_date < today. */
  overdue?: boolean;
  /** YYYY-MM-DD, the reference date for `overdue`. */
  today: string;
  /** due_date < dueBefore (invoices without a due date never match). */
  dueBefore?: string;
  /** due_date > dueAfter (invoices without a due date never match). */
  dueAfter?: string;
  /** Case-insensitive substring of toName. */
  client?: string;
  /** Exact saved-client reference (generated column invoices.client_id, migration 0003). */
  clientId?: string;
}

function invoiceFilterSql(f: InvoiceListFilters | undefined): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!f) return { where, params };
  const statusOr: string[] = [];
  if (f.statuses && f.statuses.length > 0) {
    statusOr.push(`status IN (${f.statuses.map(() => '?').join(', ')})`);
    params.push(...f.statuses);
  }
  if (f.overdue) {
    statusOr.push(`(status = 'sent' AND due_date <> '' AND due_date < ?)`);
    params.push(f.today);
  }
  if (statusOr.length > 0) where.push(`(${statusOr.join(' OR ')})`);
  if (f.dueBefore) {
    where.push(`(due_date <> '' AND due_date < ?)`);
    params.push(f.dueBefore);
  }
  if (f.dueAfter) {
    where.push(`(due_date <> '' AND due_date > ?)`);
    params.push(f.dueAfter);
  }
  if (f.client) {
    where.push('instr(lower(to_name), lower(?)) > 0');
    params.push(f.client);
  }
  if (f.clientId) {
    where.push('client_id = ?');
    params.push(f.clientId);
  }
  return { where, params };
}

const INVOICE_COLUMNS =
  'id, workspace_id, invoice_number, data, revision, created_at, updated_at, deleted_at, created_by, updated_by';

export function createRepository(db: D1Database) {
  return {
    // -----------------------------------------------------------------------
    // Workspaces
    // -----------------------------------------------------------------------
    async createWorkspace(id: string, tokenHash: string, createdAt: string): Promise<WorkspaceRow> {
      await db
        .prepare('INSERT INTO workspaces (id, token_hash, created_at) VALUES (?, ?, ?)')
        .bind(id, tokenHash, createdAt)
        .run();
      return { id, created_at: createdAt };
    },

    async findWorkspaceByTokenHash(tokenHash: string): Promise<WorkspaceRow | null> {
      return db.prepare('SELECT id, created_at FROM workspaces WHERE token_hash = ?').bind(tokenHash).first<WorkspaceRow>();
    },

    async findWorkspace(id: string): Promise<WorkspaceRow | null> {
      return db.prepare('SELECT id, created_at FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
    },

    /** Deletes the workspace and everything it owns in one transaction. */
    async deleteWorkspace(id: string): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM invoices WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM clients WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM templates WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM workspace_settings WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM agents WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM agent_registrations WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM workspaces WHERE id = ?').bind(id),
      ]);
    },

    // -----------------------------------------------------------------------
    // Agent registrations (device flow)
    // -----------------------------------------------------------------------
    async createRegistration(r: {
      id: string;
      deviceCodeHash: string;
      userCode: string;
      name: string;
      description: string | null;
      scopes: Scope[];
      createdAt: number;
      expiresAt: number;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO agent_registrations
             (id, device_code_hash, user_code, name, description, requested_scopes, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(r.id, r.deviceCodeHash, r.userCode, r.name, r.description, JSON.stringify(r.scopes), r.createdAt, r.expiresAt)
        .run();
    },

    /** Removes registrations that expired more than `olderThanMs` ago (housekeeping). */
    async purgeExpiredRegistrations(beforeMs: number): Promise<void> {
      await db.prepare('DELETE FROM agent_registrations WHERE expires_at < ?').bind(beforeMs).run();
    },

    /** A registration the user can still act on: pending and not expired. */
    async findPendingRegistrationByUserCode(userCode: string, nowMs: number): Promise<RegistrationRow | null> {
      return db
        .prepare(
          `SELECT * FROM agent_registrations
           WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
        )
        .bind(userCode, nowMs)
        .first<RegistrationRow>();
    },

    async findRegistrationByUserCode(userCode: string): Promise<RegistrationRow | null> {
      return db.prepare('SELECT * FROM agent_registrations WHERE user_code = ?').bind(userCode).first<RegistrationRow>();
    },

    /**
     * pending → approved|denied, atomically (only one decision can win).
     * Returns the updated row, or null if it was no longer pending/unexpired.
     */
    async decideRegistration(args: {
      userCode: string;
      workspaceId: string;
      decision: 'approved' | 'denied';
      scopes: Scope[] | null;
      nowMs: number;
    }): Promise<RegistrationRow | null> {
      return db
        .prepare(
          `UPDATE agent_registrations
              SET status = ?, workspace_id = ?, approved_scopes = ?, decided_at = ?
            WHERE user_code = ? AND status = 'pending' AND expires_at > ?
        RETURNING *`,
        )
        .bind(
          args.decision,
          args.workspaceId,
          args.scopes ? JSON.stringify(args.scopes) : null,
          args.nowMs,
          args.userCode,
          args.nowMs,
        )
        .first<RegistrationRow>();
    },

    async findRegistrationByDeviceCodeHash(hash: string): Promise<RegistrationRow | null> {
      return db.prepare('SELECT * FROM agent_registrations WHERE device_code_hash = ?').bind(hash).first<RegistrationRow>();
    },

    async touchRegistrationPoll(id: string, nowMs: number): Promise<void> {
      await db.prepare('UPDATE agent_registrations SET last_polled_at = ? WHERE id = ?').bind(nowMs, id).run();
    },

    /**
     * Atomically redeems an approved, unexpired registration and creates the
     * agent. Both statements run in one D1 transaction; the INSERT only
     * happens if this call's UPDATE won (it matches on the new agent id), so a
     * device code can be redeemed exactly once even under concurrent polls.
     */
    async redeemRegistration(args: {
      deviceCodeHash: string;
      agentId: string;
      keyHash: string;
      nowMs: number;
      createdAt: string;
    }): Promise<AgentRow | null> {
      const [, inserted] = await db.batch<AgentRow>([
        db
          .prepare(
            `UPDATE agent_registrations
                SET status = 'redeemed', agent_id = ?, last_polled_at = ?
              WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ?`,
          )
          .bind(args.agentId, args.nowMs, args.deviceCodeHash, args.nowMs),
        db
          .prepare(
            `INSERT INTO agents (id, workspace_id, name, description, scopes, key_hash, created_at)
             SELECT agent_id, workspace_id, name, description, approved_scopes, ?, ?
               FROM agent_registrations
              WHERE device_code_hash = ? AND status = 'redeemed' AND agent_id = ?
          RETURNING id, workspace_id, name, description, scopes, created_at, last_used_at, revoked_at`,
          )
          .bind(args.keyHash, args.createdAt, args.deviceCodeHash, args.agentId),
      ]);
      return inserted.results[0] ?? null;
    },

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    /** Active (non-revoked) agent for an API key hash. */
    async findActiveAgentByKeyHash(hash: string): Promise<AgentRow | null> {
      return db
        .prepare(
          `SELECT id, workspace_id, name, description, scopes, created_at, last_used_at, revoked_at
             FROM agents WHERE key_hash = ? AND revoked_at IS NULL`,
        )
        .bind(hash)
        .first<AgentRow>();
    },

    async listAgents(workspaceId: string): Promise<AgentRow[]> {
      const { results } = await db
        .prepare(
          `SELECT id, workspace_id, name, description, scopes, created_at, last_used_at, revoked_at
             FROM agents WHERE workspace_id = ? ORDER BY created_at DESC, id`,
        )
        .bind(workspaceId)
        .all<AgentRow>();
      return results;
    },

    /** Returns 'revoked' | 'already_revoked' | 'not_found'. */
    async revokeAgent(workspaceId: string, agentId: string, revokedAt: string): Promise<'revoked' | 'already_revoked' | 'not_found'> {
      const row = await db
        .prepare(
          `UPDATE agents SET revoked_at = COALESCE(revoked_at, ?)
            WHERE workspace_id = ? AND id = ?
        RETURNING revoked_at`,
        )
        .bind(revokedAt, workspaceId, agentId)
        .first<{ revoked_at: string }>();
      if (!row) return 'not_found';
      return row.revoked_at === revokedAt ? 'revoked' : 'already_revoked';
    },

    async touchAgentLastUsed(workspaceId: string, agentId: string, at: string, throttleBefore: string): Promise<void> {
      await db
        .prepare(
          `UPDATE agents SET last_used_at = ?
            WHERE workspace_id = ? AND id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
        )
        .bind(at, workspaceId, agentId, throttleBefore)
        .run();
    },

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------
    async getSettings(workspaceId: string): Promise<{ settings: DefaultSettings; updatedAt: string } | null> {
      const row = await db
        .prepare('SELECT data, updated_at FROM workspace_settings WHERE workspace_id = ?')
        .bind(workspaceId)
        .first<{ data: string; updated_at: string }>();
      return row ? { settings: JSON.parse(row.data) as DefaultSettings, updatedAt: row.updated_at } : null;
    },

    async putSettings(workspaceId: string, settings: DefaultSettings): Promise<{ updatedAt: string }> {
      const row = await db
        .prepare(
          `INSERT INTO workspace_settings (workspace_id, data, updated_at) VALUES (?, ?, ${DB_NOW})
           ON CONFLICT (workspace_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
           RETURNING updated_at`,
        )
        .bind(workspaceId, JSON.stringify(settings))
        .first<{ updated_at: string }>();
      return { updatedAt: row!.updated_at };
    },

    // -----------------------------------------------------------------------
    // Invoices
    // -----------------------------------------------------------------------
    async getInvoice(workspaceId: string, id: string): Promise<InvoiceRow | null> {
      return db
        .prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE workspace_id = ? AND id = ?`)
        .bind(workspaceId, id)
        .first<InvoiceRow>();
    },

    /**
     * Lists invoices ordered by (updated_at, id) for keyset pagination.
     * Returns D1's clock *before* the read (same transaction) as `syncedAt`.
     */
    async listInvoices(args: {
      workspaceId: string;
      updatedSince?: string;
      afterId?: string;
      includeDeleted: boolean;
      limit: number;
      filters?: InvoiceListFilters;
    }): Promise<{ rows: InvoiceRow[]; syncedAt: string }> {
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
      const filter = invoiceFilterSql(args.filters);
      where.push(...filter.where);
      params.push(...filter.params);
      params.push(args.limit);
      const [now, list] = await db.batch([
        db.prepare(`SELECT ${DB_NOW} AS now`),
        db
          .prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE ${where.join(' AND ')} ORDER BY updated_at, id LIMIT ?`)
          .bind(...params),
      ]);
      return {
        syncedAt: (now.results[0] as { now: string }).now,
        rows: list.results as unknown as InvoiceRow[],
      };
    },

    /** Bodies of all live, non-void invoices (input of the status summary). */
    async listLiveInvoiceBodies(workspaceId: string): Promise<{ id: string; invoice_number: string; data: string }[]> {
      const { results } = await db
        .prepare(`SELECT id, invoice_number, data FROM invoices WHERE workspace_id = ? AND deleted_at IS NULL AND status <> 'void'`)
        .bind(workspaceId)
        .all<{ id: string; invoice_number: string; data: string }>();
      return results;
    },

    /** Highest numeric invoice number among live invoices (same rule as the browser store). */
    async maxInvoiceNumberValue(workspaceId: string): Promise<number> {
      const row = await db
        .prepare('SELECT COALESCE(MAX(number_value), 0) AS max FROM invoices WHERE workspace_id = ? AND deleted_at IS NULL')
        .bind(workspaceId)
        .first<{ max: number }>();
      return row?.max ?? 0;
    },

    /**
     * Inserts a new invoice. With `allocateNumber`, the invoice number is
     * computed inside the same INSERT … SELECT statement (MAX + 1 over live
     * invoices), so concurrent creates can never receive the same number.
     * Returns null if the id already exists (live or tombstone).
     */
    async insertInvoice(args: {
      workspaceId: string;
      id: string;
      data: StoredInvoiceData;
      numberValue: number | null;
      allocateNumber: boolean;
      createdAt: string | null;
      actor: Actor;
    }): Promise<InvoiceRow | null> {
      const actor = JSON.stringify(args.actor);
      const createdAt = args.createdAt;
      const stmt = args.allocateNumber
        ? db
            .prepare(
              `INSERT INTO invoices (${INVOICE_COLUMNS}, number_value)
               SELECT ?1, ?2, 'INV-' || printf('%04d', seq.n), json_set(?3, '$.invoiceNumber', 'INV-' || printf('%04d', seq.n)),
                      1, COALESCE(?4, ${DB_NOW}), ${DB_NOW}, NULL, ?5, ?5, seq.n
                 FROM (SELECT COALESCE(MAX(number_value), 0) + 1 AS n
                         FROM invoices WHERE workspace_id = ?2 AND deleted_at IS NULL) AS seq
                WHERE true -- required by SQLite to parse an upsert on INSERT … SELECT
               ON CONFLICT (workspace_id, id) DO NOTHING
               RETURNING ${INVOICE_COLUMNS}`,
            )
            .bind(args.id, args.workspaceId, JSON.stringify(args.data), createdAt, actor)
        : db
            .prepare(
              `INSERT INTO invoices (${INVOICE_COLUMNS}, number_value)
               VALUES (?1, ?2, ?3, ?4, 1, COALESCE(?5, ${DB_NOW}), ${DB_NOW}, NULL, ?6, ?6, ?7)
               ON CONFLICT (workspace_id, id) DO NOTHING
               RETURNING ${INVOICE_COLUMNS}`,
            )
            .bind(args.id, args.workspaceId, args.data.invoiceNumber, JSON.stringify(args.data), createdAt, actor, args.numberValue);
      return stmt.first<InvoiceRow>();
    },

    /**
     * Replaces the body of a live invoice. With `expectedRevision`, only
     * succeeds if the stored revision still matches (optimistic concurrency).
     * Returns null if no row matched (missing, deleted or revision mismatch).
     */
    async updateInvoice(args: {
      workspaceId: string;
      id: string;
      data: StoredInvoiceData;
      numberValue: number | null;
      actor: Actor;
      expectedRevision?: number;
    }): Promise<InvoiceRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?6';
      const params: unknown[] = [
        args.data.invoiceNumber,
        JSON.stringify(args.data),
        args.numberValue,
        JSON.stringify(args.actor),
        args.workspaceId,
      ];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      params.push(args.id);
      const idParam = args.expectedRevision === undefined ? '?6' : '?7';
      return db
        .prepare(
          `UPDATE invoices
              SET invoice_number = ?1, data = ?2, number_value = ?3, updated_by = ?4,
                  revision = revision + 1, updated_at = ${DB_NOW}
            WHERE workspace_id = ?5 AND id = ${idParam} AND deleted_at IS NULL${revisionClause}
        RETURNING ${INVOICE_COLUMNS}`,
        )
        .bind(...params)
        .first<InvoiceRow>();
    },

    /** Soft delete: keeps the row as a tombstone for sync. Null if nothing matched. */
    async softDeleteInvoice(args: {
      workspaceId: string;
      id: string;
      actor: Actor;
      expectedRevision?: number;
    }): Promise<InvoiceRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?4';
      const params: unknown[] = [JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      return db
        .prepare(
          `UPDATE invoices
              SET deleted_at = ${DB_NOW}, updated_at = ${DB_NOW}, updated_by = ?1, revision = revision + 1
            WHERE workspace_id = ?2 AND id = ?3 AND deleted_at IS NULL${revisionClause}
        RETURNING ${INVOICE_COLUMNS}`,
        )
        .bind(...params)
        .first<InvoiceRow>();
    },

    // -----------------------------------------------------------------------
    // Fixed-window counters (consistent rate limiting for brute-force guards)
    // -----------------------------------------------------------------------
    async getCounter(key: string, windowStart: number): Promise<number> {
      const row = await db
        .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
        .bind(key, windowStart)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },

    async incrementCounter(key: string, windowStart: number): Promise<number> {
      const row = await db
        .prepare(
          `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT (key) DO UPDATE SET
             count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
             window_start = excluded.window_start
           RETURNING count`,
        )
        .bind(key, windowStart)
        .first<{ count: number }>();
      return row!.count;
    },

    async purgeCounters(beforeWindowStart: number): Promise<void> {
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(beforeWindowStart).run();
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
