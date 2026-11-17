-- Workspace activity log: an append-only audit trail of what the user's
-- browsers and approved agents did (writes, PDF downloads, agent access).
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote
--
-- Rows are written by server/services/activity.ts only, in the same D1 batch
-- as the write they describe where possible. Entries never hold document
-- bodies or secrets: `changes` is a compact JSON summary (changed field
-- names, status from/to, granted scopes, counts).
--
-- Ids are time-ordered (`act_` + base36 epoch ms + sequence + random), so
-- `ORDER BY id DESC` is newest first and doubles as the paging cursor.
-- `dedupe_key` collapses repeated events into one row (a browser's bulk
-- upload is one summary row; repeated PDF downloads / revoked-key attempts in
-- a short window are recorded once); NULL for ordinary entries.
CREATE TABLE activity (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  time          TEXT NOT NULL,              -- ISO-8601 with ms
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  agent_id      TEXT,                       -- actor agent (NULL unless actor_type = 'agent')
  agent_name    TEXT,                       -- name snapshot at the time
  action        TEXT NOT NULL,              -- stable dotted code, e.g. invoice.status_changed
  entity_type   TEXT,                       -- invoice | client | settings | agent | agent_registration | workspace
  entity_id     TEXT,
  entity_label  TEXT,                       -- human label snapshot (invoice number, client name, agent name)
  changes       TEXT,                       -- JSON summary, never a document body
  source        TEXT NOT NULL CHECK (source IN ('rest', 'mcp', 'system')),
  tool          TEXT,                       -- MCP tool name when source = 'mcp'
  request_id    TEXT,
  dedupe_key    TEXT,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX activity_actor_agent ON activity (workspace_id, agent_id, id) WHERE agent_id IS NOT NULL;
CREATE INDEX activity_entity ON activity (workspace_id, entity_type, entity_id, id);
CREATE INDEX activity_time ON activity (workspace_id, time);
CREATE UNIQUE INDEX activity_dedupe ON activity (workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
