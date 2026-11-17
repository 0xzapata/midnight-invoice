/**
 * SQL for the OAuth authorization server (migration 0008_oauth.sql). Same
 * rules as server/db/repository.ts: parameterised statements only, workspace
 * scoping wherever a workspace is known, atomic steps as single statements or
 * one `db.batch()` (one D1 transaction).
 */
import type { Scope } from '../../shared/api';
import type { AgentRow } from '../db/repository';

export interface OAuthClientRow {
  client_id: string;
  kind: 'dcr' | 'cimd';
  client_name: string;
  client_uri: string | null;
  redirect_uris: string;
  grant_types: string;
  software_id: string | null;
  software_version: string | null;
  created_at: number;
  first_used_at: number | null;
  unused_expires_at: number | null;
  metadata_expires_at: number | null;
}

export interface OAuthRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  redirect_uri_sent: number;
  state: string | null;
  code_challenge: string;
  scopes: string;
  scopes_defaulted: number;
  resource: string;
  status: 'pending' | 'approved' | 'denied';
  workspace_id: string | null;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
}

export interface OAuthCodeRow {
  code_hash: string;
  request_id: string;
  client_id: string;
  workspace_id: string;
  redirect_uri: string;
  redirect_uri_sent: number;
  code_challenge: string;
  scopes: string;
  resource: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  grant_id: string | null;
}

export interface OAuthTokenLookup {
  kind: 'access' | 'refresh';
  token_scopes: string;
  expires_at: number;
  used_at: number | null;
  token_revoked_at: number | null;
  grant_id: string;
  grant_scopes: string;
  grant_revoked_at: number | null;
  refreshable: number;
  resource: string;
  client_id: string;
  workspace_id: string;
  agent_id: string;
  agent_name: string;
  agent_description: string | null;
  agent_scopes: string;
  agent_created_at: string;
  agent_last_used_at: string | null;
  agent_revoked_at: string | null;
  /** 1 if the operator suspended the workspace (workspace_suspensions, migration 0004). */
  workspace_suspended: number;
}

export interface NewTokens {
  accessHash: string;
  accessExpiresAt: number;
  refreshHash: string | null;
  refreshExpiresAt: number;
  scopes: Scope[];
}

const AGENT_COLUMNS = 'id, workspace_id, name, description, scopes, created_at, last_used_at, revoked_at';

