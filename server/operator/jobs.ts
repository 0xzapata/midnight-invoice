/**
 * Hourly operator housekeeping: telemetry retention (per the telemetry.*
 * settings) and expired operator sessions.
 */
import type { ScheduledJob } from '../scheduled';
import { createOperatorDb } from './db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const RECENT_ERRORS_KEPT = 500;

export const operatorMaintenanceJob: ScheduledJob = {
  name: 'operator.maintenance',
  cron: '17 * * * *',
  async run({ deps, scheduledTime }) {
    await deps.settings.refresh(true);
    const odb = createOperatorDb(deps.db);
    const now = scheduledTime || deps.clock().getTime();
    await odb.pruneTelemetry(
      now - deps.settings.get('telemetry.minuteRetentionHours') * HOUR,
      now - deps.settings.get('telemetry.hourRetentionDays') * DAY,
      now - 14 * DAY,
      RECENT_ERRORS_KEPT,
    );
    await odb.purgeSessions(now - DAY);
  },
};
