/**
 * User-account data access: every SQL statement of server/accounts lives here.
 * Same rules as server/db/repository.ts: parameterised statements only,
 * multi-step changes are one `db.batch()`. Device tokens and session ids are
 * stored as SHA-256 hashes only.
 */

export interface UserRow {
  id: string;
  workos_user_id: string;
  email: string;
  email_verified: number;
  name: string | null;
  created_at: number;
  last_sign_in_at: number | null;
  disabled_at: number | null;
  disabled_reason: string | null;
}

export interface UserSessionRow {
  id_hash: string;
  user_id: string;
  device_token_id: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  user_agent: string | null;
}

export interface DeviceTokenRow {
  id: string;
  workspace_id: string;
  user_id: string;
  device_label: string;
  created_at: number;
  last_used_at?: number | null;
  revoked_at: number | null;
}

export interface UserOAuthStateRow {
  state_hash: string;
  browser_nonce_hash: string;
  code_verifier: string;
  return_to: string;
  created_at: number;
  expires_at: number;
}

export interface OwnedWorkspaceRow {
  id: string;
  created_at: string;
  token_hash: string;
}

export interface AccountAdminRow {
  id: string;
  email: string;
  email_verified: number;
  created_at: number;
  last_sign_in_at: number | null;
  disabled_at: number | null;
  disabled_reason: string | null;
  workspace_id: string | null;
  active_devices: number;
}

/** Prefix of workspaces.token_hash when the recovery key is disabled: never equal to a SHA-256 hex digest. */
export const DISABLED_TOKEN_HASH_PREFIX = 'disabled:';

