-- Recurring invoices: schedules that generate an invoice from a template each period.
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote
--
-- Schedules are server-side state (not a synced collection): the configuration
-- (template, client, cadence, end condition, overrides, auto action) is JSON in
-- `data`; the fields the generator queries and updates are columns. `revision`
-- changes only with the configuration (it is the ETag); generation updates the
-- run columns without touching it. Deletes are soft (the name stays available
-- to the activity log and to invoices that reference the schedule).
CREATE TABLE recurring_schedules (
  workspace_id     TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  name             TEXT NOT NULL,
  data             TEXT NOT NULL,                 -- JSON configuration
  status           TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
  timezone         TEXT NOT NULL,                 -- IANA name; run dates are local calendar dates
  next_run_date    TEXT,                          -- YYYY-MM-DD in `timezone`; NULL once ended
  last_run_date    TEXT,
  last_invoice_id  TEXT,
  run_count        INTEGER NOT NULL DEFAULT 0,    -- generated invoices (= rows in recurring_runs with outcome 'generated')
  skipped_count    INTEGER NOT NULL DEFAULT 0,    -- periods skipped by the catch-up policy
  last_skipped     TEXT,                          -- JSON {from, to, count}
  last_error       TEXT,                          -- JSON {code, message, at, period, attempts}
  failure_count    INTEGER NOT NULL DEFAULT 0,    -- consecutive failures (drives the retry backoff)
  retry_at         TEXT,                          -- ISO; no attempt before this after a failure
  revision         INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  created_by       TEXT NOT NULL,                 -- JSON Actor
  updated_by       TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
-- The generator's scan: active schedules by next run date (all workspaces).
CREATE INDEX recurring_due ON recurring_schedules (next_run_date, workspace_id, id) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX recurring_list ON recurring_schedules (workspace_id, created_at, id) WHERE deleted_at IS NULL;

-- One row per schedule and period (run date): the exactly-once guard. A period
-- is either generated (invoice_id) or skipped by the catch-up policy. Generated
-- invoices also have an id derived from (schedule, period), so a retried or
-- concurrent run can never insert a second invoice for the same period.
CREATE TABLE recurring_runs (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  schedule_id   TEXT NOT NULL,
  period        TEXT NOT NULL,                    -- YYYY-MM-DD run date
  outcome       TEXT NOT NULL CHECK (outcome IN ('generated', 'skipped')),
  invoice_id    TEXT,
  via           TEXT NOT NULL CHECK (via IN ('schedule', 'run_now')),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, schedule_id, period)
);

-- Generated-invoice history (GET /invoices?recurring_id=…): the reference lives in the invoice JSON.
ALTER TABLE invoices ADD COLUMN recurring_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.recurringId')) VIRTUAL;
CREATE INDEX invoices_recurring ON invoices (workspace_id, recurring_id) WHERE deleted_at IS NULL AND recurring_id IS NOT NULL;
