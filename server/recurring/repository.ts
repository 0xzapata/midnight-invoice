/**
 * Data access for recurring schedules and their runs (migration 0009). Same
 * rules as server/db/repository.ts: parameterised statements only, every
 * workspace query scoped by workspace_id (the generator's scan is the one
 * cross-workspace read, like the activity retention job), D1's clock for
 * stored timestamps, single statements or batches for atomic steps.
 */
import type { Actor } from '../../shared/types/invoice';
import type { RecurringAutoAction, RecurringFrequency, RecurringStatus } from '../../shared/recurring';
import { firstWith, type WriteAttachment } from '../db/repository';

const DB_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export interface ScheduleRow {
  workspace_id: string;
  id: string;
  name: string;
  data: string;
  status: RecurringStatus;
  timezone: string;
  next_run_date: string | null;
  last_run_date: string | null;
  last_invoice_id: string | null;
  run_count: number;
  skipped_count: number;
  last_skipped: string | null;
  last_error: string | null;
  failure_count: number;
  retry_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
  /** `agent_content_edits.seq` when the user last approved automatic emailing (migration 0011); null = never. */
  email_approved_seq: number | null;
}

/** The newest agent edit sequence number: what the user approves when they save or re-approve a schedule. */
const CURRENT_EDIT_SEQ = '(SELECT coalesce(max(seq), 0) FROM agent_content_edits)';

/** Due-scan row: the schedule plus whether its workspace is suspended. */
export type DueRow = ScheduleRow & { suspended: number };

/** Configuration persisted in `recurring_schedules.data` (JSON). */
export interface StoredScheduleData {
  version: number;
  name: string;
  templateId: string;
  clientId: string | null;
  frequency: RecurringFrequency;
  startDate: string;
  timezone: string;
  endDate: string | null;
  maxOccurrences: number | null;
  autoAction: RecurringAutoAction;
  overrides: { notes: string | null; taxRate: number | null };
}

const COLUMNS =
  'workspace_id, id, name, data, status, timezone, next_run_date, last_run_date, last_invoice_id, run_count, skipped_count, last_skipped, last_error, failure_count, retry_at, revision, created_at, updated_at, deleted_at, created_by, updated_by, email_approved_seq';

