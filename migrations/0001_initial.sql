-- Midnight Invoice API schema (Cloudflare D1 / SQLite).
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote

-- An anonymous workspace = one browser's cloud identity. Only the SHA-256 of
-- the workspace token is stored.
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- Device-authorization requests from agents (RFC 8628 style).
-- Times are epoch milliseconds. user_code is stored normalised (no dash).
CREATE TABLE agent_registrations (
  id                TEXT PRIMARY KEY,
  device_code_hash  TEXT NOT NULL UNIQUE,
  user_code         TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  requested_scopes  TEXT NOT NULL,          -- JSON array of scopes
  status            TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'redeemed')),
  workspace_id      TEXT REFERENCES workspaces (id) ON DELETE CASCADE,
  approved_scopes   TEXT,                   -- JSON array, set on approval
  agent_id          TEXT,                   -- set on redemption
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  decided_at        INTEGER,
  last_polled_at    INTEGER
);
CREATE INDEX agent_registrations_expires_at ON agent_registrations (expires_at);
CREATE INDEX agent_registrations_workspace ON agent_registrations (workspace_id);

-- Approved agents. Only the SHA-256 of the API key is stored.
CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  scopes        TEXT NOT NULL,              -- JSON array of scopes
  key_hash      TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX agents_workspace ON agents (workspace_id);

-- Invoices. The client-visible body is JSON in `data`; the other columns are
-- what the server queries on. Ids are client-chosen UUIDs, unique per workspace.
-- Timestamps come from D1's clock (ISO-8601, ms precision).
CREATE TABLE invoices (
  workspace_id    TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  invoice_number  TEXT NOT NULL,
  number_value    INTEGER,                  -- digits of invoice_number (next-number rule)
  data            TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,                     -- soft delete (tombstone)
  created_by      TEXT NOT NULL,            -- JSON Actor
  updated_by      TEXT NOT NULL,            -- JSON Actor
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX invoices_sync ON invoices (workspace_id, updated_at, id);
CREATE INDEX invoices_number ON invoices (workspace_id, number_value) WHERE deleted_at IS NULL;

-- Default sender settings per workspace (same shape as the browser's settings store).
CREATE TABLE workspace_settings (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  data          TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Fixed-window counters for brute-force protection (user-code lookups).
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);
