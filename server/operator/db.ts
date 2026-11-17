/**
 * Operator console data access: every SQL statement of server/operator lives
 * here (the public API's SQL stays in server/db/repository.ts). Same rules:
 * parameterised statements only; multi-step changes are one `db.batch()`.
 *
 * Privacy boundary: queries over workspaces/invoices/agents return metadata
 * (ids, timestamps, counts) only, never invoice `data`, settings bodies or hashes.
 */

export interface OperatorStateRow {
  id: 1;
  created_at: number;
  setup_salt: string;
  config_version: number;
  bootstrap_completed_at: number | null;
  mk_kcv: string | null;
  mk_version: number;
  mk_mode: 'wrapped' | 'env' | null;
  mk_confirmed_at: number | null;
  mk_created_at: number | null;
  mk_wrapped: string | null;
  kek_salt: string | null;
  kek_iterations: number | null;
  mk_pending_wrapped: string | null;
  kek_pending_salt: string | null;
  mk_pending_kcv: string | null;
  dek_pending_wrapped: string | null;
  mk_passphrase_salt: string | null;
  mk_passphrase_iterations: number | null;
  dek_wrapped: string | null;
  dek_version: number;
  dek_rotated_at: number | null;
}

export interface SettingRow {
  key: string;
  secret: number;
  value: string | null;
  value_enc: string | null;
  last4: string | null;
  version: number;
  dek_version: number | null;
  updated_at: number;
  updated_by: string | null;
}

export interface OperatorRow {
  id: string;
  workos_user_id: string | null;
  email: string;
  added_at: number;
  added_by: string | null;
  last_sign_in_at: number | null;
}

export interface SessionRow {
  id_hash: string;
  kind: 'setup' | 'full';
  operator_id: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  ip: string | null;
  user_agent: string | null;
}

export interface OAuthStateRow {
  state_hash: string;
  browser_nonce_hash: string;
  code_verifier: string;
  purpose: 'setup' | 'login';
  setup_session_hash: string | null;
  created_at: number;
  expires_at: number;
}

export interface AttemptRow {
  key: string;
  failures: number;
  window_start: number;
  locked_until: number;
  lock_count: number;
}