export function createRecurringRepository(db: D1Database) {
  return {
    async get(workspaceId: string, id: string): Promise<ScheduleRow | null> {
      return db.prepare(`SELECT ${COLUMNS} FROM recurring_schedules WHERE workspace_id = ? AND id = ?`).bind(workspaceId, id).first<ScheduleRow>();
    },

    /** Live schedules, oldest first (a workspace has at most `recurring.maxSchedulesPerWorkspace`). */
    async list(workspaceId: string, opts: { statuses?: string[]; templateId?: string } = {}): Promise<ScheduleRow[]> {
      const where = ['workspace_id = ?', 'deleted_at IS NULL'];
      const params: unknown[] = [workspaceId];
      if (opts.statuses?.length) {
        where.push(`status IN (${opts.statuses.map(() => '?').join(', ')})`);
        params.push(...opts.statuses);
      }
      if (opts.templateId) {
        where.push(`json_extract(data, '$.templateId') = ?`);
        params.push(opts.templateId);
      }
      const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM recurring_schedules WHERE ${where.join(' AND ')} ORDER BY created_at, id LIMIT 10000`)
        .bind(...params)
        .all<ScheduleRow>();
      return results;
    },

    async countLive(workspaceId: string): Promise<number> {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM recurring_schedules WHERE workspace_id = ? AND deleted_at IS NULL').bind(workspaceId).first<{ n: number }>();
      return row?.n ?? 0;
    },

    /** Inserts a schedule only while the workspace has fewer than `max` live ones (one statement: no race past the limit). */
    async insert(
      args: { workspaceId: string; id: string; data: StoredScheduleData; status: RecurringStatus; nextRunDate: string | null; actor: Actor; max: number; approveEmail?: boolean },
      also?: WriteAttachment,
    ): Promise<ScheduleRow | null> {
      const actor = JSON.stringify(args.actor);
      const stmt = db
        .prepare(
          `INSERT INTO recurring_schedules (workspace_id, id, name, data, status, timezone, next_run_date, revision, created_at, updated_at, created_by, updated_by, email_approved_seq)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ${DB_NOW}, ${DB_NOW}, ?8, ?8, CASE WHEN ?10 THEN ${CURRENT_EDIT_SEQ} ELSE NULL END
            WHERE (SELECT COUNT(*) FROM recurring_schedules WHERE workspace_id = ?1 AND deleted_at IS NULL) < ?9
           ON CONFLICT (workspace_id, id) DO NOTHING
           RETURNING ${COLUMNS}`,
        )
        .bind(args.workspaceId, args.id, args.data.name, JSON.stringify(args.data), args.status, args.data.timezone, args.nextRunDate, actor, args.max, args.approveEmail ? 1 : 0);
      return firstWith<ScheduleRow>(db, stmt, also);
    },

    /**
     * Writes a new configuration and/or status (a revision). `resetFailures`
     * clears the last error and retry time (the user changed something).
     * With `expectedRevision` only if it still matches. Null if nothing matched.
     */
    async update(
      args: {
        workspaceId: string;
        id: string;
        data: StoredScheduleData;
        status: RecurringStatus;
        nextRunDate: string | null;
        actor: Actor;
        expectedRevision: number;
        resetFailures: boolean;
        skipped?: { count: number; last: { from: string; to: string; count: number } } | null;
        extra?: D1PreparedStatement[];
        /** The user saved the configuration: approve automatic emailing of the current template/client content. */
        approveEmail?: boolean;
      },
      also?: WriteAttachment,
    ): Promise<ScheduleRow | null> {
      const stmt = db
        .prepare(
          `UPDATE recurring_schedules
              SET name = ?1, data = ?2, status = ?3, timezone = ?4, next_run_date = ?5, updated_by = ?6,
                  revision = revision + 1, updated_at = ${DB_NOW},
                  last_error = CASE WHEN ?7 THEN NULL ELSE last_error END,
                  failure_count = CASE WHEN ?7 THEN 0 ELSE failure_count END,
                  retry_at = CASE WHEN ?7 THEN NULL ELSE retry_at END,
                  skipped_count = skipped_count + ?8,
                  last_skipped = COALESCE(?9, last_skipped),
                  email_approved_seq = CASE WHEN ?13 THEN ${CURRENT_EDIT_SEQ} ELSE email_approved_seq END
            WHERE workspace_id = ?10 AND id = ?11 AND deleted_at IS NULL AND revision = ?12
        RETURNING ${COLUMNS}`,
        )
        .bind(
          args.data.name,
          JSON.stringify(args.data),
          args.status,
          args.data.timezone,
          args.nextRunDate,
          JSON.stringify(args.actor),
          args.resetFailures ? 1 : 0,
          args.skipped?.count ?? 0,
          args.skipped ? JSON.stringify(args.skipped.last) : null,
          args.workspaceId,
          args.id,
          args.expectedRevision,
          args.approveEmail ? 1 : 0,
        );
      const attachment = also || args.extra?.length ? { statements: [...(also?.statements ?? []), ...(args.extra ?? [])], onError: also?.onError } : undefined;
      return firstWith<ScheduleRow>(db, stmt, attachment);
    },

    /**
     * Pauses the active schedules an agent created or changed last (the agent
     * was revoked), with a visible reason in last_error. Returns them.
     */
    async pauseSchedulesOfAgent(workspaceId: string, agentId: string, error: object): Promise<{ id: string; name: string }[]> {
      const { results } = await db
        .prepare(
          `UPDATE recurring_schedules
              SET status = 'paused', last_error = ?3, retry_at = NULL, revision = revision + 1, updated_at = ${DB_NOW}
            WHERE workspace_id = ?1 AND deleted_at IS NULL AND status = 'active'
              AND (json_extract(created_by, '$.agentId') = ?2 OR json_extract(updated_by, '$.agentId') = ?2)
        RETURNING id, name`,
        )
        .bind(workspaceId, agentId, JSON.stringify(error))
        .all<{ id: string; name: string }>();
      return results;
    },

    /** "Re-approve" automatic emailing (user only): approves the content as it is now. Null if the schedule is gone. */
    async approveEmail(workspaceId: string, id: string, also?: WriteAttachment): Promise<ScheduleRow | null> {
      const stmt = db
        .prepare(
          `UPDATE recurring_schedules SET email_approved_seq = ${CURRENT_EDIT_SEQ}
            WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL RETURNING ${COLUMNS}`,
        )
        .bind(workspaceId, id);
      return firstWith<ScheduleRow>(db, stmt, also);
    },

    /**
     * Content an agent (or anyone but the user) changed after the user last
     * approved automatic emailing: the template, the client's email or the
     * generated invoice. Empty = nothing to review. `approvedSeq` null = never
     * approved (everything counts).
     */
    async agentEditsSince(
      workspaceId: string,
      approvedSeq: number | null,
      refs: { templateId: string | null; clientIds: string[]; invoiceId: string | null },
    ): Promise<{ entity_type: 'template' | 'client' | 'invoice'; entity_id: string; agent_name: string | null }[]> {
      const clientIds = refs.clientIds.filter(Boolean);
      const { results } = await db
        .prepare(
          `SELECT entity_type, entity_id, agent_name FROM agent_content_edits e
            WHERE e.workspace_id = ?1 AND e.seq > ?2
              AND ((e.entity_type = 'template' AND e.entity_id = ?3)
                   OR (e.entity_type = 'invoice' AND e.entity_id = ?4)
                   OR (e.entity_type = 'client' AND e.entity_id IN (SELECT value FROM json_each(?5))))
              AND e.seq = (SELECT max(seq) FROM agent_content_edits x WHERE x.workspace_id = e.workspace_id AND x.entity_type = e.entity_type AND x.entity_id = e.entity_id)
            ORDER BY e.seq`,
        )
        .bind(workspaceId, approvedSeq ?? -1, refs.templateId ?? '', refs.invoiceId ?? '', JSON.stringify(clientIds))
        .all<{ entity_type: 'template' | 'client' | 'invoice'; entity_id: string; agent_name: string | null }>();
      return results;
    },

    async softDelete(args: { workspaceId: string; id: string; actor: Actor; expectedRevision?: number }, also?: WriteAttachment): Promise<ScheduleRow | null> {
      const revisionClause = args.expectedRevision === undefined ? '' : ' AND revision = ?4';
      const params: unknown[] = [JSON.stringify(args.actor), args.workspaceId, args.id];
      if (args.expectedRevision !== undefined) params.push(args.expectedRevision);
      const stmt = db
        .prepare(
          `UPDATE recurring_schedules
              SET deleted_at = ${DB_NOW}, updated_at = ${DB_NOW}, updated_by = ?1, revision = revision + 1, next_run_date = NULL
            WHERE workspace_id = ?2 AND id = ?3 AND deleted_at IS NULL${revisionClause}
        RETURNING ${COLUMNS}`,
        )
        .bind(...params);
      return firstWith<ScheduleRow>(db, stmt, also);
    },

    // -----------------------------------------------------------------------
    // Generator
    // -----------------------------------------------------------------------

    /**
     * Active schedules whose next run date is on or before `maxDate` and that
     * are not waiting for a retry, ordered by (next_run_date, workspace_id,
     * id) after the keyset cursor. The caller filters by each schedule's local
     * date (`maxDate` is the latest local date anywhere on Earth).
     */
    async dueCandidates(args: { maxDate: string; nowIso: string; after: { date: string; workspaceId: string; id: string } | null; limit: number }): Promise<DueRow[]> {
      const params: unknown[] = [args.maxDate, args.nowIso];
      let cursor = '';
      if (args.after) {
        cursor = `AND (s.next_run_date > ?3 OR (s.next_run_date = ?3 AND (s.workspace_id > ?4 OR (s.workspace_id = ?4 AND s.id > ?5))))`;
        params.push(args.after.date, args.after.workspaceId, args.after.id);
      }
      params.push(args.limit);
      const { results } = await db
        .prepare(
          `SELECT ${COLUMNS.split(', ').map((c) => `s.${c}`).join(', ')},
                  EXISTS (SELECT 1 FROM workspace_suspensions w WHERE w.workspace_id = s.workspace_id) AS suspended
             FROM recurring_schedules s
            WHERE s.status = 'active' AND s.deleted_at IS NULL AND s.next_run_date IS NOT NULL AND s.next_run_date <= ?1
              AND (s.retry_at IS NULL OR s.retry_at <= ?2) ${cursor}
            ORDER BY s.next_run_date, s.workspace_id, s.id
            LIMIT ?${params.length}`,
        )
        .bind(...params)
        .all<DueRow>();
      return results;
    },

    /** The run recorded for a period, if any. */
    async getRun(workspaceId: string, scheduleId: string, period: string): Promise<{ outcome: string; invoice_id: string | null } | null> {
      return db
        .prepare('SELECT outcome, invoice_id FROM recurring_runs WHERE workspace_id = ? AND schedule_id = ? AND period = ?')
        .bind(workspaceId, scheduleId, period)
        .first();
    },

    /** Records a generated period (no-op if the period is already recorded), only once the invoice exists. */
    generatedRunStatement(args: { workspaceId: string; scheduleId: string; period: string; invoiceId: string; via: 'schedule' | 'run_now' }): D1PreparedStatement {
      return db
        .prepare(
          `INSERT INTO recurring_runs (workspace_id, schedule_id, period, outcome, invoice_id, via, created_at)
           SELECT ?1, ?2, ?3, 'generated', ?4, ?5, ${DB_NOW}
            WHERE EXISTS (SELECT 1 FROM invoices WHERE workspace_id = ?1 AND id = ?4)
           ON CONFLICT (workspace_id, schedule_id, period) DO NOTHING`,
        )
        .bind(args.workspaceId, args.scheduleId, args.period, args.invoiceId, args.via);
    },

    /** Records periods skipped by the catch-up policy (already recorded ones are left alone). */
    skippedRunStatements(args: { workspaceId: string; scheduleId: string; periods: string[]; via: 'schedule' | 'run_now' }): D1PreparedStatement[] {
      return args.periods.map((period) =>
        db
          .prepare(
            `INSERT INTO recurring_runs (workspace_id, schedule_id, period, outcome, invoice_id, via, created_at)
             VALUES (?, ?, ?, 'skipped', NULL, ?, ${DB_NOW})
             ON CONFLICT (workspace_id, schedule_id, period) DO NOTHING`,
          )
          .bind(args.workspaceId, args.scheduleId, period, args.via),
      );
    },

    /**
     * Advances a schedule past a generated period: compare-and-set on the
     * next run date it was read with, so overlapping runs advance it once.
     * `run_count` is recounted from recurring_runs (exact after any retry).
     */
    advanceStatement(args: {
      workspaceId: string;
      scheduleId: string;
      expectedNextRunDate: string;
      period: string;
      invoiceId: string;
      nextRunDate: string | null;
      skippedCount: number;
      lastSkipped: { from: string; to: string; count: number } | null;
    }): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE recurring_schedules
              SET next_run_date = ?1,
                  status = CASE WHEN ?1 IS NULL THEN 'ended' ELSE status END,
                  last_run_date = ?2, last_invoice_id = ?3,
                  run_count = (SELECT COUNT(*) FROM recurring_runs r WHERE r.workspace_id = ?6 AND r.schedule_id = ?7 AND r.outcome = 'generated'),
                  skipped_count = skipped_count + ?4, last_skipped = COALESCE(?5, last_skipped),
                  last_error = NULL, failure_count = 0, retry_at = NULL, updated_at = ${DB_NOW}
            WHERE workspace_id = ?6 AND id = ?7 AND deleted_at IS NULL AND next_run_date = ?8`,
        )
        .bind(
          args.nextRunDate,
          args.period,
          args.invoiceId,
          args.skippedCount,
          args.lastSkipped ? JSON.stringify(args.lastSkipped) : null,
          args.workspaceId,
          args.scheduleId,
          args.expectedNextRunDate,
        );
    },

    /** Records a failed attempt (only while the schedule still waits for the same period). */
    failureStatement(args: { workspaceId: string; scheduleId: string; expectedNextRunDate: string | null; error: object; failureCount: number; retryAt: string | null }): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE recurring_schedules
              SET last_error = ?1, failure_count = ?2, retry_at = ?3, updated_at = ${DB_NOW}
            WHERE workspace_id = ?4 AND id = ?5 AND deleted_at IS NULL AND next_run_date IS ?6`,
        )
        .bind(JSON.stringify(args.error), args.failureCount, args.retryAt, args.workspaceId, args.scheduleId, args.expectedNextRunDate);
    },

    /**
     * Stores the outcome of a period's email (`error` null = sent). After the
     * generation (`generated`) only while the schedule still points at that
     * invoice; on a retry (`pending`) only while the pending record is still
     * about that invoice (a newer period's generation replaced it otherwise).
     */
    sendStateStatement(args: { workspaceId: string; scheduleId: string; invoiceId: string; error: object | null; guard: 'generated' | 'pending' }): D1PreparedStatement {
      const guard = args.guard === 'generated' ? 'last_invoice_id = ?4' : `json_extract(last_error, '$.invoiceId') = ?4`;
      return db
        .prepare(`UPDATE recurring_schedules SET last_error = ?1, updated_at = ${DB_NOW} WHERE workspace_id = ?2 AND id = ?3 AND deleted_at IS NULL AND ${guard}`)
        .bind(args.error ? JSON.stringify(args.error) : null, args.workspaceId, args.scheduleId, args.invoiceId);
    },

    /** Schedules whose generated invoice's email is due for another try (all workspaces, oldest first). */
    async pendingSends(nowIso: string, limit: number): Promise<DueRow[]> {
      const { results } = await db
        .prepare(
          `SELECT ${COLUMNS.split(', ').map((c) => `s.${c}`).join(', ')},
                  EXISTS (SELECT 1 FROM workspace_suspensions w WHERE w.workspace_id = s.workspace_id) AS suspended
             FROM recurring_schedules s
            WHERE s.deleted_at IS NULL AND s.last_error IS NOT NULL
              AND json_extract(s.last_error, '$.sendPending') = 1 AND json_extract(s.last_error, '$.nextAttemptAt') <= ?1
            ORDER BY json_extract(s.last_error, '$.nextAttemptAt'), s.workspace_id, s.id
            LIMIT ?2`,
        )
        .bind(nowIso, limit)
        .all<DueRow>();
      return results;
    },

    /** Ends an active schedule (its end date passed or its occurrences are used up). */
    endStatement(args: { workspaceId: string; scheduleId: string; expectedNextRunDate: string | null }): D1PreparedStatement {
      return db
        .prepare(
          `UPDATE recurring_schedules SET status = 'ended', next_run_date = NULL, retry_at = NULL, updated_at = ${DB_NOW}
            WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL AND status = 'active' AND next_run_date IS ?`,
        )
        .bind(args.workspaceId, args.scheduleId, args.expectedNextRunDate);
    },

    async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      return db.batch(statements);
    },
  };
}

export type RecurringRepository = ReturnType<typeof createRecurringRepository>;
