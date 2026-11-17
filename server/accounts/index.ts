/**
 * User accounts wiring. `installAccounts` is called once from createApp
 * (server/app.ts), right after installOperator and before the /api/v1 routes:
 * it enforces "require an account for new workspaces" on POST
 * /api/v1/workspaces and mounts the browser-only account API at /api/account.
 */
import type { Hono } from 'hono';
import type { Repository } from '../db/repository';
import type { AppDeps } from '../deps';
import { telemetryOf } from '../operator';
import { createAccountsDb } from './db';
import { accountsState, createAccountRoutes } from './routes';
import { accountError } from './session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts the app regardless of its Env type
export function installAccounts(app: Hono<any>, deps: AppDeps, repo: Repository): void {
  const adb = createAccountsDb(deps.db);
  app.use('/api/v1/workspaces', async (c, next) => {
    if (c.req.method === 'POST' && deps.settings.get('accounts.enabled') && deps.settings.get('accounts.requiredForNewWorkspaces')) {
      const state = await accountsState(deps);
      throw accountError(
        403,
        'account_required',
        state === 'ready'
          ? 'This site requires an account for new cloud-sync workspaces. Sign in to turn on cloud sync.'
          : 'This site requires an account for new cloud-sync workspaces, and sign-in is not available right now.',
      );
    }
    await next();
  });
  app.route('/api/account', createAccountRoutes({ deps, repo, adb, telemetry: telemetryOf(app) }));
}