export function createAccountsDb(db: D1Database) {
  const revokeUserTokensStmt = (userId: string, now: number) =>
    db.prepare('UPDATE workspace_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId);
  const revokeUserSessionsStmt = (userId: string, now: number) =>
    db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId);

  return {
    raw: db,

    // --- OAuth states --------------------------------------------------------
    async insertOAuthState(row: UserOAuthStateRow, now: number): Promise<void> {
      await db.batch([
        // Opportunistic cleanup of abandoned sign-ins.
        db.prepare('DELETE FROM user_oauth_states WHERE expires_at < ?').bind(now),
        db
          .prepare('INSERT INTO user_oauth_states (state_hash, browser_nonce_hash, code_verifier, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(row.state_hash, row.browser_nonce_hash, row.code_verifier, row.return_to, row.created_at, row.expires_at),
      ]);
    },
    /** Single use: deletes and returns the row atomically. */
    async consumeOAuthState(stateHash: string): Promise<UserOAuthStateRow | null> {
      return db.prepare('DELETE FROM user_oauth_states WHERE state_hash = ? RETURNING *').bind(stateHash).first<UserOAuthStateRow>();
    },

    // --- Users ---------------------------------------------------------------
    async findUser(id: string): Promise<UserRow | null> {
      return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    },
    async findUserByWorkosId(workosUserId: string): Promise<UserRow | null> {
      return db.prepare('SELECT * FROM users WHERE workos_user_id = ?').bind(workosUserId).first<UserRow>();
    },
    /** Creates the user on first sign-in, otherwise refreshes the verified email/name and last sign-in. */
    async upsertUserOnSignIn(u: { id: string; workosUserId: string; email: string; name: string | null; now: number }): Promise<UserRow> {
      await db
        .prepare(
          `INSERT INTO users (id, workos_user_id, email, email_verified, name, created_at, last_sign_in_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT (workos_user_id) DO UPDATE SET email = excluded.email, email_verified = 1, name = excluded.name, last_sign_in_at = excluded.last_sign_in_at`,
        )
        .bind(u.id, u.workosUserId, u.email, u.name, u.now, u.now)
        .run();
      return (await this.findUserByWorkosId(u.workosUserId))!;
    },

    // --- Sessions ------------------------------------------------------------
    insertSessionStatement(row: UserSessionRow): D1PreparedStatement {
      return db
        .prepare('INSERT INTO user_sessions (id_hash, user_id, device_token_id, created_at, last_seen_at, expires_at, revoked_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
        .bind(row.id_hash, row.user_id, row.device_token_id, row.created_at, row.last_seen_at, row.expires_at, row.user_agent);
    },
    revokeSessionStatement(idHash: string, now: number): D1PreparedStatement {
      return db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').bind(now, idHash);
    },
    async findSession(idHash: string): Promise<UserSessionRow | null> {
      return db.prepare('SELECT * FROM user_sessions WHERE id_hash = ?').bind(idHash).first<UserSessionRow>();
    },
    async touchSession(idHash: string, now: number): Promise<void> {
      await db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id_hash = ?').bind(now, idHash).run();
    },
    async bindSessionDevice(idHash: string, deviceId: string): Promise<void> {
      await db.prepare('UPDATE user_sessions SET device_token_id = ? WHERE id_hash = ?').bind(deviceId, idHash).run();
    },

    // --- Workspace membership ------------------------------------------------
    async ownedWorkspace(userId: string): Promise<OwnedWorkspaceRow | null> {
      return db
        .prepare(
          `SELECT w.id, w.created_at, w.token_hash FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
           WHERE m.user_id = ? AND m.role = 'owner'`,
        )
        .bind(userId)
        .first<OwnedWorkspaceRow>();
    },
    async workspaceOwner(workspaceId: string): Promise<string | null> {
      return (
        (await db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").bind(workspaceId).first<{ user_id: string }>())
          ?.user_id ?? null
      );
    },
    addOwnerStatement(workspaceId: string, userId: string, now: number): D1PreparedStatement {
      return db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(workspaceId, userId, now);
    },
    createWorkspaceStatement(id: string, tokenHash: string, createdAt: string): D1PreparedStatement {
      return db.prepare('INSERT INTO workspaces (id, token_hash, created_at) VALUES (?, ?, ?)').bind(id, tokenHash, createdAt);
    },
    async setRecoveryTokenHash(workspaceId: string, tokenHash: string): Promise<void> {
      await db.prepare('UPDATE workspaces SET token_hash = ? WHERE id = ?').bind(tokenHash, workspaceId).run();
    },

    // --- Device tokens -------------------------------------------------------
    insertDeviceTokenStatement(row: DeviceTokenRow & { token_hash: string }): D1PreparedStatement {
      return db
        .prepare('INSERT INTO workspace_tokens (id, workspace_id, user_id, token_hash, device_label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)')
        .bind(row.id, row.workspace_id, row.user_id, row.token_hash, row.device_label, row.created_at);
    },
    async findActiveDeviceByHash(tokenHash: string): Promise<DeviceTokenRow | null> {
      return db
        .prepare('SELECT id, workspace_id, user_id, device_label, created_at, revoked_at FROM workspace_tokens WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(tokenHash)
        .first<DeviceTokenRow>();
    },
    /** Workspace of the original (anonymous) workspace token, if this hash is one. */
    async findWorkspaceByRecoveryHash(tokenHash: string): Promise<{ id: string; created_at: string } | null> {
      return db.prepare('SELECT id, created_at FROM workspaces WHERE token_hash = ?').bind(tokenHash).first();
    },
    /** One of this user's devices (active or not). */
    async findDevice(userId: string, id: string): Promise<DeviceTokenRow | null> {
      return db
        .prepare('SELECT id, workspace_id, user_id, device_label, created_at, last_used_at, revoked_at FROM workspace_tokens WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .first<DeviceTokenRow>();
    },
    /** Status of a device token presented by its holder (also revoked ones), for a clear "signed out" message. */
    async deviceStatusByHash(tokenHash: string): Promise<{ revoked_at: number | null; disabled_at: number | null } | null> {
      return db
        .prepare('SELECT t.revoked_at, u.disabled_at FROM workspace_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?')
        .bind(tokenHash)
        .first();
    },
    /** Throttled "last used" for a device token (no-op for other tokens and within the throttle window). */
    touchDeviceStatement(tokenHash: string, now: number, throttleMs: number): D1PreparedStatement {
      return db
        .prepare('UPDATE workspace_tokens SET last_used_at = ?1 WHERE token_hash = ?2 AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at <= ?3)')
        .bind(now, tokenHash, now - throttleMs);
    },
    async countActiveDevices(userId: string): Promise<number> {
      return (await db.prepare('SELECT COUNT(*) AS n FROM workspace_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(userId).first<{ n: number }>())?.n ?? 0;
    },
    /** Housekeeping (scheduled): expired OAuth states, ended sessions, long-revoked device tokens. */
    async cleanup(now: number, opts: { sessionIdleMs: number; keepRevokedMs: number }): Promise<{ states: number; sessions: number; tokens: number }> {
      const [states, sessions, tokens] = await db.batch([
        db.prepare('DELETE FROM user_oauth_states WHERE expires_at < ?').bind(now),
        db
          .prepare('DELETE FROM user_sessions WHERE expires_at < ?1 OR last_seen_at < ?2 OR (revoked_at IS NOT NULL AND revoked_at < ?3)')
          .bind(now, now - opts.sessionIdleMs, now - opts.keepRevokedMs),
        db.prepare('DELETE FROM workspace_tokens WHERE revoked_at IS NOT NULL AND revoked_at < ?').bind(now - opts.keepRevokedMs),
      ]);
      return { states: states.meta.changes ?? 0, sessions: sessions.meta.changes ?? 0, tokens: tokens.meta.changes ?? 0 };
    },
    /** Workspaces owned by an account (operator warning when accounts are turned off). */
    async linkedWorkspaceCount(): Promise<number> {
      return (await db.prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE role = 'owner'").first<{ n: number }>())?.n ?? 0;
    },
    async listDevices(userId: string, now: number): Promise<(DeviceTokenRow & { last_seen_at: number | null; signed_in: number })[]> {
      return (
        await db
          .prepare(
            `SELECT t.id, t.workspace_id, t.user_id, t.device_label, t.created_at, t.last_used_at, t.revoked_at,
               (SELECT MAX(s.last_seen_at) FROM user_sessions s WHERE s.device_token_id = t.id) AS last_seen_at,
               (SELECT COUNT(*) FROM user_sessions s WHERE s.device_token_id = t.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS signed_in
             FROM workspace_tokens t WHERE t.user_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at DESC`,
          )
          .bind(now, userId)
          .all<DeviceTokenRow & { last_seen_at: number | null; signed_in: number }>()
      ).results;
    },
    /** Revokes one device token and every session linked to it. Returns false if it was not this user's active device. */
    async revokeDevice(userId: string, deviceId: string, now: number): Promise<boolean> {
      const [res] = await db.batch([
        db.prepare('UPDATE workspace_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, deviceId, userId),
        db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE device_token_id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, deviceId, userId),
      ]);
      return (res.meta.changes ?? 0) > 0;
    },
    /** Signs the user out everywhere, optionally keeping one session and its device. */
    async revokeAll(userId: string, now: number, keep?: { sessionHash: string; deviceId: string | null }): Promise<void> {
      if (!keep) {
        await db.batch([revokeUserTokensStmt(userId, now), revokeUserSessionsStmt(userId, now)]);
        return;
      }
      await db.batch([
        db
          .prepare('UPDATE workspace_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?')
          .bind(now, userId, keep.deviceId),
        db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id_hash != ?').bind(now, userId, keep.sessionHash),
      ]);
    },

    // --- Account deletion ----------------------------------------------------
    async deleteUser(userId: string): Promise<void> {
      await db.batch([
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM workspace_tokens WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM workspace_members WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ]);
    },

    // --- Operator console (metadata only) --------------------------------------
    async listAccounts(q: { search?: string; status?: 'all' | 'active' | 'disabled'; afterCreated?: number; afterId?: string; limit: number }): Promise<AccountAdminRow[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.search) {
        where.push("u.email LIKE ? ESCAPE '\\'");
        params.push(`%${q.search.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      }
      if (q.status === 'disabled') where.push('u.disabled_at IS NOT NULL');
      if (q.status === 'active') where.push('u.disabled_at IS NULL');
      if (q.afterCreated !== undefined && q.afterId) {
        where.push('(u.created_at < ? OR (u.created_at = ? AND u.id < ?))');
        params.push(q.afterCreated, q.afterCreated, q.afterId);
      }
      const sql = `
        SELECT u.id, u.email, u.email_verified, u.created_at, u.last_sign_in_at, u.disabled_at, u.disabled_reason,
          (SELECT m.workspace_id FROM workspace_members m WHERE m.user_id = u.id AND m.role = 'owner') AS workspace_id,
          (SELECT COUNT(*) FROM workspace_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) AS active_devices
        FROM users u
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.created_at DESC, u.id DESC LIMIT ?`;
      return (await db.prepare(sql).bind(...params, q.limit).all<AccountAdminRow>()).results;
    },
    /** Disables an account: sign-in refused, every session and device token revoked. */
    async disableUser(userId: string, now: number, reason: string | null): Promise<boolean> {
      const [res] = await db.batch([
        db.prepare('UPDATE users SET disabled_at = ?, disabled_reason = ? WHERE id = ? AND disabled_at IS NULL').bind(now, reason, userId),
        revokeUserTokensStmt(userId, now),
        revokeUserSessionsStmt(userId, now),
      ]);
      return (res.meta.changes ?? 0) > 0;
    },
    async enableUser(userId: string): Promise<boolean> {
      const res = await db.prepare('UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE id = ? AND disabled_at IS NOT NULL').bind(userId).run();
      return (res.meta.changes ?? 0) > 0;
    },
    async accountCounts(): Promise<{ total: number; disabled: number }> {
      const row = await db
        .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS disabled FROM users')
        .first<{ total: number; disabled: number }>();
      return { total: row?.total ?? 0, disabled: row?.disabled ?? 0 };
    },
  };
}

export type AccountsDb = ReturnType<typeof createAccountsDb>;
