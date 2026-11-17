/**
 * Status routes, registered by createApp() before `/invoices/:id` so that
 * `/invoices/summary` is not taken for an invoice id:
 * - GET  /invoices/summary                              (invoices:read)
 * - POST /invoices/:id/mark-sent|mark-paid|void|reopen  (invoices:write, If-Match)
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { StatusAction } from '../../shared/invoice-status';
import type { AppEnv } from '../app';
import { errors } from '../errors';
import { readJson } from '../http';
import { LIMITS, markPaidSchema, markSentSchema, summaryQuerySchema, zodDetails } from '../schemas';
import { changeInvoiceStatus, getInvoiceSummary } from '../services/invoiceStatus';
import { etagOf, parseIfMatch, type ServiceContext } from '../services/invoices';

export const STATUS_ACTION_PATHS: Record<string, StatusAction> = {
  'mark-sent': 'mark_sent',
  'mark-paid': 'mark_paid',
  void: 'void',
  reopen: 'reopen',
};

export function registerInvoiceStatusRoutes(
  v1: Hono<AppEnv>,
  auth: MiddlewareHandler<AppEnv>,
  svc: (c: Context<AppEnv>) => ServiceContext,
) {
  v1.get('/invoices/summary', auth, async (c) => {
    const parsed = summaryQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    return c.json(await getInvoiceSummary(svc(c), { oldestOverdueLimit: parsed.data.oldest_overdue_limit }));
  });

  for (const [path, action] of Object.entries(STATUS_ACTION_PATHS)) {
    v1.post(`/invoices/:id/${path}`, auth, async (c) => {
      const ifMatch = parseIfMatch(c.req.header('if-match'));
      const body = (await readJson(c, LIMITS.smallBodyBytes)) ?? {};
      let dates: { paidAt?: string; sentAt?: string } = {};
      if (action === 'mark_paid' || action === 'mark_sent') {
        const parsed = (action === 'mark_paid' ? markPaidSchema : markSentSchema).safeParse(body);
        if (!parsed.success) throw errors.validation(zodDetails(parsed.error));
        dates = parsed.data;
      }
      const { invoice } = await changeInvoiceStatus(svc(c), c.req.param('id'), { action }, { ...dates, ifMatch });
      c.header('etag', etagOf(invoice));
      return c.json({ invoice });
    });
  }
}
