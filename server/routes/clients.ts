/**
 * /api/v1/clients routes (registered by createApp). Mirrors the invoice
 * routes: ETag on every single-client response, If-Match on writes,
 * If-None-Match: * for create-only PUTs.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { CLIENT_BODY_BYTES, listClientsQuerySchema } from '../clientSchemas';
import { errors } from '../errors';
import { readJsonRequired } from '../http';
import { zodDetails } from '../schemas';
import * as clients from '../services/clients';
import type { ServiceContext } from '../services/invoices';

export function registerClientRoutes(v1: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, svc: (c: Context<AppEnv>) => ServiceContext) {
  const withEtag = (c: Context<AppEnv>, client: { revision: number }) => c.header('etag', `"${client.revision}"`);

  v1.get('/clients', auth, async (c) => {
    const parsed = listClientsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    const q = parsed.data;
    return c.json(
      await clients.listClients(svc(c), {
        q: q.q,
        updatedSince: q.updated_since,
        afterId: q.after_id,
        includeDeleted: q.include_deleted === 'true',
        limit: q.limit,
      }),
    );
  });
  v1.post('/clients', auth, async (c) => {
    const client = await clients.createClient(svc(c), await readJsonRequired(c, CLIENT_BODY_BYTES));
    withEtag(c, client);
    c.header('location', `/api/v1/clients/${client.id}`);
    return c.json({ client }, 201);
  });
  v1.get('/clients/:id', auth, async (c) => {
    const client = await clients.getClient(svc(c), c.req.param('id'));
    withEtag(c, client);
    return c.json({ client });
  });
  v1.put('/clients/:id', auth, async (c) => {
    const body = await readJsonRequired(c, CLIENT_BODY_BYTES);
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch !== undefined && ifNoneMatch.trim() !== '*') throw errors.badRequest('Only If-None-Match: * is supported');
    const { client, created } = await clients.putClient(svc(c), c.req.param('id'), body, {
      ifMatch: clients.parseIfMatch(c.req.header('if-match')),
      ifNoneMatchAny: ifNoneMatch !== undefined,
    });
    withEtag(c, client);
    return c.json({ client }, created ? 201 : 200);
  });
  v1.patch('/clients/:id', auth, async (c) => {
    const body = await readJsonRequired(c, CLIENT_BODY_BYTES);
    const client = await clients.patchClient(svc(c), c.req.param('id'), body, { ifMatch: clients.parseIfMatch(c.req.header('if-match')) });
    withEtag(c, client);
    return c.json({ client });
  });
  v1.delete('/clients/:id', auth, async (c) => {
    await clients.deleteClient(svc(c), c.req.param('id'), { ifMatch: clients.parseIfMatch(c.req.header('if-match')) });
    return c.body(null, 204);
  });
}
