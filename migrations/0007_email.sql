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

-- Addresses the workspace owner entered themselves. Agents may only email an
-- invoice's toEmail when it is listed here (or was emailed before). Kept by
-- triggers on every write by the workspace token (browser sync, REST, MCP), so
-- a later agent edit of another field never "un-confirms" an address, an
-- agent writing a new address never confirms it, and a user save of the
-- record (re)confirms whatever address it holds.
CREATE TABLE email_confirmed_recipients (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  address       TEXT NOT NULL,              -- lower-case, trimmed
  confirmed_at  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, address)
);

CREATE TRIGGER email_confirm_invoice_insert AFTER INSERT ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND trim(coalesce(json_extract(NEW.data, '$.toEmail'), '')) <> ''
BEGIN
  INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  VALUES (NEW.workspace_id, lower(trim(json_extract(NEW.data, '$.toEmail'))), NEW.updated_at);
END;

CREATE TRIGGER email_confirm_invoice_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL AND trim(coalesce(json_extract(NEW.data, '$.toEmail'), '')) <> ''
BEGIN
  INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  VALUES (NEW.workspace_id, lower(trim(json_extract(NEW.data, '$.toEmail'))), NEW.updated_at);
END;

CREATE TRIGGER email_confirm_client_insert AFTER INSERT ON clients
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND trim(NEW.email) <> ''
BEGIN
  INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  VALUES (NEW.workspace_id, lower(trim(NEW.email)), NEW.updated_at);
END;

CREATE TRIGGER email_confirm_client_update AFTER UPDATE ON clients
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL AND trim(NEW.email) <> ''
BEGIN
  INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  VALUES (NEW.workspace_id, lower(trim(NEW.email)), NEW.updated_at);
END;

-- Existing data: addresses on records the user saved last.
INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  SELECT workspace_id, lower(trim(json_extract(data, '$.toEmail'))), updated_at FROM invoices
  WHERE deleted_at IS NULL AND json_extract(updated_by, '$.type') = 'user' AND trim(coalesce(json_extract(data, '$.toEmail'), '')) <> '';
INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
  SELECT workspace_id, lower(trim(email)), updated_at FROM clients
  WHERE deleted_at IS NULL AND json_extract(updated_by, '$.type') = 'user' AND trim(email) <> '';

-- Invoices whose sender details (fromName, fromEmail, paymentDetails) an agent
-- wrote and the user has not saved since. An agent cannot email such an
-- invoice unless those fields equal the workspace defaults (settings, which
-- agents cannot change): it must ask the user to review it in the app.
CREATE TABLE invoice_sender_review (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  invoice_id    TEXT NOT NULL,
  agent_name    TEXT,
  flagged_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, invoice_id)
);

CREATE TRIGGER invoice_review_agent_insert AFTER INSERT ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'agent'
BEGIN
  INSERT OR REPLACE INTO invoice_sender_review (workspace_id, invoice_id, agent_name, flagged_at)
  VALUES (NEW.workspace_id, NEW.id, json_extract(NEW.updated_by, '$.agentName'), NEW.updated_at);
END;

CREATE TRIGGER invoice_review_agent_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'agent' AND (
  coalesce(json_extract(NEW.data, '$.paymentDetails'), '') IS NOT coalesce(json_extract(OLD.data, '$.paymentDetails'), '')
  OR coalesce(json_extract(NEW.data, '$.fromEmail'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromEmail'), '')
  OR coalesce(json_extract(NEW.data, '$.fromName'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromName'), ''))
BEGIN
  INSERT OR REPLACE INTO invoice_sender_review (workspace_id, invoice_id, agent_name, flagged_at)
  VALUES (NEW.workspace_id, NEW.id, json_extract(NEW.updated_by, '$.agentName'), NEW.updated_at);
END;

CREATE TRIGGER invoice_review_user_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user'
BEGIN
  DELETE FROM invoice_sender_review WHERE workspace_id = NEW.workspace_id AND invoice_id = NEW.id;
END;
