import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRON_SCHEDULES, JOBS, runScheduledJobs, type ScheduledJob } from './scheduled';
import { defaultDeps } from './deps';

function wranglerCrons(): string[] {
  const raw = fs.readFileSync(path.resolve(import.meta.dirname, '../wrangler.jsonc'), 'utf8');
  // Strip // comments (none of the values contain "//" except URLs in comments).
  const json = raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  return (JSON.parse(json) as { triggers?: { crons?: string[] } }).triggers?.crons ?? [];
}

describe('scheduled job registry', () => {
  it('every job cron is configured as a Cron Trigger in wrangler.jsonc', () => {
    expect(JOBS.length).toBeGreaterThan(0);
    for (const cron of CRON_SCHEDULES) expect(wranglerCrons()).toContain(cron);
  });

  it('runs only the jobs for the fired cron, and isolates failures', async () => {
    const ran: string[] = [];
    const errors: string[] = [];
    const deps = defaultDeps({ db: {} as D1Database, readAsset: async () => new ArrayBuffer(0), logError: (m) => errors.push(m) });
    const jobs: ScheduledJob[] = [
      { name: 'a', cron: '0 * * * *', run: async () => void ran.push('a') },
      { name: 'boom', cron: '0 * * * *', run: async () => { throw new Error('nope'); } },
      { name: 'b', cron: '0 * * * *', run: async () => void ran.push('b') },
      { name: 'daily', cron: '0 3 * * *', run: async () => void ran.push('daily') },
    ];
    const results = await runScheduledJobs(deps, { cron: '0 * * * *', scheduledTime: 0 }, jobs);
    expect(ran).toEqual(['a', 'b']);
    expect(results).toEqual([
      { name: 'a', ok: true },
      { name: 'boom', ok: false, error: 'nope' },
      { name: 'b', ok: true },
    ]);
    expect(errors).toEqual(['Scheduled job boom failed']);
  });
});
