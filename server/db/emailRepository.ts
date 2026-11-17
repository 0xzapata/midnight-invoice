/**
 * Data access for sent invoice emails (migration 0007_email.sql). Same rules
 * as repository.ts: parameterised statements only, every query on messages
 * scoped by workspace_id, atomic steps are single statements or a batch.
 * Times come from the Worker clock (deps.clock) so cooldowns and windows are
 * testable.
 */
import type { Actor } from '../../shared/types/invoice';

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
}

const COLUMNS =
  'workspace_id, id, invoice_id, to_address, cc, subject, status, provider, provider_message_id, error_code, error_message, actor, agent_id, idempotency_key, request_hash, status_changed, attempts, created_at, updated_at, sent_at';

export function createEmailRepository(db: D1Database) {
  /** Takes back one reserved send per window (failed reservation, or a send that never reached the provider). */
  const release = async (reservations: CounterReservation[]): Promise<void> => {
    if (reservations.length === 0) return;
    await db.batch(
      reservations.map((r) =>
        db.prepare('UPDATE email_counters SET count = MAX(count - 1, 0) WHERE scope = ? AND window_start = ?').bind(r.scope, r.windowStart),
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
     * True when the workspace owner has entered this address themselves: it is
     * the email of a saved client last written by the user, or the toEmail of
     * an invoice last written by the user (browser sync uses the workspace
     * token, so everything typed in the app counts), or an address this
     * workspace has already emailed (every earlier send passed this check or
     * was made by the user), so an agent's own later edits of a confirmed
     * invoice (e.g. the status change of the send itself) do not revoke it.
     */
    async isUserEnteredAddress(workspaceId: string, email: string): Promise<boolean> {
      const row = await db
        .prepare(
          `SELECT 1 AS ok FROM clients
             WHERE workspace_id = ? AND deleted_at IS NULL AND lower(email) = ? AND json_extract(updated_by, '$.type') = 'user'
           UNION ALL
           SELECT 1 AS ok FROM invoices
             WHERE workspace_id = ? AND deleted_at IS NULL AND lower(json_extract(data, '$.toEmail')) = ? AND json_extract(updated_by, '$.type') = 'user'
           UNION ALL
           SELECT 1 AS ok FROM email_messages
             WHERE workspace_id = ? AND status = 'sent' AND lower(to_address) = ?
           LIMIT 1`,
        )
        .bind(workspaceId, email, workspaceId, email, workspaceId, email)
        .first<{ ok: number }>();
      return !!row;
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
              `INSERT INTO email_counters (scope, window_start, count) VALUES (?, ?, 1)
               ON CONFLICT (scope, window_start) DO UPDATE SET count = count + 1
               RETURNING count`,
            )
            .bind(r.scope, r.windowStart),
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
