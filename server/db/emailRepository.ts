/**
 * Data access for sent invoice emails (migration 0007_email.sql). Same rules
 * as repository.ts: parameterised statements only, every query on messages
 * scoped by workspace_id, atomic steps are single statements or a batch.
 * Times come from the Worker clock (deps.clock) so cooldowns and windows are
 * testable.
 */
import type { Actor } from '../../shared/types/invoice';

/** Sender fields an agent could change to redirect a payment or replies (fraud guard, `requireSenderReview`). */
export const SENDER_FIELDS = ['fromName', 'fromEmail', 'paymentDetails'] as const;
export type SenderField = (typeof SENDER_FIELDS)[number];

export interface ReviewCandidateRow {
  id: string;
  invoice_number: string;
  revision: number;
  from_name: string;
  from_email: string;
  payment_details: string;
  to_email: string;
  agent_name: string | null;
  previous: string | null;
}

export interface EmailMessageRow {
  workspace_id: string;
  id: string;
  invoice_id: string;
  to_address: string;
  cc: string;
  subject: string;
  status: 'queued' | 'sent' | 'failed';
  provider: string;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  actor: string;
  agent_id: string | null;
  idempotency_key: string | null;
  request_hash: string | null;
  status_changed: number;
  attempts: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface CounterReservation {
  scope: string;
  windowStart: string;
  limit: number;
  /** How much this send counts (its recipients, to + cc); default 1. */
  amount?: number;
}

const COLUMNS =
  'workspace_id, id, invoice_id, to_address, cc, subject, status, provider, provider_message_id, error_code, error_message, actor, agent_id, idempotency_key, request_hash, status_changed, attempts, created_at, updated_at, sent_at';

export function createEmailRepository(db: D1Database) {
  /** Takes back one reserved send per window (failed reservation, or a send that never reached the provider). */
  const release = async (reservations: CounterReservation[]): Promise<void> => {
    if (reservations.length === 0) return;
    await db.batch(
      reservations.map((r) =>
        db.prepare('UPDATE email_counters SET count = MAX(count - ?, 0) WHERE scope = ? AND window_start = ?').bind(r.amount ?? 1, r.scope, r.windowStart),
      ),
    );
  };

  return {
    async findByIdempotencyKey(workspaceId: string, key: string): Promise<EmailMessageRow | null> {
      return db
        .prepare(`SELECT ${COLUMNS} FROM email_messages WHERE workspace_id = ? AND idempotency_key = ?`)
        .bind(workspaceId, key)
        .first<EmailMessageRow>();
    },

    /** Inserts a queued attempt. False if the idempotency key is already taken (concurrent request). */
    async insertQueued(m: {
      workspaceId: string;
      id: string;
      invoiceId: string;
      to: string;
      cc: string[];
      subject: string;
      provider: string;
      actor: Actor;
      idempotencyKey: string | null;
      requestHash: string | null;
      now: string;
    }): Promise<boolean> {
      const res = await db
        .prepare(
          `INSERT OR IGNORE INTO email_messages
             (workspace_id, id, invoice_id, to_address, cc, subject, status, provider, actor, agent_id, idempotency_key, request_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          m.workspaceId,
          m.id,
          m.invoiceId,
          m.to,
          JSON.stringify(m.cc),
          m.subject,
          m.provider,
          JSON.stringify(m.actor),
          m.actor.agentId ?? null,
          m.idempotencyKey,
          m.requestHash,
          m.now,
          m.now,
        )
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    /** Re-queues a failed (or stale queued) attempt for a retry with the same key. Compare-and-set on updated_at. */
    async requeue(workspaceId: string, id: string, expectedUpdatedAt: string, now: string): Promise<boolean> {
      const res = await db
        .prepare(
          `UPDATE email_messages SET status = 'queued', error_code = NULL, error_message = NULL, attempts = attempts + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND status <> 'sent' AND updated_at = ?`,
        )
        .bind(now, workspaceId, id, expectedUpdatedAt)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async markSent(workspaceId: string, id: string, providerMessageId: string, now: string): Promise<void> {
      await db
        .prepare(`UPDATE email_messages SET status = 'sent', provider_message_id = ?, sent_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
        .bind(providerMessageId, now, now, workspaceId, id)
        .run();
    },

    async markStatusChanged(workspaceId: string, id: string): Promise<void> {
      await db.prepare('UPDATE email_messages SET status_changed = 1 WHERE workspace_id = ? AND id = ?').bind(workspaceId, id).run();
    },

    async markFailed(workspaceId: string, id: string, code: string, message: string, now: string): Promise<void> {
      await db
        .prepare(`UPDATE email_messages SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
        .bind(code, message.slice(0, 500), now, workspaceId, id)
        .run();
    },

    async get(workspaceId: string, id: string): Promise<EmailMessageRow | null> {
      return db.prepare(`SELECT ${COLUMNS} FROM email_messages WHERE workspace_id = ? AND id = ?`).bind(workspaceId, id).first<EmailMessageRow>();
    },

    /** Newest successful (or in-flight) send of an invoice, for the resend cooldown. */
    async lastDeliveredAt(workspaceId: string, invoiceId: string, excludeId: string | null = null): Promise<string | null> {
      const row = await db
        .prepare(
          `SELECT MAX(created_at) AS at FROM email_messages
           WHERE workspace_id = ? AND invoice_id = ? AND status IN ('sent', 'queued') AND id <> ?`,
        )
        .bind(workspaceId, invoiceId, excludeId ?? '')
        .first<{ at: string | null }>();
      return row?.at ?? null;
    },

    async listForInvoice(workspaceId: string, invoiceId: string, limit: number): Promise<EmailMessageRow[]> {
      const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM email_messages WHERE workspace_id = ? AND invoice_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(workspaceId, invoiceId, limit)
        .all<EmailMessageRow>();
      return results;
    },

    /**
     * True when the workspace owner entered this address themselves: it is in
     * `email_confirmed_recipients` (kept by triggers on every write made with
     * the workspace token — the app's sync, REST or MCP — to an invoice's
     * toEmail or a client's email), or this workspace has already emailed it
     * (every earlier send was made by the user or passed this check).
     * Field-level by construction: an agent editing another field of a record
     * never revokes a confirmation, an agent writing an address never creates
     * one, and only a user write that creates the record or changes the
     * address confirms it (migration 0011), or the explicit review action.
     */
    async isUserEnteredAddress(workspaceId: string, email: string): Promise<boolean> {
      const row = await db
        .prepare(
          `SELECT 1 AS ok FROM email_confirmed_recipients WHERE workspace_id = ? AND address = ?
           UNION ALL
           SELECT 1 AS ok FROM email_messages WHERE workspace_id = ? AND status = 'sent' AND lower(to_address) = ?
           LIMIT 1`,
        )
        .bind(workspaceId, email, workspaceId, email)
        .first<{ ok: number }>();
      return !!row;
    },

    /**
     * Which of the given sender values the user entered or approved in this
     * workspace (`sender_approved_values`, migration 0011: kept by triggers on
     * the user's own writes of that field and by the review action). Values
     * are compared trim()med, like the triggers store them.
     */
    /**
     * "Needs your review" candidates (a superset; the service applies the
     * exact rules): live, non-void invoices with a sender value the user never
     * entered or approved, or a toEmail the user never entered; newest first.
     */
    async reviewCandidateInvoices(workspaceId: string, limit: number): Promise<ReviewCandidateRow[]> {
      const field = (f: SenderField) => `json_extract(i.data, '$.${f}')`;
      const notApproved = (f: SenderField) =>
        `NOT EXISTS (SELECT 1 FROM sender_approved_values a WHERE a.workspace_id = i.workspace_id AND a.field = '${f}' AND a.value = trim(coalesce(${field(f)}, '')))`;
      const to = "json_extract(i.data, '$.toEmail')";
      const { results } = await db
        .prepare(
          `SELECT i.id, i.invoice_number, i.revision,
                  coalesce(${field('fromName')}, '') AS from_name, coalesce(${field('fromEmail')}, '') AS from_email,
                  coalesce(${field('paymentDetails')}, '') AS payment_details, coalesce(${to}, '') AS to_email,
                  f.agent_name, f.previous
             FROM invoices i LEFT JOIN invoice_sender_review f ON f.workspace_id = i.workspace_id AND f.invoice_id = i.id
            WHERE i.workspace_id = ? AND i.deleted_at IS NULL AND coalesce(json_extract(i.data, '$.status'), 'draft') <> 'void'
              AND (${SENDER_FIELDS.map(notApproved).join(' OR ')}
                   OR (trim(coalesce(${to}, '')) <> ''
                       AND NOT EXISTS (SELECT 1 FROM email_confirmed_recipients r WHERE r.workspace_id = i.workspace_id AND r.address = lower(trim(${to})))
                       AND NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.workspace_id = i.workspace_id AND m.status = 'sent' AND lower(m.to_address) = lower(trim(${to})))))
            ORDER BY i.updated_at DESC LIMIT ?`,
        )
        .bind(workspaceId, limit)
        .all<ReviewCandidateRow>();
      return results;
    },

    /** Live clients whose email address the user never entered (newest first). */
    async unconfirmedClients(workspaceId: string, limit: number) {
      const { results } = await db
        .prepare(
          `SELECT c.id, c.name, c.email, c.revision, json_extract(c.updated_by, '$.agentName') AS agent_name FROM clients c
            WHERE c.workspace_id = ? AND c.deleted_at IS NULL AND trim(c.email) <> ''
              AND NOT EXISTS (SELECT 1 FROM email_confirmed_recipients r WHERE r.workspace_id = c.workspace_id AND r.address = lower(trim(c.email)))
              AND NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.workspace_id = c.workspace_id AND m.status = 'sent' AND lower(m.to_address) = lower(trim(c.email)))
            ORDER BY c.updated_at DESC LIMIT ?`,
        )
        .bind(workspaceId, limit)
        .all<{ id: string; name: string; email: string; revision: number; agent_name: string | null }>();
      return results;
    },

    /**
     * The review action as one batch: approves `values`, confirms `address`
     * and clears the invoice's review flag — each statement only while the
     * invoice is still at `revision`. The first statement's row says whether
     * it was (`ok`); `extra` (activity) should be guarded with `guard`.
     */
    reviewInvoiceStatements(a: { workspaceId: string; invoiceId: string; revision: number; values: Record<SenderField, string>; address: string | null; now: string }) {
      const guard = { sql: 'EXISTS (SELECT 1 FROM invoices WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL)', params: [a.workspaceId, a.invoiceId, a.revision] };
      const statements: D1PreparedStatement[] = [db.prepare(`SELECT ${guard.sql} AS ok`).bind(...guard.params)];
      for (const f of SENDER_FIELDS) {
        statements.push(
          db
            .prepare(`INSERT OR IGNORE INTO sender_approved_values (workspace_id, field, value, approved_at) SELECT ?, ?, trim(?), ? WHERE ${guard.sql}`)
            .bind(a.workspaceId, f, a.values[f], a.now, ...guard.params),
        );
      }
      if (a.address) {
        statements.push(
          db
            .prepare(`INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at) SELECT ?, ?, ? WHERE ${guard.sql}`)
            .bind(a.workspaceId, a.address, a.now, ...guard.params),
        );
      }
      statements.push(db.prepare(`DELETE FROM invoice_sender_review WHERE workspace_id = ? AND invoice_id = ? AND ${guard.sql}`).bind(a.workspaceId, a.invoiceId, ...guard.params));
      return { statements, guard };
    },

    /** The client review action: confirms `address` only while the client is still at `revision` (first row: `ok`). */
    reviewClientStatements(a: { workspaceId: string; clientId: string; revision: number; address: string; now: string }) {
      const guard = { sql: 'EXISTS (SELECT 1 FROM clients WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL)', params: [a.workspaceId, a.clientId, a.revision] };
      return {
        statements: [
          db.prepare(`SELECT ${guard.sql} AS ok`).bind(...guard.params),
          db
            .prepare(`INSERT OR IGNORE INTO email_confirmed_recipients (workspace_id, address, confirmed_at) SELECT ?, ?, ? WHERE ${guard.sql}`)
            .bind(a.workspaceId, a.address, a.now, ...guard.params),
        ],
        guard,
      };
    },

    /**
     * Who may send from this workspace (security fix M2): whether it is owned
     * by an account with a verified email that is not disabled
     * (`workspace_members` / `users`, migration 0010), and how old it is.
     */
    async sendingProfile(workspaceId: string): Promise<{ hasAccount: boolean; createdAt: string | null }> {
      const row = await db
        .prepare(
          `SELECT w.created_at,
                  EXISTS (SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
                           WHERE m.workspace_id = w.id AND m.role = 'owner' AND u.email_verified = 1 AND u.disabled_at IS NULL) AS has_account
             FROM workspaces w WHERE w.id = ?`,
        )
        .bind(workspaceId)
        .first<{ created_at: string; has_account: number }>();
      return { hasAccount: !!row?.has_account, createdAt: row?.created_at ?? null };
    },

    async approvedSenderFields(workspaceId: string, values: Partial<Record<SenderField, string>>): Promise<Set<SenderField>> {
      const entries = Object.entries(values) as [SenderField, string][];
      if (entries.length === 0) return new Set();
      const { results } = await db
        .prepare(`SELECT field FROM sender_approved_values WHERE workspace_id = ? AND (${entries.map(() => '(field = ? AND value = trim(?))').join(' OR ')})`)
        .bind(workspaceId, ...entries.flatMap(([f, v]) => [f, v]))
        .all<{ field: SenderField }>();
      return new Set(results.map((r) => r.field));
    },

    /** Who (which agent) last wrote an invoice's sender details or recipient, and their values before (triggers, migrations 0007/0011). Display only. */
    async senderReviewFlag(workspaceId: string, invoiceId: string): Promise<{ agent_name: string | null; flagged_at: string; previous: string | null } | null> {
      return db
        .prepare('SELECT agent_name, flagged_at, previous FROM invoice_sender_review WHERE workspace_id = ? AND invoice_id = ?')
        .bind(workspaceId, invoiceId)
        .first<{ agent_name: string | null; flagged_at: string; previous: string | null }>();
    },

    /**
     * Counts one send against every window, all or nothing: increments all
     * counters in one batch, and if any went over its limit, takes them all
     * back and reports the first exceeded one. Old windows are pruned in the
     * same batch.
     */
    async reserve(reservations: CounterReservation[], pruneBefore: string): Promise<{ ok: true } | { ok: false; exceeded: CounterReservation }> {
      const results = await db.batch<{ count: number }>([
        ...reservations.map((r) =>
          db
            .prepare(
              `INSERT INTO email_counters (scope, window_start, count) VALUES (?1, ?2, ?3)
               ON CONFLICT (scope, window_start) DO UPDATE SET count = count + ?3
               RETURNING count`,
            )
            .bind(r.scope, r.windowStart, r.amount ?? 1),
        ),
        db.prepare('DELETE FROM email_counters WHERE window_start < ?').bind(pruneBefore),
      ]);
      const exceeded = reservations.find((r, i) => (results[i]?.results?.[0]?.count ?? 0) > r.limit);
      if (!exceeded) return { ok: true };
      await release(reservations);
      return { ok: false, exceeded };
    },

    release,
  };
}

export type EmailRepository = ReturnType<typeof createEmailRepository>;