export interface AuditRow {
  id: number;
  at: number;
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface AuditInput {
  at: number;
  actorType: 'operator' | 'bootstrap' | 'recovery' | 'system';
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface RollupDelta {
  granularity: 'm' | 'h';
  bucket: number;
  metric: string;
  count: number;
  errors: number;
  clientErrors: number;
  authFailures: number;
  rateLimited: number;
  maintenance: number;
  durSum: number;
  hist: number[];
}

export interface RollupRow {
  bucket: number;
  metric: string;
  count: number;
  errors: number;
  client_errors: number;
  auth_failures: number;
  rate_limited: number;
  maintenance: number;
  dur_sum: number;
  h0: number; h1: number; h2: number; h3: number; h4: number;
  h5: number; h6: number; h7: number; h8: number; h9: number;
}

export interface WorkspaceAdminRow {
  id: string;
  created_at: string;
  last_seen_at: number | null;
  invoice_count: number;
  agent_count: number;
  client_count: number;
  /** Activity log entries (count only: entries hold invoice numbers and client names). */
  activity_count: number;
  suspended_at: number | null;
  suspension_reason: string | null;
}

export interface AgentAdminRow {
  id: string;
  workspace_id: string;
  name: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const auditStmt = (db: D1Database, a: AuditInput) =>
  db
    .prepare(
      'INSERT INTO operator_audit (at, actor_type, actor_id, actor_email, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(a.at, a.actorType, a.actorId ?? null, a.actorEmail ?? null, a.action, a.target ?? null, a.detail ? JSON.stringify(a.detail) : null, a.ip ?? null);

export function createOperatorDb(db: D1Database) {
  const self = {
    raw: db,
    auditStatement: (a: AuditInput) => auditStmt(db, a),

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    async getState(): Promise<OperatorStateRow | null> {
      return db.prepare('SELECT * FROM operator_state WHERE id = 1').first<OperatorStateRow>();
    },
    async ensureState(now: number, setupSalt: string): Promise<OperatorStateRow> {
      await db.prepare('INSERT OR IGNORE INTO operator_state (id, created_at, setup_salt) VALUES (1, ?, ?)').bind(now, setupSalt).run();
      return (await self.getState())!;
    },
    /** Updates state columns. `expect` adds optimistic-concurrency conditions. Returns false if no row matched. */
    async updateState(fields: Partial<Omit<OperatorStateRow, 'id'>>, expect: Partial<OperatorStateRow> = {}, extra: D1PreparedStatement[] = []): Promise<boolean> {
      const stmt = self.updateStateStatement(fields, expect);
      const results = await db.batch([stmt, ...extra]);
      return (results[0].meta.changes ?? 0) > 0;
    },
    updateStateStatement(fields: Partial<Omit<OperatorStateRow, 'id'>>, expect: Partial<OperatorStateRow> = {}): D1PreparedStatement {
      const sets = Object.keys(fields);
      const conds = Object.keys(expect);
      for (const k of [...sets, ...conds]) if (!/^[a-z_]+$/.test(k)) throw new Error('bad column');
      const where = ['id = 1', ...conds.map((k) => ((expect as Record<string, unknown>)[k] === null ? `${k} IS NULL` : `${k} = ?`))];
      const sql = `UPDATE operator_state SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE ${where.join(' AND ')}`;
      const params = [
        ...sets.map((k) => (fields as Record<string, unknown>)[k] ?? null),
        ...conds.filter((k) => (expect as Record<string, unknown>)[k] !== null).map((k) => (expect as Record<string, unknown>)[k]),
      ];
      return db.prepare(sql).bind(...params);
    },
    bumpConfigVersionStatement(): D1PreparedStatement {
      return db.prepare('UPDATE operator_state SET config_version = config_version + 1 WHERE id = 1');
    },

    /** One round trip for the per-isolate settings snapshot. */
    async loadSnapshot(): Promise<{ state: Pick<OperatorStateRow, 'config_version' | 'mk_version' | 'dek_version'> | null; settings: SettingRow[]; suspendedHashes: string[] }> {
      const [state, settings, suspended] = await db.batch([
        db.prepare('SELECT config_version, mk_version, dek_version FROM operator_state WHERE id = 1'),
        db.prepare('SELECT key, secret, value, value_enc, last4, version, dek_version, updated_at, updated_by FROM operator_settings'),
        db.prepare(
          `SELECT w.token_hash AS h FROM workspaces w JOIN workspace_suspensions s ON s.workspace_id = w.id
           UNION ALL
           SELECT a.key_hash AS h FROM agents a JOIN workspace_suspensions s ON s.workspace_id = a.workspace_id WHERE a.revoked_at IS NULL
           UNION ALL
           SELECT t.token_hash AS h FROM workspace_tokens t JOIN workspace_suspensions s ON s.workspace_id = t.workspace_id WHERE t.revoked_at IS NULL`,
        ),
      ]);
      return {
        state: (state.results[0] as OperatorStateRow | undefined) ?? null,
        settings: settings.results as unknown as SettingRow[],
        suspendedHashes: (suspended.results as { h: string }[]).map((r) => r.h),
      };
    },

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------
    async listSettings(): Promise<SettingRow[]> {
      return (await db.prepare('SELECT * FROM operator_settings').all<SettingRow>()).results;
    },
    async getSetting(key: string): Promise<SettingRow | null> {
      return db.prepare('SELECT * FROM operator_settings WHERE key = ?').bind(key).first<SettingRow>();
    },
    upsertSettingStatement(row: Omit<SettingRow, 'version'> & { version: number }): D1PreparedStatement {
      return db
        .prepare(
          `INSERT INTO operator_settings (key, secret, value, value_enc, last4, version, dek_version, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET secret = excluded.secret, value = excluded.value, value_enc = excluded.value_enc,
             last4 = excluded.last4, version = excluded.version, dek_version = excluded.dek_version,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(row.key, row.secret, row.value, row.value_enc, row.last4, row.version, row.dek_version, row.updated_at, row.updated_by);
    },
    /** Secret upsert that only applies while the DEK version it was encrypted with is still current. */
    upsertSecretSettingStatement(row: Omit<SettingRow, 'version' | 'secret' | 'value'> & { version: number; dek_version: number }): D1PreparedStatement {
      return db
        .prepare(
          `INSERT INTO operator_settings (key, secret, value, value_enc, last4, version, dek_version, updated_at, updated_by)
           SELECT ?, 1, NULL, ?, ?, ?, ?, ?, ? WHERE (SELECT dek_version FROM operator_state WHERE id = 1) = ?
           ON CONFLICT (key) DO UPDATE SET secret = 1, value = NULL, value_enc = excluded.value_enc,
             last4 = excluded.last4, version = excluded.version, dek_version = excluded.dek_version,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(row.key, row.value_enc, row.last4, row.version, row.dek_version, row.updated_at, row.updated_by, row.dek_version);
    },
    reencryptSettingStatement(key: string, valueEnc: string, dekVersion: number, expectVersion: number): D1PreparedStatement {
      return db
        .prepare('UPDATE operator_settings SET value_enc = ?, dek_version = ? WHERE key = ? AND version = ?')
        .bind(valueEnc, dekVersion, key, expectVersion);
    },
    deleteSettingStatement(key: string): D1PreparedStatement {
      return db.prepare('DELETE FROM operator_settings WHERE key = ?').bind(key);
    },

    // -------------------------------------------------------------------------
    // Operators
    // -------------------------------------------------------------------------
    async listOperators(): Promise<OperatorRow[]> {
      return (await db.prepare('SELECT * FROM operators ORDER BY added_at').all<OperatorRow>()).results;
    },
    async countOperators(): Promise<number> {
      return (await db.prepare('SELECT COUNT(*) AS n FROM operators').first<{ n: number }>())?.n ?? 0;
    },
    async findOperator(id: string): Promise<OperatorRow | null> {
      return db.prepare('SELECT * FROM operators WHERE id = ?').bind(id).first<OperatorRow>();
    },
    async findOperatorByWorkosId(userId: string): Promise<OperatorRow | null> {
      return db.prepare('SELECT * FROM operators WHERE workos_user_id = ?').bind(userId).first<OperatorRow>();
    },
    async findUnboundOperatorByEmail(email: string): Promise<OperatorRow | null> {
      return db.prepare('SELECT * FROM operators WHERE workos_user_id IS NULL AND email = ?').bind(email).first<OperatorRow>();
    },
    insertOperatorStatement(o: OperatorRow): D1PreparedStatement {
      return db
        .prepare('INSERT INTO operators (id, workos_user_id, email, added_at, added_by, last_sign_in_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(o.id, o.workos_user_id, o.email, o.added_at, o.added_by, o.last_sign_in_at);
    },
    /** First operator: only inserted if this request is the one that completed bootstrap (`completedAt` marker). */
    insertFirstOperatorStatement(o: OperatorRow, completedAt: number): D1PreparedStatement {
      return db
        .prepare(
          `INSERT INTO operators (id, workos_user_id, email, added_at, added_by, last_sign_in_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT bootstrap_completed_at FROM operator_state WHERE id = 1) = ?`,
        )
        .bind(o.id, o.workos_user_id, o.email, o.added_at, o.added_by, o.last_sign_in_at, completedAt);
    },
    async bindOperator(id: string, workosUserId: string, now: number): Promise<boolean> {
      const r = await db
        .prepare('UPDATE operators SET workos_user_id = ?, last_sign_in_at = ? WHERE id = ? AND workos_user_id IS NULL')
        .bind(workosUserId, now, id)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },
    async touchOperatorSignIn(id: string, now: number): Promise<void> {
      await db.prepare('UPDATE operators SET last_sign_in_at = ? WHERE id = ?').bind(now, id).run();
    },
    /** Deletes an operator unless it is the last one (single statement, so no race). */
    async deleteOperatorUnlessLast(id: string, audit: AuditInput): Promise<'deleted' | 'last' | 'not_found'> {
      const [del] = await db.batch([
        db.prepare('DELETE FROM operators WHERE id = ? AND (SELECT COUNT(*) FROM operators) > 1').bind(id),
        db.prepare('UPDATE operator_sessions SET revoked_at = ? WHERE operator_id = ? AND revoked_at IS NULL').bind(audit.at, id),
      ]);
      if ((del.meta.changes ?? 0) > 0) {
        await auditStmt(db, audit).run();
        return 'deleted';
      }
      return (await self.findOperator(id)) ? 'last' : 'not_found';
    },

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------
    insertSessionStatement(s: SessionRow): D1PreparedStatement {
      return db
        .prepare(
          'INSERT INTO operator_sessions (id_hash, kind, operator_id, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
        )
        .bind(s.id_hash, s.kind, s.operator_id, s.created_at, s.last_seen_at, s.expires_at, s.ip, s.user_agent);
    },
    async findSession(idHash: string): Promise<SessionRow | null> {
      return db.prepare('SELECT * FROM operator_sessions WHERE id_hash = ?').bind(idHash).first<SessionRow>();
    },
    async touchSession(idHash: string, now: number): Promise<void> {
      await db.prepare('UPDATE operator_sessions SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL').bind(now, idHash).run();
    },
    revokeSessionStatement(idHash: string, now: number): D1PreparedStatement {
      return db.prepare('UPDATE operator_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').bind(now, idHash);
    },
    revokeSetupSessionsStatement(now: number): D1PreparedStatement {
      return db.prepare("UPDATE operator_sessions SET revoked_at = ? WHERE kind = 'setup' AND revoked_at IS NULL").bind(now);
    },
    async listActiveSessions(now: number): Promise<(SessionRow & { email: string | null })[]> {
      return (
        await db
          .prepare(
            `SELECT s.*, o.email FROM operator_sessions s LEFT JOIN operators o ON o.id = s.operator_id
             WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC LIMIT 100`,
          )
          .bind(now)
          .all<SessionRow & { email: string | null }>()
      ).results;
    },
    async purgeSessions(before: number): Promise<void> {
      await db.prepare('DELETE FROM operator_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').bind(before, before).run();
    },

    // -------------------------------------------------------------------------
    // OAuth states
    // -------------------------------------------------------------------------
    async insertOAuthState(s: OAuthStateRow): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM operator_oauth_states WHERE expires_at < ?').bind(s.created_at),
        db
          .prepare(
            'INSERT INTO operator_oauth_states (state_hash, browser_nonce_hash, code_verifier, purpose, setup_session_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(s.state_hash, s.browser_nonce_hash, s.code_verifier, s.purpose, s.setup_session_hash, s.created_at, s.expires_at),
      ]);
    },
    /** Single use: deletes and returns the row atomically. */
    async consumeOAuthState(stateHash: string): Promise<OAuthStateRow | null> {
      return db.prepare('DELETE FROM operator_oauth_states WHERE state_hash = ? RETURNING *').bind(stateHash).first<OAuthStateRow>();
    },

    // -------------------------------------------------------------------------
    // Login attempts (bootstrap / recovery lockout)
    // -------------------------------------------------------------------------
    async getAttempts(keys: string[]): Promise<AttemptRow[]> {
      if (keys.length === 0) return [];
      return (
        await db
          .prepare(`SELECT * FROM operator_login_attempts WHERE key IN (${keys.map(() => '?').join(', ')})`)
          .bind(...keys)
          .all<AttemptRow>()
      ).results;
    },
    /**
     * Counts one failed attempt per key, atomically (one UPSERT … RETURNING
     * each, in one batch): concurrent failures can never be lost. A key whose
     * window is older than `windowMs` starts a new window; its lock count is
     * forgotten after `lockMemoryMs` without failures.
     */
    async bumpAttempts(keys: string[], now: number, windowMs: number, lockMemoryMs: number): Promise<AttemptRow[]> {
      const results = await db.batch<AttemptRow>(
        keys.map((key) =>
          db
            .prepare(
              `INSERT INTO operator_login_attempts (key, failures, window_start, locked_until, lock_count) VALUES (?1, 1, ?2, 0, 0)
               ON CONFLICT (key) DO UPDATE SET
                 lock_count = CASE WHEN ?2 - window_start > ?4 THEN 0 ELSE lock_count END,
                 failures = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE failures + 1 END,
                 window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END
               RETURNING key, failures, window_start, locked_until, lock_count`,
            )
            .bind(key, now, windowMs, lockMemoryMs),
        ),
      );
      return results.map((r) => r.results[0]);
    },
    /**
     * Locks a key that reached `threshold` failures: resets its failures and
     * sets locked_until = now + min(baseMs · 2^lock_count, maxMs), in one
     * compare-and-set statement (only one of several concurrent requests does it).
     */
    async lockAttempt(key: string, a: { now: number; threshold: number; baseMs: number; maxMs: number }): Promise<number | null> {
      const row = await db
        .prepare(
          `UPDATE operator_login_attempts SET failures = 0, lock_count = lock_count + 1,
                  locked_until = ?2 + min(?3 * (1 << min(lock_count, 20)), ?4)
            WHERE key = ?1 AND failures >= ?5
        RETURNING locked_until`,
        )
        .bind(key, a.now, a.baseMs, a.maxMs, a.threshold)
        .first<{ locked_until: number }>();
      return row?.locked_until ?? null;
    },
    async clearAttempts(key: string): Promise<void> {
      await db.prepare('DELETE FROM operator_login_attempts WHERE key = ?').bind(key).run();
    },

    // -------------------------------------------------------------------------
    // Audit
    // -------------------------------------------------------------------------
    async audit(a: AuditInput): Promise<void> {
      await auditStmt(db, a).run();
    },
    async listAudit(q: { action?: string; actor?: string; before?: number; limit: number }): Promise<AuditRow[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.action) {
        where.push('(action = ? OR action LIKE ?)');
        params.push(q.action, `${q.action}.%`);
      }
      if (q.actor) {
        where.push('(actor_email LIKE ? OR actor_id = ? OR actor_type = ?)');
        params.push(`%${q.actor.replace(/[%_]/g, '')}%`, q.actor, q.actor);
      }
      if (q.before) {
        where.push('id < ?');
        params.push(q.before);
      }
      const sql = `SELECT * FROM operator_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
      return (await db.prepare(sql).bind(...params, q.limit).all<AuditRow>()).results;
    },

    // -------------------------------------------------------------------------
    // Workspaces & agents (metadata only)
    // -------------------------------------------------------------------------
    async listWorkspaces(q: { search?: string; status?: 'all' | 'suspended' | 'active'; afterCreated?: string; afterId?: string; limit: number }): Promise<WorkspaceAdminRow[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.search) {
        where.push('w.id LIKE ?');
        params.push(`${q.search.replace(/[%_]/g, '')}%`);
      }
      if (q.status === 'suspended') where.push('s.workspace_id IS NOT NULL');
      if (q.status === 'active') where.push('s.workspace_id IS NULL');
      if (q.afterCreated && q.afterId) {
        where.push('(w.created_at < ? OR (w.created_at = ? AND w.id < ?))');
        params.push(q.afterCreated, q.afterCreated, q.afterId);
      }
      const sql = `
        SELECT w.id, w.created_at, act.last_seen_at,
          (SELECT COUNT(*) FROM invoices i WHERE i.workspace_id = w.id AND i.deleted_at IS NULL) AS invoice_count,
          (SELECT COUNT(*) FROM agents a WHERE a.workspace_id = w.id AND a.revoked_at IS NULL) AS agent_count,
          (SELECT COUNT(*) FROM clients cl WHERE cl.workspace_id = w.id AND cl.deleted_at IS NULL) AS client_count,
          (SELECT COUNT(*) FROM activity ac WHERE ac.workspace_id = w.id) AS activity_count,
          s.suspended_at, s.reason AS suspension_reason
        FROM workspaces w
        LEFT JOIN workspace_suspensions s ON s.workspace_id = w.id
        LEFT JOIN workspace_activity act ON act.workspace_id = w.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY w.created_at DESC, w.id DESC LIMIT ?`;
      return (await db.prepare(sql).bind(...params, q.limit).all<WorkspaceAdminRow>()).results;
    },
    /** Operator-side rows of a deleted workspace (FK cascades may be off). */
    async purgeWorkspaceOperatorRows(id: string): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM workspace_suspensions WHERE workspace_id = ?').bind(id),
        db.prepare('DELETE FROM workspace_activity WHERE workspace_id = ?').bind(id),
        self.bumpConfigVersionStatement(),
      ]);
    },
    async workspaceExists(id: string): Promise<boolean> {
      return !!(await db.prepare('SELECT 1 AS x FROM workspaces WHERE id = ?').bind(id).first());
    },
    async suspendWorkspace(id: string, now: number, by: string, reason: string | null, audit: AuditInput): Promise<boolean> {
      const [r] = await db.batch([
        db
          .prepare('INSERT OR IGNORE INTO workspace_suspensions (workspace_id, suspended_at, suspended_by, reason) SELECT id, ?, ?, ? FROM workspaces WHERE id = ?')
          .bind(now, by, reason, id),
        auditStmt(db, audit),
        self.bumpConfigVersionStatement(),
      ]);
      return (r.meta.changes ?? 0) > 0;
    },
    async unsuspendWorkspace(id: string, audit: AuditInput): Promise<boolean> {
      const [r] = await db.batch([
        db.prepare('DELETE FROM workspace_suspensions WHERE workspace_id = ?').bind(id),
        auditStmt(db, audit),
        self.bumpConfigVersionStatement(),
      ]);
      return (r.meta.changes ?? 0) > 0;
    },
    async listAgents(q: { search?: string; status?: 'all' | 'active' | 'revoked'; before?: string; limit: number }): Promise<AgentAdminRow[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.search) {
        where.push('(a.name LIKE ? OR a.workspace_id LIKE ? OR a.id LIKE ?)');
        const s = q.search.replace(/[%_]/g, '');
        params.push(`%${s}%`, `${s}%`, `${s}%`);
      }
      if (q.status === 'active') where.push('a.revoked_at IS NULL');
      if (q.status === 'revoked') where.push('a.revoked_at IS NOT NULL');
      if (q.before) {
        where.push('a.created_at < ?');
        params.push(q.before);
      }
      const sql = `SELECT a.id, a.workspace_id, a.name, a.scopes, a.created_at, a.last_used_at, a.revoked_at FROM agents a
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC LIMIT ?`;
      return (await db.prepare(sql).bind(...params, q.limit).all<AgentAdminRow>()).results;
    },
    async findAgent(id: string): Promise<AgentAdminRow | null> {
      return db
        .prepare('SELECT id, workspace_id, name, scopes, created_at, last_used_at, revoked_at FROM agents WHERE id = ?')
        .bind(id)
        .first<AgentAdminRow>();
    },
    async touchWorkspaceActivity(entries: { workspaceId: string; at: number }[]): Promise<void> {
      if (entries.length === 0) return;
      await db.batch(
        entries.map((e) =>
          db
            .prepare(
              `INSERT INTO workspace_activity (workspace_id, last_seen_at) SELECT id, ? FROM workspaces WHERE id = ?
               ON CONFLICT (workspace_id) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
            )
            .bind(e.at, e.workspaceId),
        ),
      );
    },

    // -------------------------------------------------------------------------
    // Stats
    // -------------------------------------------------------------------------
    async overviewCounts(sinceIso: string, sinceMs: number, nowMs: number) {
      const [ws, inv, invBy, ag, reg, act, sus, cli, tpl, rec] = await db.batch([
        db.prepare('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent FROM workspaces').bind(sinceIso),
        db.prepare('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent FROM invoices WHERE deleted_at IS NULL').bind(sinceIso),
        db.prepare(
          `SELECT json_extract(created_by, '$.type') AS creator, COUNT(*) AS total, SUM(created_at >= ?) AS recent
           FROM invoices WHERE deleted_at IS NULL GROUP BY creator`,
        ).bind(sinceIso),
        db.prepare('SELECT SUM(revoked_at IS NULL) AS active, SUM(revoked_at IS NOT NULL) AS revoked FROM agents'),
        db.prepare("SELECT COUNT(*) AS pending FROM agent_registrations WHERE status IN ('pending', 'approved') AND expires_at > ?").bind(nowMs),
        db.prepare(
          `SELECT COUNT(*) AS active FROM workspaces w WHERE
             EXISTS (SELECT 1 FROM workspace_activity a WHERE a.workspace_id = w.id AND a.last_seen_at >= ?)
             OR EXISTS (SELECT 1 FROM invoices i WHERE i.workspace_id = w.id AND i.updated_at >= ?)`,
        ).bind(sinceMs, sinceIso),
        db.prepare('SELECT COUNT(*) AS n FROM workspace_suspensions'),
        db.prepare('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent FROM clients WHERE deleted_at IS NULL').bind(sinceIso),
        db.prepare('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent FROM templates WHERE deleted_at IS NULL').bind(sinceIso),
        db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'paused') AS paused FROM recurring_schedules WHERE deleted_at IS NULL`),
      ]);
      const first = <T>(r: D1Result) => (r.results[0] ?? {}) as T;
      return {
        workspaces: first<{ total: number; recent: number | null }>(ws),
        activeWorkspaces: first<{ active: number }>(act).active ?? 0,
        invoices: first<{ total: number; recent: number | null }>(inv),
        invoicesByCreator: invBy.results as { creator: string | null; total: number; recent: number | null }[],
        agents: first<{ active: number | null; revoked: number | null }>(ag),
        pendingRegistrations: first<{ pending: number }>(reg).pending ?? 0,
        suspended: first<{ n: number }>(sus).n ?? 0,
        clients: first<{ total: number; recent: number | null }>(cli),
        templates: first<{ total: number; recent: number | null }>(tpl),
        recurring: first<{ total: number; active: number | null; paused: number | null }>(rec),
      };
    },
    async dailyCreations(table: 'workspaces' | 'invoices', sinceIso: string): Promise<{ day: string; n: number }[]> {
      const sql =
        table === 'workspaces'
          ? 'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM workspaces WHERE created_at >= ? GROUP BY day ORDER BY day'
          : 'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM invoices WHERE created_at >= ? GROUP BY day ORDER BY day';
      return (await db.prepare(sql).bind(sinceIso).all<{ day: string; n: number }>()).results;
    },
    async registrationFunnel(sinceMs: number, nowMs: number) {
      return (
        await db
          .prepare(
            `SELECT status, COUNT(*) AS n, SUM(status IN ('pending', 'approved') AND expires_at < ?) AS expired
             FROM agent_registrations WHERE created_at >= ? GROUP BY status`,
          )
          .bind(nowMs, sinceMs)
          .all<{ status: string; n: number; expired: number | null }>()
      ).results;
    },

    // -------------------------------------------------------------------------
    // Telemetry
    // -------------------------------------------------------------------------
    rollupStatement(d: RollupDelta): D1PreparedStatement {
      const h = d.hist;
      return db
        .prepare(
          `INSERT INTO telemetry_rollups (granularity, bucket, metric, count, errors, client_errors, auth_failures, rate_limited, maintenance, dur_sum,
             h0, h1, h2, h3, h4, h5, h6, h7, h8, h9)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (granularity, bucket, metric) DO UPDATE SET
             count = count + excluded.count, errors = errors + excluded.errors, client_errors = client_errors + excluded.client_errors,
             auth_failures = auth_failures + excluded.auth_failures, rate_limited = rate_limited + excluded.rate_limited,
             maintenance = maintenance + excluded.maintenance,
             dur_sum = dur_sum + excluded.dur_sum,
             h0 = h0 + excluded.h0, h1 = h1 + excluded.h1, h2 = h2 + excluded.h2, h3 = h3 + excluded.h3, h4 = h4 + excluded.h4,
             h5 = h5 + excluded.h5, h6 = h6 + excluded.h6, h7 = h7 + excluded.h7, h8 = h8 + excluded.h8, h9 = h9 + excluded.h9`,
        )
        .bind(d.granularity, d.bucket, d.metric, d.count, d.errors, d.clientErrors, d.authFailures, d.rateLimited, d.maintenance, Math.round(d.durSum), ...h);
    },
    errorStatement(e: { at: number; metric: string; status: number; code: string | null; ray: string | null }): D1PreparedStatement {
      return db
        .prepare('INSERT INTO telemetry_errors (at, metric, status, code, ray) VALUES (?, ?, ?, ?, ?)')
        .bind(e.at, e.metric, e.status, e.code, e.ray);
    },
    async rollups(granularity: 'm' | 'h', since: number): Promise<RollupRow[]> {
      return (
        await db
          .prepare('SELECT * FROM telemetry_rollups WHERE granularity = ? AND bucket >= ? ORDER BY bucket')
          .bind(granularity, since)
          .all<RollupRow>()
      ).results;
    },
    async recentErrors(limit: number) {
      return (
        await db
          .prepare('SELECT at, metric, status, code, ray FROM telemetry_errors ORDER BY id DESC LIMIT ?')
          .bind(limit)
          .all<{ at: number; metric: string; status: number; code: string | null; ray: string | null }>()
      ).results;
    },
    async pruneTelemetry(minuteBefore: number, hourBefore: number, errorsBefore: number, keepErrors: number): Promise<number> {
      const results = await db.batch([
        db.prepare("DELETE FROM telemetry_rollups WHERE granularity = 'm' AND bucket < ?").bind(minuteBefore),
        db.prepare("DELETE FROM telemetry_rollups WHERE granularity = 'h' AND bucket < ?").bind(hourBefore),
        db.prepare('DELETE FROM telemetry_errors WHERE at < ?').bind(errorsBefore),
        db.prepare('DELETE FROM telemetry_errors WHERE id <= (SELECT id FROM telemetry_errors ORDER BY id DESC LIMIT 1 OFFSET ?)').bind(keepErrors),
      ]);
      return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    },
    async probe(): Promise<{ latencyMs: number; sizeBytes: number | null; migration: string | null }> {
      const t = Date.now();
      const r = await db.prepare('SELECT 1 AS ok').run();
      const latencyMs = Date.now() - t;
      let migration: string | null;
      try {
        migration = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first<{ name: string }>())?.name ?? null;
      } catch {
        migration = null;
      }
      const meta = r.meta as { size_after?: number };
      return { latencyMs, sizeBytes: typeof meta.size_after === 'number' ? meta.size_after : null, migration };
    },
  };
  return self;
}

export type OperatorDb = ReturnType<typeof createOperatorDb>;
