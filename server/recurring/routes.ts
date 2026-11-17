/**
 * /api/v1/recurring routes (registered by createApp). Like the template
 * routes: ETag on every single-schedule response, If-Match on writes.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { errors } from '../errors';
import { readJson, readJsonRequired } from '../http';
import { zodDetails } from '../schemas';
import { etagOf, parseIfMatch, type ServiceContext } from '../services/invoices';
import { listRecurringQuerySchema, previewQuerySchema } from './schemas';
import * as recurring from './service';

const BODY_BYTES = 64 * 1024;

export function registerRecurringRoutes(v1: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, svc: (c: Context<AppEnv>) => ServiceContext) {
  const withEtag = (c: Context<AppEnv>, schedule: { revision: number }) => c.header('etag', `"${schedule.revision}"`);
  const pre = (c: Context<AppEnv>) => ({ ifMatch: parseIfMatch(c.req.header('if-match')) });

  v1.get('/recurring', auth, async (c) => {
    const parsed = listRecurringQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    return c.json(await recurring.listRecurring(svc(c), { status: parsed.data.status, templateId: parsed.data.template_id }));
  });
  v1.post('/recurring', auth, async (c) => {
    const schedule = await recurring.createRecurring(svc(c), await readJsonRequired(c, BODY_BYTES));
    withEtag(c, schedule);
    c.header('location', `/api/v1/recurring/${schedule.id}`);
    return c.json({ recurring: schedule }, 201);
  });
  v1.get('/recurring/:id', auth, async (c) => {
    const schedule = await recurring.getRecurring(svc(c), c.req.param('id'));
    withEtag(c, schedule);
    return c.json({ recurring: schedule });
  });
  v1.put('/recurring/:id', auth, async (c) => {
    const schedule = await recurring.putRecurring(svc(c), c.req.param('id'), await readJsonRequired(c, BODY_BYTES), pre(c));
    withEtag(c, schedule);
    return c.json({ recurring: schedule });
  });
  v1.patch('/recurring/:id', auth, async (c) => {
    const schedule = await recurring.patchRecurring(svc(c), c.req.param('id'), await readJsonRequired(c, BODY_BYTES), pre(c));
    withEtag(c, schedule);
    return c.json({ recurring: schedule });
  });
  v1.delete('/recurring/:id', auth, async (c) => {
    await recurring.deleteRecurring(svc(c), c.req.param('id'), pre(c));
    return c.body(null, 204);
  });
  v1.post('/recurring/:id/pause', auth, async (c) => {
    const schedule = await recurring.pauseRecurring(svc(c), c.req.param('id'), pre(c));
    withEtag(c, schedule);
    return c.json({ recurring: schedule });
  });
  v1.post('/recurring/:id/resume', auth, async (c) => {
    const schedule = await recurring.resumeRecurring(svc(c), c.req.param('id'), pre(c));
    withEtag(c, schedule);
    return c.json({ recurring: schedule });
  });
  v1.post('/recurring/:id/run-now', auth, async (c) => {
    const result = await recurring.runRecurringNow(svc(c), c.req.param('id'), await readJson(c, BODY_BYTES));
    if (result.invoice) {
      c.header('etag', etagOf(result.invoice));
      c.header('location', `/api/v1/invoices/${result.invoice.id}`);
    }
    return c.json(result, result.generated ? 201 : 200);
  });
  v1.post('/recurring/:id/approve-email', auth, async (c) => {
    const result = await recurring.approveRecurringEmail(svc(c), c.req.param('id'));
    withEtag(c, result.recurring);
    return c.json(result);
  });
  v1.get('/recurring/:id/preview', auth, async (c) => {
    const parsed = previewQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    return c.json(await recurring.previewRecurring(svc(c), c.req.param('id'), parsed.data.count ?? 6));
  });
}
