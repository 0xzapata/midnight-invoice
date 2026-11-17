-- OAuth 2.1 authorization server for the MCP endpoint (POST /api/mcp).
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote
--
-- An approved OAuth client becomes an ordinary row in `agents` (name, scopes,
-- lastUsedAt, revokedAt), linked to its client in `oauth_agents`. Such agents
-- have no static API key: their `agents.key_hash` is 'oauth:<agent id>', which
-- can never equal the hex SHA-256 an API-key lookup searches for.
-- Every secret (authorization code, access token, refresh token) is stored
-- only as its SHA-256. Times are epoch milliseconds.

-- Registered clients: dynamic client registration (RFC 7591, kind 'dcr', random
-- client_id) or Client ID Metadata Documents (kind 'cimd', client_id = the
-- document's https URL, row = cached copy of the document).
CREATE TABLE oauth_clients (
  client_id            TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  client_name          TEXT NOT NULL,
  client_uri           TEXT,
  redirect_uris        TEXT NOT NULL,          -- JSON array of strings
  grant_types          TEXT NOT NULL,          -- JSON array of strings
  software_id          TEXT,
  software_version     TEXT,
  created_at           INTEGER NOT NULL,
  first_used_at        INTEGER,                -- first successful code exchange
  unused_expires_at    INTEGER,                -- dcr: deleted at this time if never used
  metadata_expires_at  INTEGER                 -- cimd: refetch the document after this time
);
CREATE INDEX oauth_clients_unused ON oauth_clients (unused_expires_at) WHERE first_used_at IS NULL;

-- Pending authorization requests: created by GET /api/oauth/authorize after
-- validation, decided on the consent screen with the workspace token.
CREATE TABLE oauth_requests (
  id                 TEXT PRIMARY KEY,         -- 256-bit random handle in the consent URL
  client_id          TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  redirect_uri       TEXT NOT NULL,
  redirect_uri_sent  INTEGER NOT NULL,         -- 1 if the request carried redirect_uri
  state              TEXT,
  code_challenge     TEXT NOT NULL,            -- PKCE S256
  scopes             TEXT NOT NULL,            -- JSON array of scopes
  scopes_defaulted   INTEGER NOT NULL,         -- 1 if the client asked for no scope
  resource           TEXT NOT NULL,            -- RFC 8707 resource (the MCP endpoint)
  status             TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  workspace_id       TEXT REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  decided_at         INTEGER
);
CREATE INDEX oauth_requests_expires ON oauth_requests (expires_at);
CREATE INDEX oauth_requests_workspace ON oauth_requests (workspace_id);

-- Authorization codes: single use, short-lived, bound to client, redirect URI,
-- PKCE challenge, resource and the approving workspace.
CREATE TABLE oauth_codes (
  code_hash          TEXT PRIMARY KEY,
  request_id         TEXT NOT NULL,
  client_id          TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  workspace_id       TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  redirect_uri       TEXT NOT NULL,
  redirect_uri_sent  INTEGER NOT NULL,
  code_challenge     TEXT NOT NULL,
  scopes             TEXT NOT NULL,
  resource           TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  used_at            INTEGER,
  grant_id           TEXT                      -- grant created by the (only) redemption
);
CREATE INDEX oauth_codes_expires ON oauth_codes (expires_at);
CREATE INDEX oauth_codes_workspace ON oauth_codes (workspace_id);

-- Agents connected through OAuth: one per (workspace, client) while active.
CREATE TABLE oauth_agents (
  agent_id      TEXT PRIMARY KEY REFERENCES agents (id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX oauth_agents_client ON oauth_agents (workspace_id, client_id);

-- Grants (token families): one per redeemed authorization code. Revoking a
-- grant (refresh-token reuse, revocation endpoint, code reuse) kills every
-- token in it; revoking the agent kills every grant of the agent.
CREATE TABLE oauth_grants (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  resource      TEXT NOT NULL,
  refreshable   INTEGER NOT NULL,              -- 1 if refresh tokens are issued
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER,
  revoked_reason TEXT
);
CREATE INDEX oauth_grants_agent ON oauth_grants (agent_id);
CREATE INDEX oauth_grants_workspace ON oauth_grants (workspace_id);

-- Access and refresh tokens (opaque, hashed).
CREATE TABLE oauth_tokens (
  token_hash    TEXT PRIMARY KEY,
  grant_id      TEXT NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  scopes        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,                       -- refresh: rotated (a second use is reuse)
  revoked_at    INTEGER
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX oauth_tokens_expires ON oauth_tokens (expires_at);
