-- Invoice status, due-date tracking and filters.
--
-- Status lives in the invoice JSON (`data`) like every other invoice field;
-- these VIRTUAL generated columns expose it (and the other filter fields) to
-- SQL without changing how rows are written. Rows written before this
-- migration have no `status` key and read as 'draft' (see shared/invoice-status.ts).
-- "Overdue" is derived at query time (status = 'sent' AND due_date < today).

ALTER TABLE invoices ADD COLUMN status TEXT
  GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.status'), 'draft')) VIRTUAL;
ALTER TABLE invoices ADD COLUMN due_date TEXT
  GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.dueDate'), '')) VIRTUAL;
ALTER TABLE invoices ADD COLUMN paid_at TEXT
  GENERATED ALWAYS AS (json_extract(data, '$.paidAt')) VIRTUAL;
ALTER TABLE invoices ADD COLUMN to_name TEXT
  GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.toName'), '')) VIRTUAL;

-- Status / due-date filters and the summary over live invoices.
CREATE INDEX invoices_status_due ON invoices (workspace_id, status, due_date) WHERE deleted_at IS NULL;
