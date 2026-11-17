-- Security fixes (see CHANGELOG "Security"). Never edit migrations 0001-0010.
-- Apply with: bun run db:migrate:local  |  bun run db:migrate:remote
--
-- Note on triggers: rows are added with `INSERT … SELECT … WHERE NOT EXISTS`
-- rather than `INSERT OR IGNORE`, because SQLite applies the conflict policy
-- of the statement that fired the trigger (e.g. the settings UPSERT) to the
-- statements inside it, which would turn a duplicate into an error.

-- ---------------------------------------------------------------------------
-- H1: sender details the user entered or approved (fraud guard for agent and
-- unattended sends, server/services/invoiceEmail.ts `requireSenderReview`).
--
-- The guard is about values, not about how an invoice came to exist: an
-- invoice may be emailed by an agent (or by a recurring schedule, unattended)
-- only when each of its fromName / fromEmail / paymentDetails equals the
-- workspace settings or a value listed here. Values are listed when the user
-- (workspace or device token) actually writes them: creating an invoice or
-- template, changing that field (OLD vs NEW, so a full-document sync PUT that
-- merely carries an agent's value approves nothing), saving the settings, or
-- the explicit review action (POST /invoices/:id/review). Values are stored
-- trim()med; lookups compare with trim() too.
CREATE TABLE sender_approved_values (
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  field         TEXT NOT NULL CHECK (field IN ('fromName', 'fromEmail', 'paymentDetails')),
  value         TEXT NOT NULL,
  approved_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, field, value)
);

CREATE TRIGGER sender_approve_invoice_insert AFTER INSERT ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user'
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, f.field, f.value, NEW.updated_at
      FROM (SELECT 'fromName' AS field, trim(coalesce(json_extract(NEW.data, '$.fromName'), '')) AS value
            UNION ALL SELECT 'fromEmail', trim(coalesce(json_extract(NEW.data, '$.fromEmail'), ''))
            UNION ALL SELECT 'paymentDetails', trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), ''))) f
     WHERE NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = f.field AND a.value = f.value);
END;

CREATE TRIGGER sender_approve_invoice_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, f.field, f.value, NEW.updated_at
      FROM (SELECT 'fromName' AS field, trim(coalesce(json_extract(NEW.data, '$.fromName'), '')) AS value,
                   coalesce(json_extract(NEW.data, '$.fromName'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromName'), '') AS changed
            UNION ALL SELECT 'fromEmail', trim(coalesce(json_extract(NEW.data, '$.fromEmail'), '')),
                   coalesce(json_extract(NEW.data, '$.fromEmail'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromEmail'), '')
            UNION ALL SELECT 'paymentDetails', trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), '')),
                   coalesce(json_extract(NEW.data, '$.paymentDetails'), '') IS NOT coalesce(json_extract(OLD.data, '$.paymentDetails'), '')) f
     WHERE f.changed
       AND NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = f.field AND a.value = f.value);
END;

CREATE TRIGGER sender_approve_template_insert AFTER INSERT ON templates
WHEN json_extract(NEW.updated_by, '$.type') = 'user'
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, 'paymentDetails', v.value, NEW.updated_at
      FROM (SELECT trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), '')) AS value) v
     WHERE NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = 'paymentDetails' AND a.value = v.value);
END;

CREATE TRIGGER sender_approve_template_update AFTER UPDATE ON templates
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL
  AND coalesce(json_extract(NEW.data, '$.paymentDetails'), '') IS NOT coalesce(json_extract(OLD.data, '$.paymentDetails'), '')
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, 'paymentDetails', v.value, NEW.updated_at
      FROM (SELECT trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), '')) AS value) v
     WHERE NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = 'paymentDetails' AND a.value = v.value);
END;

-- Settings are written by the workspace token only (agents cannot change them).
CREATE TRIGGER sender_approve_settings_insert AFTER INSERT ON workspace_settings
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, f.field, f.value, NEW.updated_at
      FROM (SELECT 'fromName' AS field, trim(coalesce(json_extract(NEW.data, '$.fromName'), '')) AS value
            UNION ALL SELECT 'fromEmail', trim(coalesce(json_extract(NEW.data, '$.fromEmail'), ''))
            UNION ALL SELECT 'paymentDetails', trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), ''))) f
     WHERE NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = f.field AND a.value = f.value);
END;

CREATE TRIGGER sender_approve_settings_update AFTER UPDATE ON workspace_settings
BEGIN
  INSERT INTO sender_approved_values (workspace_id, field, value, approved_at)
    SELECT NEW.workspace_id, f.field, f.value, NEW.updated_at
      FROM (SELECT 'fromName' AS field, trim(coalesce(json_extract(NEW.data, '$.fromName'), '')) AS value
            UNION ALL SELECT 'fromEmail', trim(coalesce(json_extract(NEW.data, '$.fromEmail'), ''))
            UNION ALL SELECT 'paymentDetails', trim(coalesce(json_extract(NEW.data, '$.paymentDetails'), ''))) f
     WHERE NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = NEW.workspace_id AND a.field = f.field AND a.value = f.value);
END;

-- Existing data stays approved: settings; templates the user saved last; and
-- invoices that were not flagged for review under the old rule, except those
-- generated by a recurring schedule (actor "system"), whose sender details
-- came from a template that may have been an agent's.
INSERT OR IGNORE INTO sender_approved_values (workspace_id, field, value, approved_at)
  SELECT workspace_id, f.field, trim(coalesce(json_extract(data, '$.' || f.field), '')), updated_at
    FROM workspace_settings, (SELECT 'fromName' AS field UNION ALL SELECT 'fromEmail' UNION ALL SELECT 'paymentDetails') f;
