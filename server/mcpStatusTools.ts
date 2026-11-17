/**
 * MCP tools and list filters for invoice status (registered by server/mcp.ts):
 * - `set_invoice_status` (invoices:write): one tool with the target status,
 *   which is what an LLM naturally has in mind ("mark INV-0007 paid");
 * - `get_invoice_summary` (invoices:read): what is unpaid, per currency.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Scope } from '../shared/api';
import { INVOICE_STATUSES } from '../shared/invoice-status';
import { isoDate } from './schemas';
import { changeInvoiceStatus, getInvoiceSummary } from './services/invoiceStatus';
import type { ServiceContext } from './services/invoices';

/** Extra `list_invoices` arguments (same meaning as the REST query parameters). */
export const statusListFilters = {
  status: z
    .array(z.enum([...INVOICE_STATUSES, 'overdue']))
    .min(1)
    .optional()
    .describe(
      'Only invoices with one of these statuses. "overdue" (virtual) = sent and past its due date (UTC); "sent" includes overdue ones. Unpaid = ["sent"].',
    ),
  due_before: isoDate.optional().describe('Only invoices due strictly before this date (YYYY-MM-DD). Invoices without a due date never match.'),
  due_after: isoDate.optional().describe('Only invoices due strictly after this date (YYYY-MM-DD). Invoices without a due date never match.'),
  client: z.string().trim().min(1).max(200).optional().describe('Case-insensitive substring of the client name (toName).'),
};

type ToolRegistrar = <S extends z.ZodObject>(
  name: string,
  scope: Scope,
  config: { title: string; description: string; inputSchema: S; annotations: Record<string, boolean> },
  run: (args: z.infer<S>) => Promise<CallToolResult>,
) => void;

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function registerStatusTools(tool: ToolRegistrar, ctx: ServiceContext) {
  tool(
    'set_invoice_status',
    'invoices:write',
    {
      title: 'Set invoice status',
      description:
        'Change the status of an invoice: "sent" (mark as sent to the client), "paid" (record payment), "void" (cancel), "draft" (undo mark-sent). ' +
        'Allowed: draft→sent|void, sent→paid|void|draft, paid→sent (undo payment)|void, void→draft|sent (reopen). Setting the current status again changes nothing. ' +
        'Overdue is not a status: it is derived from status sent and the due date. Returns the updated invoice.',
      inputSchema: z.object({
        id: z.string().describe('Invoice id (UUID).'),
        status: z.enum(INVOICE_STATUSES).describe('The new status.'),
        paid_at: isoDate.optional().describe('Payment date (YYYY-MM-DD) when status is paid. Defaults to today (UTC).'),
        sent_at: isoDate.optional().describe('Date sent (YYYY-MM-DD) when status is sent. Defaults to today (UTC).'),
        expected_revision: z
          .number()
          .int()
          .optional()
          .describe('Optional optimistic-concurrency check: fail if the invoice revision changed since you read it.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, status, paid_at, sent_at, expected_revision }) => {
      const { invoice, changed } = await changeInvoiceStatus(ctx, id, { status }, { paidAt: paid_at, sentAt: sent_at, ifMatch: expected_revision });
      return json({ invoice, changed });
    },
  );

  tool(
    'get_invoice_summary',
    'invoices:read',
    {
      title: 'Invoice summary',
      description:
        'What is unpaid: counts and totals per currency (never summed across currencies) of draft, outstanding (sent, not yet due), overdue (sent, past due), ' +
        'paid this month and paid this year (by paidAt), plus the oldest overdue invoices. "Today" is the UTC date (asOf). Void invoices are excluded.',
      inputSchema: z.object({
        oldest_overdue_limit: z.number().int().min(0).max(50).optional().describe('How many of the oldest overdue invoices to include (default 5).'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ oldest_overdue_limit }) => json(await getInvoiceSummary(ctx, { oldestOverdueLimit: oldest_overdue_limit })),
  );
}
