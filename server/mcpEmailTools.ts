/**
 * MCP tool for sending an invoice by email (registered by server/mcp.ts):
 * `send_invoice_email` (invoices:send). Same rules as POST /invoices/:id/send:
 * agents can only email the client email on the invoice, cc only the
 * workspace's own email, within per-agent limits.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Scope } from '../shared/api';
import { EMAIL_LIMITS } from '../shared/email-template';
import { INVOICE_THEMES } from '@/components/invoice/invoiceTheme';
import { sendInvoiceEmail } from './services/invoiceEmail';
import type { ServiceContext } from './services/invoices';

type ToolRegistrar = <S extends z.ZodObject>(
  name: string,
  scope: Scope,
  config: { title: string; description: string; inputSchema: S; annotations: Record<string, boolean> },
  run: (args: z.infer<S>) => Promise<CallToolResult>,
) => void;

const input = z.object({
  id: z.string().describe('Invoice id (UUID).'),
  cc_me: z.boolean().optional().describe('Also send a copy to the workspace owner’s own email (from the default settings).'),
  subject: z
    .string()
    .max(EMAIL_LIMITS.subject)
    .optional()
    .describe(`Optional one-line plain-text subject (max ${EMAIL_LIMITS.subject} characters). Default: "Invoice <number> from <sender>".`),
  message: z
    .string()
    .max(EMAIL_LIMITS.message)
    .optional()
    .describe(
      `Optional plain-text message (max ${EMAIL_LIMITS.message} characters, no HTML) replacing the default greeting. The invoice number, amount due and due date are always included.`,
    ),
  theme: z.enum(INVOICE_THEMES).optional().describe('Colour theme of the attached PDF. Default: the server setting (light).'),
  idempotency_key: z
    .string()
    .min(1)
    .max(EMAIL_LIMITS.idempotencyKey)
    .optional()
    .describe('Optional key that makes retries safe: repeating the call with the same key never sends a second email.'),
});

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function registerEmailTools(tool: ToolRegistrar, ctx: ServiceContext) {
  tool(
    'send_invoice_email',
    'invoices:send',
    {
      title: 'Email invoice to client',
      description:
        'Email an invoice, with its PDF attached, to the client email on file (the invoice’s toEmail) — a real email to a real person, sent on the user’s behalf. ' +
        'Before calling, confirm with the user: show the invoice number, the recipient address and the total, and wait for an explicit yes. Never send unprompted or in bulk. ' +
        'You cannot choose another recipient; the address must be one the user entered in the app. A draft is marked as sent; sending a sent or paid invoice again is a resend (status unchanged). ' +
        'Void invoices cannot be sent. Limits: a cooldown per invoice and hourly/daily caps (429 with retryAfterSeconds).',
      inputSchema: input,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, cc_me, subject, message, theme, idempotency_key }) =>
      json(
        await sendInvoiceEmail(
          ctx,
          id,
          {
            ...(cc_me ? { ccMe: true } : {}),
            ...(subject !== undefined ? { subject } : {}),
            ...(message !== undefined ? { message } : {}),
            ...(theme ? { theme } : {}),
          },
          { idempotencyKey: idempotency_key },
        ),
      ),
  );
}
