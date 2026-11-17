/**
 * Email routes, registered by createApp():
 * - POST /invoices/:id/send    (invoices:send; optional Idempotency-Key header)
 * - GET  /invoices/:id/emails  (invoices:read)
 * - GET  /reviews, POST /invoices/:id/review, POST /clients/:id/review (workspace token only)
 * Use-cases: server/services/invoiceEmail.ts.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { readJson } from '../http';
import { listInvoiceEmails, sendInvoiceEmail } from '../services/invoiceEmail';
import { etagOf, parseIfMatch, type ServiceContext } from '../services/invoices';
import { listReviews, reviewClient, reviewInvoice } from '../services/review';

/** Subject + message (2000 characters, up to 4 bytes each in UTF-8) + recipients. */
const SEND_BODY_BYTES = 16 * 1024;

export function registerInvoiceEmailRoutes(
  v1: Hono<AppEnv>,
  auth: MiddlewareHandler<AppEnv>,
  svc: (c: Context<AppEnv>) => ServiceContext,
) {
  v1.post('/invoices/:id/send', auth, async (c) => {
    const body = await readJson(c, SEND_BODY_BYTES);
    const result = await sendInvoiceEmail(svc(c), c.req.param('id'), body, { idempotencyKey: c.req.header('idempotency-key') });
    c.header('etag', etagOf(result.invoice));
    if (result.replayed) c.header('idempotent-replayed', 'true');
    return c.json(result);
  });

  v1.get('/invoices/:id/emails', auth, async (c) => c.json(await listInvoiceEmails(svc(c), c.req.param('id'))));

  // "Needs your review" (workspace / device token only; server/services/review.ts).
  v1.get('/reviews', auth, async (c) => c.json(await listReviews(svc(c))));
  v1.post('/invoices/:id/review', auth, async (c) => {
    const result = await reviewInvoice(svc(c), c.req.param('id'), { ifMatch: parseIfMatch(c.req.header('if-match')) });
    c.header('etag', etagOf(result.invoice));
    return c.json(result);
  });
  v1.post('/clients/:id/review', auth, async (c) => {
    const result = await reviewClient(svc(c), c.req.param('id'), { ifMatch: parseIfMatch(c.req.header('if-match')) });
    c.header('etag', `"${result.client.revision}"`);
    return c.json(result);
  });
}
