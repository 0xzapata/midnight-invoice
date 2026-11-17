/**
 * Data access for the workspace activity log (migration 0006). Same rules as
 * repository.ts: parameterised statements, every query scoped by
 * workspace_id. The table is append-only: rows are inserted (or, for a
 * de-duplicated summary row, have their counter bumped) and only ever
 * deleted by retention pruning or workspace deletion.
 */

export interface ActivityRow {
  workspace_id: string;
  id: string;
  time: string;
  actor_type: 'user' | 'agent' | 'system';
  agent_id: string | null;
  agent_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  changes: string | null;
  source: 'rest' | 'mcp' | 'system';
  tool: string | null;
  request_id: string | null;
  dedupe_key: string | null;
}

export type ActivityInsert = Omit<ActivityRow, 'dedupe_key'> & { dedupe_key?: string | null };

/** How an insert behaves when a row with the same `dedupe_key` exists. */
export type DedupeMode = { mode: 'ignore' } | { mode: 'count'; counter: string };

export interface InsertOptions {
  /** SQL guard; `changes() > 0` makes the insert depend on the preceding statement of a batch. */
  when?: { sql: string; params: unknown[] };
  /** Label computed in SQL (e.g. the invoice number an INSERT just allocated); falls back to `entity_label`. */
  labelSql?: { sql: string; params: unknown[] };
  dedupe?: DedupeMode;
}

export interface ActivityQuery {
  workspaceId: string;
  /** Only entries whose actor is this agent. */
  actorAgentId?: string;
  /** Only entries by this actor type. */
  actorType?: 'user' | 'agent' | 'system';
  /** Entries by this agent or about it (entity agent:<id>). */
  involvingAgentId?: string;
  /** Prefix match, OR-ed. */
  actionPrefixes?: string[];
  entityType?: string;
  entityId?: string;
  since?: string;
  until?: string;
  /** Cursor: only ids strictly lower (older). */
  before?: string;
  limit: number;
}

const COLUMNS =
  'workspace_id, id, time, actor_type, agent_id, agent_name, action, entity_type, entity_id, entity_label, changes, source, tool, request_id, dedupe_key';

const COUNTER_RE = /^[a-z_]{1,32}$/;

export function createActivityRepository(db: D1Database) {
  return {
    /** Builds (does not run) the INSERT for one entry, for a batch or a direct `.run()`. */
    insertStatement(row: ActivityInsert, opts: InsertOptions = {}): D1PreparedStatement {
      const params: unknown[] = [
        row.workspace_id,
        row.id,
        row.time,
        row.actor_type,
        row.agent_id,
        row.agent_name,
        row.action,
        row.entity_type,
        row.entity_id,
      ];
      let label = '?';
      if (opts.labelSql) {
        label = `COALESCE((${opts.labelSql.sql}), ?)`;
        params.push(...opts.labelSql.params);
      }
      params.push(row.entity_label, row.changes, row.source, row.tool, row.request_id, row.dedupe_key ?? null);
      let where = 'true';
      if (opts.when) {
        where = opts.when.sql;
        params.push(...opts.when.params);
      }
      let conflict = '';
      if (opts.dedupe?.mode === 'ignore') {
        conflict = ' ON CONFLICT (workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING';
      } else if (opts.dedupe?.mode === 'count') {
        if (!COUNTER_RE.test(opts.dedupe.counter)) throw new Error('invalid activity counter name');
        const path = `'$.counts.${opts.dedupe.counter}'`;
        conflict =
          ' ON CONFLICT (workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET ' +
          `changes = json_set(COALESCE(activity.changes, '{}'), ${path}, COALESCE(json_extract(activity.changes, ${path}), 0) + 1)`;
      }
      // "WHERE <guard>" is always present: SQLite needs it to parse an upsert on INSERT … SELECT.
      return db
        .prepare(`INSERT INTO activity (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ${label}, ?, ?, ?, ?, ? WHERE ${where}${conflict}`)
        .bind(...params);
    },

    async list(q: ActivityQuery): Promise<ActivityRow[]> {
      const where = ['workspace_id = ?'];
      const params: unknown[] = [q.workspaceId];
      if (q.actorAgentId) {
        where.push(`actor_type = 'agent' AND agent_id = ?`);
        params.push(q.actorAgentId);
      }
      if (q.actorType) {
        where.push('actor_type = ?');
        params.push(q.actorType);
      }
      if (q.involvingAgentId) {
        where.push(`(agent_id = ? OR (entity_type = 'agent' AND entity_id = ?))`);
        params.push(q.involvingAgentId, q.involvingAgentId);
      }
      if (q.actionPrefixes && q.actionPrefixes.length > 0) {
        where.push(`(${q.actionPrefixes.map(() => 'substr(action, 1, length(?)) = ?').join(' OR ')})`);
        for (const p of q.actionPrefixes) params.push(p, p);
      }
      if (q.entityType) {
        where.push('entity_type = ?');
        params.push(q.entityType);
      }
      if (q.entityId) {
        where.push('entity_id = ?');
        params.push(q.entityId);
      }
      if (q.since) {
        where.push('time >= ?');
        params.push(q.since);
      }
      if (q.until) {
        where.push('time <= ?');
        params.push(q.until);
      }
      if (q.before) {
        where.push('id < ?');
        params.push(q.before);
      }
      params.push(q.limit);
      const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
        .bind(...params)
        .all<ActivityRow>();
      return results;
    },

    /** Retention: drops entries older than `olderThan` and all but the newest `maxRows`. */
    async prune(workspaceId: string, olderThan: string, maxRows: number): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM activity WHERE workspace_id = ? AND time < ?').bind(workspaceId, olderThan),
        db
          .prepare(
            `DELETE FROM activity WHERE workspace_id = ?1 AND id IN (
               SELECT id FROM activity WHERE workspace_id = ?1 ORDER BY id DESC LIMIT -1 OFFSET ?2)`,
          )
          .bind(workspaceId, maxRows),
      ]);
    },

    /** A revoked agent for an API key hash (to attribute rejected requests); null for unknown keys. */
    async findRevokedAgentByKeyHash(hash: string): Promise<{ id: string; workspace_id: string; name: string } | null> {
      return db
        .prepare('SELECT id, workspace_id, name FROM agents WHERE key_hash = ? AND revoked_at IS NOT NULL')
        .bind(hash)
        .first<{ id: string; workspace_id: string; name: string }>();
    },

    async agentExists(workspaceId: string, agentId: string): Promise<boolean> {
      const row = await db.prepare('SELECT 1 AS x FROM agents WHERE workspace_id = ? AND id = ?').bind(workspaceId, agentId).first();
      return row !== null;
    },
  };
}

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
