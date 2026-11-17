-- Invoice templates (reusable invoice blueprints).
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote
--
-- Same shape as clients: the template body is JSON in `data`; `name` is a
-- column for search and ordering. Ids are client-chosen UUIDs, unique per
-- workspace. Deletes are soft (tombstones for sync); archiving is a field in
-- `data` (archivedAt), not a delete. Invoices created from a template record
-- `templateId` in their own JSON body (a reference only, no column needed).
CREATE TABLE templates (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,                     -- soft delete (tombstone)
  created_by    TEXT NOT NULL,            -- JSON Actor
  updated_by    TEXT NOT NULL,            -- JSON Actor
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX templates_sync ON templates (workspace_id, updated_at, id);
CREATE INDEX templates_name ON templates (workspace_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
