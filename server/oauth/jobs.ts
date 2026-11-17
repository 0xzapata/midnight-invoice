/**
 * Hourly OAuth housekeeping (registered in server/scheduled.ts): deletes
 * expired authorization requests, codes and tokens, dynamically registered
 * clients that were never used, grants that can no longer issue tokens and
 * unused cached Client ID Metadata Documents. Requests to the endpoints also
 * purge opportunistically; this job keeps the tables small when they are idle.
 */
import type { ScheduledJob } from '../scheduled';
import { createOAuthRepository } from './repository';

const DAY = 24 * 60 * 60 * 1000;

export const oauthPruneJob: ScheduledJob = {
  name: 'oauth.prune',
  // Same trigger as the operator housekeeping (one cron in wrangler.jsonc).
  cron: '17 * * * *',
  async run({ deps, scheduledTime }) {
    const now = scheduledTime || deps.clock().getTime();
    await createOAuthRepository(deps.db).purgeExpired(now, DAY);
  },
};
