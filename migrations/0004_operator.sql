-- Operator console: bootstrap state, encrypted runtime settings, operator
-- identities and sessions, audit log, telemetry rollups, workspace suspension.
-- Times are epoch milliseconds unless noted. See AGENTS.md "Operator console".

-- Single row (id = 1): bootstrap progress and the key hierarchy.
CREATE TABLE operator_state (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  created_at              INTEGER NOT NULL,
  -- Salt for the setup-session signing key (HKDF over INITIAL_PASSWORD).
  setup_salt              TEXT NOT NULL,
  -- Bumped by settings writes and "Reload runtime configuration"; isolates drop caches when it changes.
  config_version          INTEGER NOT NULL DEFAULT 1,
  -- Set once the first operator identity is bound. Disables the bootstrap login for good.
  bootstrap_completed_at  INTEGER,
  -- Master key (MK). mk_kcv identifies it (HMAC check value); NULL = not created yet.
  mk_kcv                  TEXT,
  mk_version              INTEGER NOT NULL DEFAULT 0,
  mk_mode                 TEXT CHECK (mk_mode IN ('wrapped', 'env')),
  mk_confirmed_at         INTEGER,                -- operator confirmed the recovery key is saved
  mk_created_at           INTEGER,
  -- Wrapped mode: MK sealed with KEK = PBKDF2-SHA-256(INITIAL_PASSWORD, kek_salt, kek_iterations).
  mk_wrapped              TEXT,
  kek_salt                TEXT,
  kek_iterations          INTEGER,
  -- Pending re-wrap for an INITIAL_PASSWORD change (promoted once the new secret is deployed).
  mk_pending_wrapped      TEXT,
  kek_pending_salt        TEXT,
  -- Pending master-key rotation in env mode (DEK sealed under the new MK; promoted once ENCRYPTION_KEY matches).
  mk_pending_kcv          TEXT,
  dek_pending_wrapped     TEXT,
  -- Passphrase-derived MK: salt + iterations so the passphrase can be used for recovery.
  mk_passphrase_salt      TEXT,
  mk_passphrase_iterations INTEGER,
  -- Data-encryption key sealed with MK.
  dek_wrapped             TEXT,
  dek_version             INTEGER NOT NULL DEFAULT 0,
  dek_rotated_at          INTEGER
);

-- Runtime settings ("server ENV settings"). Non-secret values are JSON in `value`;
-- secrets are AES-256-GCM ciphertext in `value_enc` (AAD binds key, version, DEK version).
CREATE TABLE operator_settings (
  key          TEXT PRIMARY KEY,
  secret       INTEGER NOT NULL DEFAULT 0,
  value        TEXT,
  value_enc    TEXT,
  last4        TEXT,
  version      INTEGER NOT NULL,
  dek_version  INTEGER,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT
);

-- Operators (allowlist). An entry added by email is bound to its WorkOS user on first sign-in.
CREATE TABLE operators (
  id              TEXT PRIMARY KEY,
  workos_user_id  TEXT UNIQUE,
  email           TEXT NOT NULL UNIQUE,     -- lower-case
  added_at        INTEGER NOT NULL,
  added_by        TEXT,
  last_sign_in_at INTEGER
);

-- Operator sessions. Only the SHA-256 of the session id is stored.
CREATE TABLE operator_sessions (
  id_hash       TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('setup', 'full')),
  operator_id   TEXT REFERENCES operators (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,           -- absolute timeout
  revoked_at    INTEGER,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX operator_sessions_operator ON operator_sessions (operator_id);

-- OAuth (AuthKit) authorization requests: single-use state, PKCE verifier, browser binding.
CREATE TABLE operator_oauth_states (
  state_hash          TEXT PRIMARY KEY,
  browser_nonce_hash  TEXT NOT NULL,
  code_verifier       TEXT NOT NULL,
  purpose             TEXT NOT NULL CHECK (purpose IN ('setup', 'login')),
  setup_session_hash  TEXT,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL
);

-- Failed bootstrap / recovery attempts (per client IP and global) for lockout with backoff.
CREATE TABLE operator_login_attempts (
  key           TEXT PRIMARY KEY,
  failures      INTEGER NOT NULL,
  window_start  INTEGER NOT NULL,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  lock_count    INTEGER NOT NULL DEFAULT 0
);

-- Operator audit log. Never contains secret values.
CREATE TABLE operator_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  actor_type   TEXT NOT NULL,               -- operator | bootstrap | recovery | system
  actor_id     TEXT,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  detail       TEXT,                        -- small JSON, no secrets
  ip           TEXT
);
CREATE INDEX operator_audit_at ON operator_audit (at);
CREATE INDEX operator_audit_action ON operator_audit (action, at);

-- Suspended workspaces: their token and agent keys get 403.
CREATE TABLE workspace_suspensions (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  suspended_at  INTEGER NOT NULL,
  suspended_by  TEXT,
  reason        TEXT
);

-- Last authenticated API activity per workspace (written at most every few minutes).
CREATE TABLE workspace_activity (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  last_seen_at  INTEGER NOT NULL
);

-- Request telemetry rollups. granularity: 'm' (minute) or 'h' (hour); bucket = epoch ms of bucket start.
-- metric = "<service>|<name>", e.g. "rest|GET /invoices/:id", "mcp|create_invoice".
-- h0..h9 = duration histogram (bounds in server/operator/telemetry.ts).
CREATE TABLE telemetry_rollups (
  granularity  TEXT NOT NULL,
  bucket       INTEGER NOT NULL,
  metric       TEXT NOT NULL,
  count        INTEGER NOT NULL,
  errors       INTEGER NOT NULL,            -- 5xx
  client_errors INTEGER NOT NULL,           -- 4xx
  auth_failures INTEGER NOT NULL,           -- 401 / 403
  rate_limited INTEGER NOT NULL,            -- 429
  dur_sum      INTEGER NOT NULL,
  h0 INTEGER NOT NULL DEFAULT 0, h1 INTEGER NOT NULL DEFAULT 0, h2 INTEGER NOT NULL DEFAULT 0,
  h3 INTEGER NOT NULL DEFAULT 0, h4 INTEGER NOT NULL DEFAULT 0, h5 INTEGER NOT NULL DEFAULT 0,
  h6 INTEGER NOT NULL DEFAULT 0, h7 INTEGER NOT NULL DEFAULT 0, h8 INTEGER NOT NULL DEFAULT 0,
  h9 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (granularity, bucket, metric)
);
CREATE INDEX telemetry_rollups_bucket ON telemetry_rollups (granularity, bucket);

-- Recent errors (capped). Route templates only: no ids, tokens, bodies or client IPs.
CREATE TABLE telemetry_errors (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  metric  TEXT NOT NULL,
  status  INTEGER NOT NULL,
  code    TEXT,
  ray     TEXT
);
CREATE INDEX telemetry_errors_at ON telemetry_errors (at);