export function createOAuthRepository(db: D1Database) {
  const tokenInserts = (grantId: string, workspaceId: string, now: number, t: NewTokens) => {
    const stmts = [
      db
        .prepare(
          `INSERT INTO oauth_tokens (token_hash, grant_id, workspace_id, kind, scopes, created_at, expires_at)
           SELECT ?, id, workspace_id, 'access', ?, ?, ? FROM oauth_grants WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
        )
        .bind(t.accessHash, JSON.stringify(t.scopes), now, t.accessExpiresAt, grantId, workspaceId),
    ];
    if (t.refreshHash) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO oauth_tokens (token_hash, grant_id, workspace_id, kind, scopes, created_at, expires_at)
             SELECT ?, id, workspace_id, 'refresh', ?, ?, ? FROM oauth_grants WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
          )
          .bind(t.refreshHash, JSON.stringify(t.scopes), now, t.refreshExpiresAt, grantId, workspaceId),
      );
    }
    return stmts;
  };

  return {
    // -----------------------------------------------------------------------
    // Clients
    // -----------------------------------------------------------------------
    async findClient(clientId: string): Promise<OAuthClientRow | null> {
      return db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first<OAuthClientRow>();
    },

    async insertDcrClient(c: {
      clientId: string;
      clientName: string;
      clientUri: string | null;
      redirectUris: string[];
      grantTypes: string[];
      softwareId: string | null;
      softwareVersion: string | null;
      createdAt: number;
      unusedExpiresAt: number;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO oauth_clients
             (client_id, kind, client_name, client_uri, redirect_uris, grant_types, software_id, software_version, created_at, unused_expires_at)
           VALUES (?, 'dcr', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          c.clientId,
          c.clientName,
          c.clientUri,
          JSON.stringify(c.redirectUris),
          JSON.stringify(c.grantTypes),
          c.softwareId,
          c.softwareVersion,
          c.createdAt,
          c.unusedExpiresAt,
        )
        .run();
    },

    /** Stores (or refreshes) the cached copy of a Client ID Metadata Document. */
    async upsertCimdClient(c: {
      clientId: string;
      clientName: string;
      clientUri: string | null;
      redirectUris: string[];
      grantTypes: string[];
      softwareId: string | null;
      softwareVersion: string | null;
      now: number;
      metadataExpiresAt: number;
    }): Promise<OAuthClientRow | null> {
      return db
        .prepare(
          `INSERT INTO oauth_clients
             (client_id, kind, client_name, client_uri, redirect_uris, grant_types, software_id, software_version, created_at, metadata_expires_at)
           VALUES (?, 'cimd', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (client_id) DO UPDATE SET
             client_name = excluded.client_name, client_uri = excluded.client_uri, redirect_uris = excluded.redirect_uris,
             grant_types = excluded.grant_types, software_id = excluded.software_id, software_version = excluded.software_version,
             metadata_expires_at = excluded.metadata_expires_at
           WHERE oauth_clients.kind = 'cimd'
           RETURNING *`,
        )
        .bind(
          c.clientId,
          c.clientName,
          c.clientUri,
          JSON.stringify(c.redirectUris),
          JSON.stringify(c.grantTypes),
          c.softwareId,
          c.softwareVersion,
          c.now,
          c.metadataExpiresAt,
        )
        .first<OAuthClientRow>();
    },

    /** Housekeeping: unused registrations, stale requests/codes, long-expired tokens. */
    async purgeExpired(now: number, graceMs: number): Promise<Record<string, number>> {
      const names = ['requests', 'codes', 'tokens', 'unusedClients', 'deadGrants', 'staleMetadataDocuments'];
      const results = await db.batch([
        db.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now - graceMs),
        db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now - graceMs),
        db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(now - graceMs),
        db
          .prepare(`DELETE FROM oauth_clients WHERE kind = 'dcr' AND first_used_at IS NULL AND unused_expires_at < ?`)
          .bind(now),
        // Grants that can never issue a token again: revoked, or every token expired and pruned.
        db
          .prepare(
            `DELETE FROM oauth_grants
              WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
                 OR (created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = oauth_grants.id))`,
          )
          .bind(now - graceMs, now - graceMs),
        // Cached metadata documents nobody uses any more (refetched on next use).
        db
          .prepare(
            `DELETE FROM oauth_clients
              WHERE kind = 'cimd' AND metadata_expires_at < ?
                AND NOT EXISTS (SELECT 1 FROM oauth_agents o WHERE o.client_id = oauth_clients.client_id)
                AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.client_id)
                AND NOT EXISTS (SELECT 1 FROM oauth_requests r WHERE r.client_id = oauth_clients.client_id)
                AND NOT EXISTS (SELECT 1 FROM oauth_codes k WHERE k.client_id = oauth_clients.client_id)`,
          )
          .bind(now - graceMs),
      ]);
      return Object.fromEntries(names.map((n, i) => [n, results[i].meta.changes ?? 0]));
    },

    // -----------------------------------------------------------------------
    // Authorization requests (consent)
    // -----------------------------------------------------------------------
    async createRequest(r: {
      id: string;
      clientId: string;
      redirectUri: string;
      redirectUriSent: boolean;
      state: string | null;
      codeChallenge: string;
      scopes: Scope[];
      scopesDefaulted: boolean;
      resource: string;
      createdAt: number;
      expiresAt: number;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO oauth_requests
             (id, client_id, redirect_uri, redirect_uri_sent, state, code_challenge, scopes, scopes_defaulted, resource, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(
          r.id,
          r.clientId,
          r.redirectUri,
          r.redirectUriSent ? 1 : 0,
          r.state,
          r.codeChallenge,
          JSON.stringify(r.scopes),
          r.scopesDefaulted ? 1 : 0,
          r.resource,
          r.createdAt,
          r.expiresAt,
        )
        .run();
    },

    async findRequest(id: string): Promise<(OAuthRequestRow & { client: OAuthClientRow }) | null> {
      const row = await db.prepare('SELECT * FROM oauth_requests WHERE id = ?').bind(id).first<OAuthRequestRow>();
      if (!row) return null;
      const client = await db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(row.client_id).first<OAuthClientRow>();
      return client ? { ...row, client } : null;
    },

    /**
     * Approves a pending, unexpired request for `workspaceId` and stores the
     * authorization code in one transaction. Returns false if the request was
     * decided concurrently or expired.
     */
    async approveRequest(a: {
      id: string;
      workspaceId: string;
      scopes: Scope[];
      now: number;
      codeHash: string;
      codeExpiresAt: number;
    }): Promise<boolean> {
      const [updated] = await db.batch([
        db
          .prepare(
            `UPDATE oauth_requests SET status = 'approved', workspace_id = ?, decided_at = ?, scopes = ?
              WHERE id = ? AND status = 'pending' AND expires_at > ?`,
          )
          .bind(a.workspaceId, a.now, JSON.stringify(a.scopes), a.id, a.now),
        db
          .prepare(
            `INSERT INTO oauth_codes
               (code_hash, request_id, client_id, workspace_id, redirect_uri, redirect_uri_sent, code_challenge, scopes, resource, created_at, expires_at)
             SELECT ?, id, client_id, workspace_id, redirect_uri, redirect_uri_sent, code_challenge, scopes, resource, ?, ?
               FROM oauth_requests WHERE id = ? AND status = 'approved' AND workspace_id = ? AND decided_at = ?`,
          )
          .bind(a.codeHash, a.now, a.codeExpiresAt, a.id, a.workspaceId, a.now),
      ]);
      return (updated.meta.changes ?? 0) === 1;
    },

    async denyRequest(id: string, workspaceId: string, now: number): Promise<boolean> {
      const res = await db
        .prepare(
          `UPDATE oauth_requests SET status = 'denied', workspace_id = ?, decided_at = ?
            WHERE id = ? AND status = 'pending' AND expires_at > ?`,
        )
        .bind(workspaceId, now, id, now)
        .run();
      return (res.meta.changes ?? 0) === 1;
    },

    // -----------------------------------------------------------------------
    // Agents connected through OAuth
    // -----------------------------------------------------------------------
    /** The active agent a client already has in a workspace, if any. */
    async findActiveAgentForClient(workspaceId: string, clientId: string): Promise<AgentRow | null> {
      return db
        .prepare(
          `SELECT a.id, a.workspace_id, a.name, a.description, a.scopes, a.created_at, a.last_used_at, a.revoked_at
             FROM oauth_agents o JOIN agents a ON a.id = o.agent_id AND a.workspace_id = o.workspace_id
            WHERE o.workspace_id = ? AND o.client_id = ? AND a.revoked_at IS NULL
            ORDER BY a.created_at DESC LIMIT 1`,
        )
        .bind(workspaceId, clientId)
        .first<AgentRow>();
    },

    async listOAuthAgentIds(workspaceId: string): Promise<Set<string>> {
      const { results } = await db.prepare('SELECT agent_id FROM oauth_agents WHERE workspace_id = ?').bind(workspaceId).all<{ agent_id: string }>();
      return new Set(results.map((r) => r.agent_id));
    },

    // -----------------------------------------------------------------------
    // Codes → grants → tokens
    // -----------------------------------------------------------------------
    async findCode(codeHash: string): Promise<OAuthCodeRow | null> {
      return db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').bind(codeHash).first<OAuthCodeRow>();
    },

    /**
     * Redeems an authorization code exactly once: marks it used, creates or
     * updates the agent, creates the grant and its first tokens, all in one
     * transaction. Every statement after the first only takes effect if this
     * call's UPDATE won (it matches on the new grant id). Returns the agent,
     * or null if the code was already used or expired.
     */
    async redeemCode(r: {
      codeHash: string;
      now: number;
      grantId: string;
      refreshable: boolean;
      /** Existing active agent to update, or a new agent to create. */
      agent: { existingId: string } | { newId: string; name: string; createdAt: string };
      agentName: string;
      tokens: NewTokens;
    }): Promise<AgentRow | null> {
      const won = `EXISTS (SELECT 1 FROM oauth_codes WHERE code_hash = ? AND grant_id = ?)`;
      const scopes = JSON.stringify(r.tokens.scopes);
      const stmts: D1PreparedStatement[] = [
        db
          .prepare(`UPDATE oauth_codes SET used_at = ?, grant_id = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`)
          .bind(r.now, r.grantId, r.codeHash, r.now),
      ];
      let agentId: string;
      if ('existingId' in r.agent) {
        agentId = r.agent.existingId;
        stmts.push(
          db
            .prepare(
              `UPDATE agents SET scopes = ?, name = ?
                WHERE id = ? AND revoked_at IS NULL
                  AND workspace_id = (SELECT workspace_id FROM oauth_codes WHERE code_hash = ? AND grant_id = ?)`,
            )
            .bind(scopes, r.agentName, agentId, r.codeHash, r.grantId),
        );
      } else {
        agentId = r.agent.newId;
        stmts.push(
          db
            .prepare(
              `INSERT INTO agents (id, workspace_id, name, description, scopes, key_hash, created_at)
               SELECT ?, workspace_id, ?, NULL, ?, ?, ? FROM oauth_codes WHERE code_hash = ? AND grant_id = ?`,
            )
            .bind(agentId, r.agent.name, scopes, `oauth:${agentId}`, r.agent.createdAt, r.codeHash, r.grantId),
          db
            .prepare(
              `INSERT INTO oauth_agents (agent_id, workspace_id, client_id, created_at)
               SELECT ?, workspace_id, client_id, ? FROM oauth_codes WHERE code_hash = ? AND grant_id = ?`,
            )
            .bind(agentId, r.now, r.codeHash, r.grantId),
        );
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO oauth_grants (id, workspace_id, agent_id, client_id, scopes, resource, refreshable, created_at)
             SELECT ?, workspace_id, ?, client_id, scopes, resource, ?, ? FROM oauth_codes
              WHERE code_hash = ? AND grant_id = ?
                AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND revoked_at IS NULL AND agents.workspace_id = oauth_codes.workspace_id)`,
          )
          .bind(r.grantId, agentId, r.refreshable ? 1 : 0, r.now, r.codeHash, r.grantId, agentId),
      );
      const workspaceRow = await db.prepare('SELECT workspace_id FROM oauth_codes WHERE code_hash = ?').bind(r.codeHash).first<{ workspace_id: string }>();
      if (!workspaceRow) return null;
      stmts.push(...tokenInserts(r.grantId, workspaceRow.workspace_id, r.now, r.tokens));
      stmts.push(
        db
          .prepare(`UPDATE oauth_clients SET first_used_at = COALESCE(first_used_at, ?) WHERE client_id = (SELECT client_id FROM oauth_codes WHERE code_hash = ? AND grant_id = ?)`)
          .bind(r.now, r.codeHash, r.grantId),
        db.prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE id = ? AND revoked_at IS NULL AND ${won}`).bind(agentId, r.codeHash, r.grantId),
      );
      const results = await db.batch<AgentRow>(stmts);
      const grant = await db.prepare('SELECT id FROM oauth_grants WHERE id = ?').bind(r.grantId).first();
      if (!grant) return null;
      return results[results.length - 1].results[0] ?? null;
    },

    async isWorkspaceSuspended(workspaceId: string): Promise<boolean> {
      return !!(await db.prepare('SELECT 1 AS x FROM workspace_suspensions WHERE workspace_id = ?').bind(workspaceId).first());
    },

    /** Revokes the grant created from a code (code reuse = the code leaked). */
    async revokeGrantOfCode(codeHash: string, now: number): Promise<void> {
      await db
        .prepare(
          `UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'code_reuse')
            WHERE id = (SELECT grant_id FROM oauth_codes WHERE code_hash = ?)`,
        )
        .bind(now, codeHash)
        .run();
    },

    async revokeGrant(grantId: string, now: number, reason: string): Promise<void> {
      await db
        .prepare(`UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, ?) WHERE id = ?`)
        .bind(now, reason, grantId)
        .run();
    },

    async revokeToken(tokenHash: string, now: number): Promise<void> {
      await db.prepare('UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?').bind(now, tokenHash).run();
    },

    /** A token with its grant and agent (any state: callers check expiry and revocation). */
    async lookupToken(tokenHash: string): Promise<OAuthTokenLookup | null> {
      return db
        .prepare(
          `SELECT t.kind, t.scopes AS token_scopes, t.expires_at, t.used_at, t.revoked_at AS token_revoked_at,
                  g.id AS grant_id, g.scopes AS grant_scopes, g.revoked_at AS grant_revoked_at, g.refreshable, g.resource, g.client_id,
                  g.workspace_id, a.id AS agent_id, a.name AS agent_name, a.description AS agent_description, a.scopes AS agent_scopes,
                  a.created_at AS agent_created_at, a.last_used_at AS agent_last_used_at, a.revoked_at AS agent_revoked_at,
                  EXISTS (SELECT 1 FROM workspace_suspensions s WHERE s.workspace_id = g.workspace_id) AS workspace_suspended
             FROM oauth_tokens t
             JOIN oauth_grants g ON g.id = t.grant_id AND g.workspace_id = t.workspace_id
             JOIN agents a ON a.id = g.agent_id AND a.workspace_id = g.workspace_id
            WHERE t.token_hash = ?`,
        )
        .bind(tokenHash)
        .first<OAuthTokenLookup>();
    },

    /**
     * Marks a refresh token as rotated. A single UPDATE, so of two concurrent
     * uses exactly one gets `true`; the other (and any later use) is reuse.
     */
    async markRefreshTokenUsed(tokenHash: string, now: number): Promise<boolean> {
      const res = await db
        .prepare(`UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND kind = 'refresh' AND used_at IS NULL AND revoked_at IS NULL`)
        .bind(now, tokenHash)
        .run();
      return (res.meta.changes ?? 0) === 1;
    },

    /** Issues tokens in an existing, unrevoked grant. Returns false if the grant is revoked. */
    async insertTokens(grantId: string, workspaceId: string, now: number, tokens: NewTokens): Promise<boolean> {
      const [access] = await db.batch(tokenInserts(grantId, workspaceId, now, tokens));
      return (access.meta.changes ?? 0) === 1;
    },

    /** Statements that delete a workspace's OAuth state (added to the deleteWorkspace batch). */
    workspaceDeletes(workspaceId: string): D1PreparedStatement[] {
      return [
        db.prepare('DELETE FROM oauth_tokens WHERE workspace_id = ?').bind(workspaceId),
        db.prepare('DELETE FROM oauth_grants WHERE workspace_id = ?').bind(workspaceId),
        db.prepare('DELETE FROM oauth_codes WHERE workspace_id = ?').bind(workspaceId),
        db.prepare('DELETE FROM oauth_agents WHERE workspace_id = ?').bind(workspaceId),
        db.prepare('DELETE FROM oauth_requests WHERE workspace_id = ?').bind(workspaceId),
      ];
    },
  };
}

export type OAuthRepository = ReturnType<typeof createOAuthRepository>;
