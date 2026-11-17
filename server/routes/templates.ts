/**
 * /api/v1/templates routes (registered by createApp). Mirrors the client
 * routes: ETag on every single-template response, If-Match on writes,
 * If-None-Match: * for create-only PUTs. POST /templates/:id/instantiate
 * creates a draft invoice from a template.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { errors } from '../errors';
import { readJson, readJsonRequired } from '../http';
import { LIMITS, zodDetails } from '../schemas';
import { listTemplatesQuerySchema, TEMPLATE_BODY_BYTES } from '../templateSchemas';
import * as templates from '../services/templates';
import { etagOf, type ServiceContext } from '../services/invoices';

export function registerTemplateRoutes(v1: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, svc: (c: Context<AppEnv>) => ServiceContext) {
  const withEtag = (c: Context<AppEnv>, template: { revision: number }) => c.header('etag', `"${template.revision}"`);

  v1.get('/templates', auth, async (c) => {
    const parsed = listTemplatesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    const q = parsed.data;
    return c.json(
      await templates.listTemplates(svc(c), {
        q: q.q,
        updatedSince: q.updated_since,
        afterId: q.after_id,
        includeDeleted: q.include_deleted === 'true',
        limit: q.limit,
      }),
    );
  });
  v1.post('/templates', auth, async (c) => {
    const template = await templates.createTemplate(svc(c), await readJsonRequired(c, TEMPLATE_BODY_BYTES));
    withEtag(c, template);
    c.header('location', `/api/v1/templates/${template.id}`);
    return c.json({ template }, 201);
  });
  v1.get('/templates/:id', auth, async (c) => {
    const template = await templates.getTemplate(svc(c), c.req.param('id'));
    withEtag(c, template);
    return c.json({ template });
  });
  v1.put('/templates/:id', auth, async (c) => {
    const body = await readJsonRequired(c, TEMPLATE_BODY_BYTES);
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch !== undefined && ifNoneMatch.trim() !== '*') throw errors.badRequest('Only If-None-Match: * is supported');
    const { template, created } = await templates.putTemplate(svc(c), c.req.param('id'), body, {
      ifMatch: templates.parseIfMatch(c.req.header('if-match')),
      ifNoneMatchAny: ifNoneMatch !== undefined,
    });
    withEtag(c, template);
    return c.json({ template }, created ? 201 : 200);
  });
  v1.patch('/templates/:id', auth, async (c) => {
    const body = await readJsonRequired(c, TEMPLATE_BODY_BYTES);
    const template = await templates.patchTemplate(svc(c), c.req.param('id'), body, { ifMatch: templates.parseIfMatch(c.req.header('if-match')) });
    withEtag(c, template);
    return c.json({ template });
  });
  v1.delete('/templates/:id', auth, async (c) => {
    await templates.deleteTemplate(svc(c), c.req.param('id'), { ifMatch: templates.parseIfMatch(c.req.header('if-match')) });
    return c.body(null, 204);
  });
  v1.post('/templates/:id/instantiate', auth, async (c) => {
    const result = await templates.instantiateTemplate(svc(c), c.req.param('id'), await readJson(c, LIMITS.invoiceBodyBytes));
    c.header('etag', etagOf(result.invoice));
    c.header('location', `/api/v1/invoices/${result.invoice.id}`);
    return c.json(result, 201);
  });
}
