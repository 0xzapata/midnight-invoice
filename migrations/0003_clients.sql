-- Saved clients (address book) and the invoice → client reference.
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote

-- Clients. Like invoices, the client-visible body is JSON in `data`; the other
-- columns are what the server queries on (name/email for search). Ids are
-- client-chosen UUIDs, unique per workspace. Deletes are soft (tombstones for
-- sync); archiving is a field in `data` (archivedAt), not a delete.
CREATE TABLE clients (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  data          TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,                     -- soft delete (tombstone)
  created_by    TEXT NOT NULL,            -- JSON Actor
  updated_by    TEXT NOT NULL,            -- JSON Actor
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX clients_sync ON clients (workspace_id, updated_at, id);
CREATE INDEX clients_name ON clients (workspace_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

-- Invoices reference a client through `clientId` in their JSON body; this
-- generated column exposes it for queries (invoice counts per client) without
-- changing how invoices are written. NULL when the invoice has no client.
ALTER TABLE invoices ADD COLUMN client_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.clientId')) VIRTUAL;
CREATE INDEX invoices_client ON invoices (workspace_id, client_id) WHERE deleted_at IS NULL AND client_id IS NOT NULL;
