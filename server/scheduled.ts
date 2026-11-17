/**
 * Scheduled work (Cron Triggers). worker/index.ts `scheduled()` calls
 * `runScheduledJobs`, which runs every registered job whose `cron` equals the
 * trigger that fired. Each cron used here must also be listed in
 * wrangler.jsonc "triggers.crons" (server/scheduled.test.ts checks this).
 *
 * To add a job: export a ScheduledJob from your feature's module and append
 * it to JOBS. Jobs must be idempotent (a trigger can fire twice) and finish
 * well within the Worker's scheduled-event limits.
 */
import type { AppDeps } from './deps';
import { operatorMaintenanceJob } from './operator/jobs';

export interface ScheduledJobContext {
  deps: AppDeps;
  cron: string;
  scheduledTime: number;
}

export interface ScheduledJob {
  name: string;
  /** Standard 5-field cron expression (UTC), exactly as in wrangler.jsonc. */
  cron: string;
  run(ctx: ScheduledJobContext): Promise<void>;
}

export const JOBS: ScheduledJob[] = [operatorMaintenanceJob];

export const CRON_SCHEDULES = [...new Set(JOBS.map((j) => j.cron))];

export interface JobResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** Runs the jobs for `cron` one after another; a failing job is logged and does not stop the others. */
export async function runScheduledJobs(
  deps: AppDeps,
  event: { cron: string; scheduledTime: number },
  jobs: ScheduledJob[] = JOBS,
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs.filter((j) => j.cron === event.cron)) {
    try {
      await job.run({ deps, ...event });
      results.push({ name: job.name, ok: true });
    } catch (error) {
      deps.logError?.(`Scheduled job ${job.name} failed`, error);
      results.push({ name: job.name, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
