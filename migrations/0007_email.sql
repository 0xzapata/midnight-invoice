-- Sending invoices by email (POST /api/v1/invoices/:id/send).
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote

-- One row per send attempt. No message body is stored beyond the subject.
-- Times are ISO-8601 strings from the Worker clock (ms precision).
CREATE TABLE email_messages (
  workspace_id        TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id                  TEXT NOT NULL,
  invoice_id          TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  cc                  TEXT NOT NULL DEFAULT '[]',          -- JSON array of addresses
  subject             TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  provider            TEXT NOT NULL,
  provider_message_id TEXT,
  error_code          TEXT,
  error_message       TEXT,
  actor               TEXT NOT NULL,                       -- JSON Actor (user / agent)
  agent_id            TEXT,                                -- copy of actor.agentId, for per-agent queries
  idempotency_key     TEXT,                                -- Idempotency-Key header, unique per workspace
  request_hash        TEXT,                                -- SHA-256 of the request, to detect key reuse
  status_changed      INTEGER NOT NULL DEFAULT 0,          -- 1 = this send moved the invoice from draft to sent
  attempts            INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  sent_at             TEXT,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX email_messages_invoice ON email_messages (workspace_id, invoice_id, created_at);
CREATE UNIQUE INDEX email_messages_idempotency ON email_messages (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Fixed-window send counters (rate limits and daily caps). `scope` is e.g.
-- "ws:<id>:h", "agent:<id>:d", "global:d"; `window_start` is the UTC hour or
-- day the window starts at (ISO). Old windows are pruned as new ones are written.
CREATE TABLE email_counters (
  scope         TEXT NOT NULL,
  window_start  TEXT NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (scope, window_start)
);
CREATE INDEX email_counters_window ON email_counters (window_start);
