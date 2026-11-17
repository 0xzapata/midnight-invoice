/**
 * OpenAPI 3.1 fragments for sending invoices by email, merged into the
 * document by server/openapi.ts (whose consistency test covers these routes).
 */
import { EMAIL_LIMITS } from '../shared/email-template';
import { INVOICE_THEMES } from '@/components/invoice/invoiceTheme';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: Json) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: jsonContent(ref('Error')) });
const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const bearer = [{ bearerAuth: [] }];
const scoped = (scope: string) => ({ security: bearer, 'x-required-scope': scope });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

const actor = {
  type: 'object',
  required: ['type'],
  properties: { type: { type: 'string', enum: ['user', 'agent'] }, agentId: str(), agentName: str() },
};

export const emailOpenApiSchemas: Record<string, Json> = {
  InvoiceEmail: {
    type: 'object',
    required: ['id', 'invoiceId', 'to', 'cc', 'subject', 'status', 'error', 'sentBy', 'statusChanged', 'createdAt', 'sentAt'],
    properties: {
      id: str({ format: 'uuid' }),
      invoiceId: str({ format: 'uuid' }),
      to: str({ format: 'email' }),
      cc: { type: 'array', items: str({ format: 'email' }) },
      subject: str(),
      status: { type: 'string', enum: ['queued', 'sent', 'failed'] },
      error: {
        type: ['object', 'null'],
        properties: {
          code: str({ description: 'provider_auth_failed, provider_rejected, provider_rate_limited, provider_unavailable, provider_unreachable, attachment_too_large, pdf_render_failed' }),
          message: str(),
        },
      },
      sentBy: actor,
      statusChanged: { type: 'boolean', description: 'This send moved the invoice from draft to sent' },
      createdAt: str({ format: 'date-time' }),
      sentAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  SendInvoiceEmailRequest: {
    type: 'object',
    additionalProperties: false,
    description: 'All fields optional. There is no from/replyTo/html field: the sending address is fixed by the server and the HTML part is generated from plain text.',
    properties: {
      to: str({ format: 'email', maxLength: EMAIL_LIMITS.address, description: 'Defaults to the invoice toEmail. Agents: must equal the invoice toEmail.' }),
      cc: {
        type: 'array',
        maxItems: EMAIL_LIMITS.cc,
        items: str({ format: 'email' }),
        description: 'Workspace token only (any address). Agents: only the workspace fromEmail from settings.',
      },
      ccMe: { type: 'boolean', description: 'Copy the workspace fromEmail (settings)' },
      subject: str({ maxLength: EMAIL_LIMITS.subject, description: 'One line of plain text (CR/LF and control characters are rejected)' }),
      message: str({ maxLength: EMAIL_LIMITS.message, description: 'Plain text, replaces the default greeting; escaped in the HTML part' }),
      theme: { type: 'string', enum: [...INVOICE_THEMES], description: 'Theme of the attached PDF (default: server setting, light)' },
    },
  },
  SendInvoiceEmailResponse: {
    type: 'object',
    required: ['email', 'invoice', 'statusChanged', 'replayed'],
    properties: {
      email: ref('InvoiceEmail'),
      invoice: ref('Invoice'),
      statusChanged: { type: 'boolean', description: 'The invoice was a draft and is now sent (sentAt = today, UTC)' },
      replayed: { type: 'boolean', description: 'Same Idempotency-Key as an earlier successful request: nothing was sent again' },
    },
  },
};

export const emailOpenApiPaths: Record<string, Json> = {
  '/invoices/{id}/send': {
    post: {
      summary: 'Email the invoice (PDF attached) to the client',
      description:
        'Sends the invoice to its toEmail with the PDF attached. From is the server’s sending address with the sender name as display name; Reply-To is the invoice fromEmail. ' +
        'A draft becomes sent; sent/paid invoices are resent unchanged; void invoices are refused (409). ' +
        'Agents may only email the invoice toEmail, and only an address the user entered themselves (403 recipient_not_allowed). ' +
        'Limits: per-invoice cooldown, per-workspace and per-agent hourly/daily caps and a site-wide daily cap (429 with details.reason and Retry-After). ' +
        'Send an Idempotency-Key to make retries safe.',
      ...scoped('invoices:send'),
      parameters: [
        idParam,
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Up to 255 printable ASCII characters. A repeat with the same key and body replays the first result (Idempotent-Replayed: true); a different body → 409 idempotency_conflict.',
          schema: str({ maxLength: EMAIL_LIMITS.idempotencyKey }),
        },
      ],
      requestBody: { required: false, content: jsonContent(ref('SendInvoiceEmailRequest')) },
      responses: {
        200: { description: 'Sent (or replayed)', headers: { ETag: { schema: str(), description: 'Quoted invoice revision' } }, content: jsonContent(ref('SendInvoiceEmailResponse')) },
        400: err('Invalid request or undeliverable address (validation_failed)'),
        401: err('Missing or invalid bearer token'),
        403: err('insufficient_scope, recipient_not_allowed (agent recipient rules) or invoice_needs_review (agent-changed sender details not reviewed by the user)'),
        404: err('Invoice not found'),
        409: err('Void invoice (invalid_status_transition) or idempotency_conflict'),
        410: err('Invoice was deleted'),
        413: err('Body too large'),
        415: err('Content-Type must be application/json'),
        429: err('rate_limited: cooldown or cap reached (details.reason, Retry-After)'),
        502: err('email_send_failed: the provider refused or failed; details.email is the recorded attempt'),
        503: err('email_not_configured: this server has no email provider set up'),
      },
    },
  },
  '/invoices/{id}/emails': {
    get: {
      summary: 'Email history of an invoice (newest first) and whether email is available',
      ...scoped('invoices:read'),
      parameters: [idParam],
      responses: {
        200: {
          description: 'History',
          content: jsonContent({
            type: 'object',
            required: ['emails', 'delivery'],
            properties: {
              emails: { type: 'array', items: ref('InvoiceEmail') },
              delivery: {
                type: 'object',
                properties: {
                  configured: { type: 'boolean' },
                  fromAddress: { type: ['string', 'null'], description: 'Sending address (fixed by the server)' },
                  fromName: { type: 'string', description: 'Recipients see "<invoice fromName> via <fromName>"' },
                  pdfTheme: { type: 'string', enum: [...INVOICE_THEMES] },
                  cooldownMinutes: { type: 'integer' },
                },
              },
            },
          }),
        },
        400: err('Invalid id'),
        401: err('Missing or invalid bearer token'),
        403: err('insufficient_scope'),
        404: err('Invoice not found'),
        410: err('Invoice was deleted'),
      },
    },
  },
};
