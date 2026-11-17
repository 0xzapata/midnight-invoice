/**
 * Invoice PDF download (REST GET /invoices/:id/pdf and MCP get_invoice_pdf).
 * A read, but one worth auditing: it records `invoice.pdf_downloaded` after
 * rendering, in the background (waitUntil), once per actor, invoice and
 * 10-minute window.
 */
import type { ApiInvoice } from '../../shared/api';
import type { InvoiceTheme } from '@/components/invoice/invoiceTheme';
import { renderInvoicePdf } from '../pdf/render';
import { recordActivity } from './activity';
import { getInvoice, type ServiceContext } from './invoices';

const WINDOW_MS = 10 * 60 * 1000;

export async function downloadInvoicePdf(ctx: ServiceContext, rawId: string, theme: InvoiceTheme): Promise<{ invoice: ApiInvoice; bytes: Uint8Array }> {
  const invoice = await getInvoice(ctx, rawId);
  const bytes = await renderInvoicePdf(invoice, ctx.deps.readAsset, theme);
  const who = ctx.principal.type === 'agent' ? `agent:${ctx.principal.agentId}` : 'user';
  const window = Math.floor(ctx.deps.clock().getTime() / WINDOW_MS);
  void recordActivity(ctx, {
    action: 'invoice.pdf_downloaded',
    entity: { type: 'invoice', id: invoice.id, label: invoice.invoiceNumber },
    changes: { theme },
    dedupe: { key: `pdf:${invoice.id}:${who}:${window}`, mode: 'ignore' },
  });
  return { invoice, bytes };
}
