/**
 * User accounts wiring. `installAccounts` is called once from createApp
 * (server/app.ts), right after installOperator and before the /api/v1 routes:
 * it enforces "require an account for new workspaces" on POST
 * /api/v1/workspaces and mounts the browser-only account API at /api/account.
 */
import type { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { TOKEN_PREFIX } from '../../shared/api';
import { bearerToken } from '../auth';
import { sha256Hex } from '../crypto';
import { runInBackground } from '../http';
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

  // Device "last used": after a successful bearer request with a workspace token, record it on the
  // device token (no-op for the original token), at most once per throttle window per token.
  const touched = new Map<string, number>();
  const touchDevice = createMiddleware(async (c, next) => {
    await next();
    if (c.res.status >= 400) return;
    const token = bearerToken(c.req.header('authorization'));
    if (!token?.startsWith(TOKEN_PREFIX.workspace)) return;
    const now = deps.clock().getTime();
    const throttleMs = deps.config.lastUsedThrottleSeconds * 1000;
    const hash = await sha256Hex(token);
    if (now - (touched.get(hash) ?? -Infinity) < throttleMs) return;
    if (touched.size > 10_000) touched.clear();
    touched.set(hash, now);
    runInBackground(
      c,
      adb
        .touchDeviceStatement(hash, now, throttleMs)
        .run()
        .catch((error) => deps.logError?.('Failed to update device lastUsedAt', error)),
    );
  });
  app.use('/api/v1/*', touchDevice);
  app.use('/api/mcp', touchDevice);

  app.route('/api/account', createAccountRoutes({ deps, repo, adb, telemetry: telemetryOf(app) }));
}
