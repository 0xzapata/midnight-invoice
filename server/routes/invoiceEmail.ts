/**
 * Email routes, registered by createApp():
 * - POST /invoices/:id/send    (invoices:send; optional Idempotency-Key header)
 * - GET  /invoices/:id/emails  (invoices:read)
 * Use-cases: server/services/invoiceEmail.ts.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { readJson } from '../http';
import { listInvoiceEmails, sendInvoiceEmail } from '../services/invoiceEmail';
import { etagOf, type ServiceContext } from '../services/invoices';

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
}