INSERT OR IGNORE INTO sender_approved_values (workspace_id, field, value, approved_at)
  SELECT workspace_id, 'paymentDetails', trim(coalesce(json_extract(data, '$.paymentDetails'), '')), updated_at
    FROM templates WHERE deleted_at IS NULL AND json_extract(updated_by, '$.type') = 'user';
INSERT OR IGNORE INTO sender_approved_values (workspace_id, field, value, approved_at)
  SELECT i.workspace_id, f.field, trim(coalesce(json_extract(i.data, '$.' || f.field), '')), i.updated_at
    FROM invoices i, (SELECT 'fromName' AS field UNION ALL SELECT 'fromEmail' UNION ALL SELECT 'paymentDetails') f
   WHERE i.deleted_at IS NULL
     AND json_extract(i.created_by, '$.type') IN ('user', 'agent')
     AND NOT EXISTS (SELECT 1 FROM invoice_sender_review r WHERE r.workspace_id = i.workspace_id AND r.invoice_id = i.id);

-- ---------------------------------------------------------------------------
-- L2: confirmation follows the field, not the record. A user write confirms
-- an address only when it creates the record or changes that address; any
-- other user save (a full-document sync PUT, "mark paid", a 412 merge that
-- re-sends the server's values) confirms nothing. The explicit review actions
-- (POST /invoices/:id/review, POST /clients/:id/review) confirm the rest.
-- Existing confirmations stay.
DROP TRIGGER email_confirm_invoice_update;
DROP TRIGGER email_confirm_client_update;
DROP TRIGGER invoice_review_user_update;

CREATE TRIGGER email_confirm_invoice_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL
  AND trim(coalesce(json_extract(NEW.data, '$.toEmail'), '')) <> ''
  AND lower(trim(coalesce(json_extract(NEW.data, '$.toEmail'), ''))) IS NOT lower(trim(coalesce(json_extract(OLD.data, '$.toEmail'), '')))
BEGIN
  INSERT INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
    SELECT NEW.workspace_id, lower(trim(json_extract(NEW.data, '$.toEmail'))), NEW.updated_at
     WHERE NOT EXISTS (SELECT 1 FROM email_confirmed_recipients r WHERE r.workspace_id = NEW.workspace_id AND r.address = lower(trim(json_extract(NEW.data, '$.toEmail'))));
END;

CREATE TRIGGER email_confirm_client_update AFTER UPDATE ON clients
WHEN json_extract(NEW.updated_by, '$.type') = 'user' AND NEW.deleted_at IS NULL AND trim(NEW.email) <> ''
  AND lower(trim(NEW.email)) IS NOT lower(trim(OLD.email))
BEGIN
  INSERT INTO email_confirmed_recipients (workspace_id, address, confirmed_at)
    SELECT NEW.workspace_id, lower(trim(NEW.email)), NEW.updated_at
     WHERE NOT EXISTS (SELECT 1 FROM email_confirmed_recipients r WHERE r.workspace_id = NEW.workspace_id AND r.address = lower(trim(NEW.email)));
END;

-- The review flag now only says who wrote the sender details or recipient
-- and what they were before (for the "Needs your review" banner); whether an
-- invoice may be sent is decided by sender_approved_values and
-- email_confirmed_recipients. It is removed by the explicit review action,
-- never by an unrelated user save.
ALTER TABLE invoice_sender_review ADD COLUMN previous TEXT; -- JSON {fromName, fromEmail, paymentDetails, toEmail} before the first agent change

DROP TRIGGER invoice_review_agent_update;
CREATE TRIGGER invoice_review_agent_update AFTER UPDATE ON invoices
WHEN json_extract(NEW.updated_by, '$.type') = 'agent' AND (
  coalesce(json_extract(NEW.data, '$.paymentDetails'), '') IS NOT coalesce(json_extract(OLD.data, '$.paymentDetails'), '')
  OR coalesce(json_extract(NEW.data, '$.fromEmail'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromEmail'), '')
  OR coalesce(json_extract(NEW.data, '$.fromName'), '') IS NOT coalesce(json_extract(OLD.data, '$.fromName'), '')
  OR coalesce(json_extract(NEW.data, '$.toEmail'), '') IS NOT coalesce(json_extract(OLD.data, '$.toEmail'), ''))
BEGIN
  UPDATE invoice_sender_review SET agent_name = json_extract(NEW.updated_by, '$.agentName'), flagged_at = NEW.updated_at
   WHERE workspace_id = NEW.workspace_id AND invoice_id = NEW.id;
  INSERT INTO invoice_sender_review (workspace_id, invoice_id, agent_name, flagged_at, previous)
    SELECT NEW.workspace_id, NEW.id, json_extract(NEW.updated_by, '$.agentName'), NEW.updated_at,
           json_object('fromName', coalesce(json_extract(OLD.data, '$.fromName'), ''), 'fromEmail', coalesce(json_extract(OLD.data, '$.fromEmail'), ''),
                       'paymentDetails', coalesce(json_extract(OLD.data, '$.paymentDetails'), ''), 'toEmail', coalesce(json_extract(OLD.data, '$.toEmail'), ''))
     WHERE NOT EXISTS (SELECT 1 FROM invoice_sender_review r WHERE r.workspace_id = NEW.workspace_id AND r.invoice_id = NEW.id);
END;
