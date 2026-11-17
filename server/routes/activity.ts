/**
 * Activity log routes (registered by createApp):
 * - GET /activity             workspace token: everything; agent key with activity:read: its own entries
 * - GET /agents/:id/activity  entries by or about one agent (same rules)
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { listActivity, listAgentActivity, parseActivityQuery } from '../services/activity';
import type { ServiceContext } from '../services/invoices';

export function registerActivityRoutes(v1: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, svc: (c: Context<AppEnv>) => ServiceContext) {
  v1.get('/activity', auth, async (c) => c.json(await listActivity(svc(c), parseActivityQuery(c.req.query()))));
  v1.get('/agents/:id/activity', auth, async (c) =>
    c.json(await listAgentActivity(svc(c), c.req.param('id'), parseActivityQuery(c.req.query()))),
  );
}
