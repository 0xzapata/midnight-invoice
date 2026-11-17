/**
 * The `recurring.generate` job (hourly, registered in server/scheduled.ts):
 * finds active schedules whose next run date has begun in their own time
 * zone and generates each one's invoice (generate.ts: exactly once per
 * period).
 *
 * - Bounded: at most `recurring.maxGeneratedPerRun` due schedules per run,
 *   oldest next run date first, read in pages; the rest continue in the next
 *   run (an hour later).
 * - Catch-up policy (after downtime, a pause, a suspension or a failure
 *   streak): only the most recent missed period is generated; older missed
 *   periods are skipped and recorded (recurring_runs + skippedCount /
 *   lastSkipped on the schedule). A burst of back-dated invoices is rarely
 *   what anyone wants, and every skip is visible.
 * - Failures never stop the batch: the reason is stored on the schedule
 *   (lastError) and retried with backoff (retry_at). A suspended workspace
 *   and maintenance mode are recorded the same way, without generating.
 * - `recurring.enabled` off: the job does nothing at all.
 */
import { addDays, catchUpPlan, isValidTimeZone, localDateIn } from '../../shared/recurring';
import type { AppDeps } from '../deps';
import type { ScheduledJob } from '../scheduled';
import { configOf, endSchedule, generatePeriod, generationErrorOf, recordFailure, recurringRepo, systemContext } from './generate';
import type { DueRow } from './repository';

export const RECURRING_CRON = '7 * * * *';
const PAGE = 50;
const HOUR = 3_600_000;

export interface RecurringRunStats {
  /** Due schedules looked at (counted against the per-run limit). */
  processed: number;
  generated: number;
  failed: number;
  ended: number;
  skippedPeriods: number;
  /** True when the per-run limit stopped the run with due schedules left. */
  more: boolean;
}

/** Runs one generation pass at `nowMs`. Never throws for a single schedule's problem. */
export async function runRecurringGeneration(deps: AppDeps, nowMs: number): Promise<RecurringRunStats> {
  await deps.settings.refresh(true);
  const stats: RecurringRunStats = { processed: 0, generated: 0, failed: 0, ended: 0, skippedPeriods: 0, more: false };
  if (!deps.settings.get('recurring.enabled')) return stats;
  const max = deps.settings.get('recurring.maxGeneratedPerRun');
  const repo = recurringRepo(deps);
  const now = new Date(nowMs);
  // The latest calendar date anywhere (UTC+14): nothing later can be due.
  const maxDate = addDays(now.toISOString().slice(0, 10), 1);
  let after: { date: string; workspaceId: string; id: string } | null = null;

  for (;;) {
    const rows: DueRow[] = await repo.dueCandidates({ maxDate, nowIso: now.toISOString(), after, limit: PAGE });
    for (const row of rows) {
      after = { date: row.next_run_date!, workspaceId: row.workspace_id, id: row.id };
      const today = localDateIn(now, isValidTimeZone(row.timezone) ? row.timezone : 'UTC');
      if (row.next_run_date! > today) continue; // not yet due in its own time zone
      if (stats.processed >= max) {
        stats.more = true;
        return stats;
      }
      stats.processed++;
      try {
        await processDue(deps, row, today, stats);
      } catch (error) {
        stats.failed++;
        deps.logError?.('Recurring schedule failed unexpectedly', error);
        await recordFailure(deps, row, { code: 'internal_error', message: 'The invoice could not be generated because of a server error. It will be retried.' }, row.next_run_date);
      }
    }
    if (rows.length < PAGE) return stats;
  }
}

async function processDue(deps: AppDeps, row: DueRow, today: string, stats: RecurringRunStats): Promise<void> {
  if (deps.settings.get('maintenance.enabled')) {
    stats.failed++;
    await recordFailure(deps, row, { code: 'maintenance', message: 'Paused while the site is in maintenance mode; it will be generated afterwards.' }, row.next_run_date, { delayMs: HOUR });
    return;
  }
  if (row.suspended) {
    stats.failed++;
    await recordFailure(deps, row, { code: 'workspace_suspended', message: 'This workspace is suspended, so no invoices are generated.' }, row.next_run_date, { delayMs: HOUR });
    return;
  }
  const cfg = configOf(row);
  if (cfg.maxOccurrences != null && row.run_count >= cfg.maxOccurrences) {
    stats.ended++;
    await endSchedule(deps, row);
    return;
  }
  const plan = catchUpPlan(cfg, row.next_run_date!, today);
  if (!plan) {
    // Due, but the end date leaves no run date from next_run_date on.
    stats.ended++;
    await endSchedule(deps, row);
    return;
  }
  try {
    const result = await generatePeriod({ ctx: systemContext(deps, row.workspace_id), row, period: plan.period, skipped: plan.skipped, skippedCount: plan.skippedCount, via: 'schedule' });
    if (result.generated) stats.generated++;
    if (result.ended) stats.ended++;
    stats.skippedPeriods += plan.skippedCount;
  } catch (error) {
    stats.failed++;
    const reason = generationErrorOf(error);
    if (reason.code === 'internal_error') deps.logError?.('Recurring generation failed', error);
    await recordFailure(deps, row, { code: reason.code, message: reason.message }, plan.period);
  }
}

export const recurringGenerateJob: ScheduledJob = {
  name: 'recurring.generate',
  cron: RECURRING_CRON,
  async run({ deps, scheduledTime }) {
    const stats = await runRecurringGeneration(deps, scheduledTime || deps.clock().getTime());
    if (stats.more) deps.logError?.(`recurring.generate stopped at its per-run limit (${stats.processed}); the rest continue in the next run`, null);
  },
};
