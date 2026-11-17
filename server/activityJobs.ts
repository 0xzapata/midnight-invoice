/**
 * Daily activity-log retention (registered in server/scheduled.ts): deletes
 * entries older than `activity.retentionDays` and all but the newest
 * `activity.maxRowsPerWorkspace` of each workspace (operator settings, see
 * server/operator/settings-registry.ts). Idempotent; handles at most
 * MAX_WORKSPACES_PER_RUN workspaces per run (the rest on the next run).
 */
import { createActivityRepository } from './db/activityRepository';
import type { ScheduledJob } from './scheduled';

export const MAX_WORKSPACES_PER_RUN = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export const activityRetentionJob: ScheduledJob = {
  name: 'activity.retention',
  cron: '43 3 * * *',
  async run({ deps, scheduledTime }) {
    await deps.settings.refresh(true);
    const days = deps.settings.get('activity.retentionDays');
    const maxRows = deps.settings.get('activity.maxRowsPerWorkspace');
    const now = scheduledTime || deps.clock().getTime();
    const cutoff = new Date(now - days * DAY_MS).toISOString();
    const repo = createActivityRepository(deps.db);
    for (const workspaceId of await repo.workspacesToPrune(cutoff, maxRows, MAX_WORKSPACES_PER_RUN)) {
      await repo.prune(workspaceId, cutoff, maxRows);
    }
  },
};
