-- Optional user accounts (sign in with WorkOS AuthKit) for cloud workspaces.
-- See AGENTS.md "User accounts". Times are epoch milliseconds.
--
-- Identity model: a signed-in browser holds (1) a user session cookie, used
-- only for account management under /api/account, and (2) its own per-device
-- workspace token (`mi_ws_…`, SHA-256 in workspace_tokens) that the sync
-- engine, agents approval and MCP use exactly like the original workspace
-- token. The original token (workspaces.token_hash, the "recovery key") is
-- untouched unless the owner rotates or disables it.

-- End users. The WorkOS user id is the identity key; the email is a verified
-- copy refreshed on every sign-in (never used to link identities).
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  workos_user_id   TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL,           -- lower-case, verified at the last sign-in
  email_verified   INTEGER NOT NULL DEFAULT 0,
  name             TEXT,
  created_at       INTEGER NOT NULL,
  last_sign_in_at  INTEGER,
  disabled_at      INTEGER,                 -- set by the operator: sign-in refused, tokens revoked
  disabled_reason  TEXT
);
CREATE INDEX users_email ON users (email);
CREATE INDEX users_created ON users (created_at, id);

-- Who may use a workspace. Only role 'owner' exists today, and a user owns at
-- most one workspace (one account <-> one workspace); both are relaxed later
-- by adding roles / dropping the partial unique index, without reshaping.
CREATE TABLE workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);
CREATE UNIQUE INDEX workspace_members_one_owned_workspace ON workspace_members (user_id) WHERE role = 'owner';
CREATE UNIQUE INDEX workspace_members_one_owner ON workspace_members (workspace_id) WHERE role = 'owner';

-- Additional workspace tokens, one per signed-in browser ("device"), each
-- individually revocable. Looked up by SHA-256 like workspaces.token_hash.
CREATE TABLE workspace_tokens (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  device_label  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX workspace_tokens_workspace ON workspace_tokens (workspace_id);
CREATE INDEX workspace_tokens_user ON workspace_tokens (user_id);

-- Account sessions (cookie `__Secure-mi_user_session`, Path=/api/account).
-- Only the SHA-256 of the random session id is stored. A session is linked to
-- the device token it minted or re-bound, so revoking one ends the other.
CREATE TABLE user_sessions (
  id_hash          TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_token_id  TEXT,
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,        -- absolute timeout
  revoked_at       INTEGER,
  user_agent       TEXT
);
CREATE INDEX user_sessions_user ON user_sessions (user_id);
CREATE INDEX user_sessions_device ON user_sessions (device_token_id);

-- AuthKit authorization requests for end users: single-use state, PKCE
-- verifier, browser binding (nonce cookie), validated return path.
CREATE TABLE user_oauth_states (
  state_hash          TEXT PRIMARY KEY,
  browser_nonce_hash  TEXT NOT NULL,
  code_verifier       TEXT NOT NULL,
  return_to           TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL
);
CREATE INDEX user_oauth_states_expires ON user_oauth_states (expires_at);
