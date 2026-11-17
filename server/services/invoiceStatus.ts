/**
 * Invoice status use-cases shared by REST (`POST /invoices/:id/mark-sent`,
 * `/mark-paid`, `/void`, `/reopen`, `GET /invoices/summary`) and MCP
 * (`set_invoice_status`, `get_invoice_summary`). Rules: shared/invoice-status.ts.
 */
import type { ApiInvoice } from '../../shared/api';
import {
  actionTarget,
  statusOf,
  summarizeInvoices,
  transitionStatus,
  STATUS_TRANSITIONS,
  type InvoiceStatus,
  type InvoiceSummary,
  type StatusAction,
} from '../../shared/invoice-status';
import { invoiceNumberValue } from '../../shared/invoice-totals';
import { actorOf, requireScope } from '../auth';
import type { StoredInvoiceData } from '../db/repository';
import { ApiError, errors } from '../errors';
import { parseInvoiceId, raceOutcome, toApiInvoice, today, type RevisionPrecondition, type ServiceContext } from './invoices';
import { invalidTransition } from './statusFields';
import { activityWriteIf, invoiceChangedInput } from './activity';

export type StatusChange = { action: StatusAction } | { status: InvoiceStatus };

/**
 * Changes the status of a live invoice. Setting the status it already has is
 * a no-op (no write, same revision) unless a different date is given.
 * `If-Match` is honoured (412 on mismatch); without it the read-modify-write
 * is compare-and-retried like PATCH.
 */
export async function changeInvoiceStatus(
  ctx: ServiceContext,
  rawId: string,
  change: StatusChange,
  opts: { paidAt?: string; sentAt?: string; ifMatch?: RevisionPrecondition },
): Promise<{ invoice: ApiInvoice; changed: boolean }> {
  requireScope(ctx.principal, 'invoices:write');
  const id = parseInvoiceId(rawId);
  const todayDate = today(ctx.deps);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
    if (!existing) throw errors.notFound('Invoice not found');
    if (existing.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: existing.deleted_at });
    if (typeof opts.ifMatch === 'number' && opts.ifMatch !== existing.revision) {
      throw errors.preconditionFailed('Revision mismatch', { id, currentRevision: existing.revision });
    }
    const current = JSON.parse(existing.data) as StoredInvoiceData;
    let target: InvoiceStatus;
    if ('action' in change) {
      const to = actionTarget(change.action, current);
      if (to === null) {
        const from = statusOf(current);
        // Repeating mark_sent / mark_paid / void on an invoice already in that state is a no-op.
        const same = { mark_sent: 'sent', mark_paid: 'paid', void: 'void', reopen: null }[change.action];
        if (same !== from) {
          throw new ApiError(409, 'invalid_status_transition', `Cannot ${change.action.replace('_', ' ')} an invoice that is ${from}`, {
            from,
            action: change.action,
            allowed: [...STATUS_TRANSITIONS[from]],
          });
        }
        target = from;
      } else {
        target = to;
      }
    } else {
      target = change.status;
    }
    const result = transitionStatus(current, target, { today: todayDate, paidAt: opts.paidAt, sentAt: opts.sentAt });
    if (!result.ok) throw invalidTransition(result);
    if (!result.changed) return { invoice: toApiInvoice(existing, todayDate), changed: false };
    const data: StoredInvoiceData = { ...current, ...result.fields };
    const label = { invoiceNumber: existing.invoice_number };
    const row = await ctx.repo.updateInvoice({
      workspaceId: ctx.principal.workspaceId,
      id,
      data,
      numberValue: invoiceNumberValue(existing.invoice_number),
      actor: actorOf(ctx.principal),
      expectedRevision: existing.revision,
    }, activityWriteIf(ctx, invoiceChangedInput(id, { ...current, ...label }, { ...data, ...label })));
    if (row) return { invoice: toApiInvoice(row, todayDate), changed: true };
    if (typeof opts.ifMatch === 'number') return raceOutcome(ctx, id);
  }
  throw errors.conflict('Invoice is being modified concurrently, retry');
}

/** GET /invoices/summary: counts and totals per currency (UTC "today"). */
export async function getInvoiceSummary(ctx: ServiceContext, opts: { oldestOverdueLimit?: number } = {}): Promise<InvoiceSummary> {
  requireScope(ctx.principal, 'invoices:read');
  const rows = await ctx.repo.listLiveInvoiceBodies(ctx.principal.workspaceId);
  const invoices = rows.map((row) => ({ ...(JSON.parse(row.data) as StoredInvoiceData), id: row.id, invoiceNumber: row.invoice_number }));
  return summarizeInvoices(invoices, today(ctx.deps), { oldestOverdueLimit: opts.oldestOverdueLimit ?? 5 });
}
