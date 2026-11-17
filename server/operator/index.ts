/**
 * Operator console wiring. `installOperator` is called once from createApp
 * (server/app.ts): it adds the request hook in front of every /api route and
 * mounts the private console API at /api/operator.
 */
import type { Hono } from 'hono';
import type { Repository } from '../db/repository';
import type { AppDeps } from '../deps';
import { createOperatorDb } from './db';
import { createOperatorHook } from './hooks';
import { createOperatorRoutes } from './routes';
import { createTelemetryCollector, type TelemetryCollector } from './telemetry';

const collectors = new WeakMap<object, TelemetryCollector>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts the app regardless of its Env type
export function installOperator(app: Hono<any>, deps: AppDeps, repo: Repository): void {
  const odb = createOperatorDb(deps.db);
  const telemetry = createTelemetryCollector(odb, { flushDelayMs: deps.operator.telemetryFlushDelayMs, logError: deps.logError });
  collectors.set(app, telemetry);
  app.use('/api/*', createOperatorHook(deps, telemetry));
  app.route('/api/operator', createOperatorRoutes(deps, repo, odb));
}

/** Test/maintenance access to an app's telemetry collector (e.g. to flush synchronously). */
export function telemetryOf(app: object): TelemetryCollector | undefined {
  return collectors.get(app);
}
