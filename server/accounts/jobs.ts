/**
 * Hourly account housekeeping (registered in server/scheduled.ts): deletes
 * expired AuthKit sign-in states, ended account sessions (expired, idle past
 * the timeout, or revoked more than KEEP_REVOKED_DAYS ago) and device tokens
 * revoked more than KEEP_REVOKED_DAYS ago (kept that long so a signed-out
 * browser can still be told why). Idempotent.
 */
import type { ScheduledJob } from '../scheduled';
import { createAccountsDb } from './db';

export const KEEP_REVOKED_DAYS = 30;
const DAY_MS = 86_400_000;

export const accountsCleanupJob: ScheduledJob = {
  name: 'accounts.cleanup',
  cron: '17 * * * *',
  async run({ deps, scheduledTime }) {
    await deps.settings.refresh(true);
    const now = scheduledTime || deps.clock().getTime();
    await createAccountsDb(deps.db).cleanup(now, {
      sessionIdleMs: deps.settings.get('accounts.sessionIdleDays') * DAY_MS,
      keepRevokedMs: KEEP_REVOKED_DAYS * DAY_MS,
    });
  },
};
