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

const reviewField = { type: 'string', enum: ['fromName', 'fromEmail', 'paymentDetails', 'toEmail'] };
const userOnly = { security: bearer, 'x-required-credential': 'workspace token (agents get 403)' };
const ifMatchRequired = {
  name: 'If-Match',
  in: 'header',
  required: true,
  description: 'The revision the user reviewed (ETag, e.g. "3"). A newer revision → 412: review it again.',
  schema: str(),
};

const reviewPaths: Record<string, Json> = {
  '/reviews': {
    get: {
      summary: 'Agent-written data the user has not confirmed ("Needs your review")',
      description:
        'Invoices whose sender details (fromName, fromEmail, paymentDetails) are neither the settings nor values the user entered or approved, or whose toEmail the user never entered; and clients whose email the user never entered. Agents and automatic (recurring) emails cannot use these until the user approves them. A user save that does not change such a field approves nothing.',
      ...userOnly,
      responses: {
        200: {
          description: 'Pending reviews (newest first, at most 200 each)',
          content: jsonContent({
            type: 'object',
            required: ['invoices', 'clients'],
            properties: {
              invoices: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'invoiceNumber', 'revision', 'agentName', 'fields'],
                  properties: {
                    id: str({ format: 'uuid' }),
                    invoiceNumber: str(),
                    revision: { type: 'integer' },
                    agentName: { type: ['string', 'null'] },
                    fields: {
                      type: 'array',
                      items: { type: 'object', required: ['field', 'value', 'previous'], properties: { field: reviewField, value: str(), previous: { type: ['string', 'null'] } } },
                    },
                  },
                },
              },
              clients: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'name', 'email', 'revision', 'agentName'],
                  properties: { id: str({ format: 'uuid' }), name: str(), email: str(), revision: { type: 'integer' }, agentName: { type: ['string', 'null'] } },
                },
              },
            },
          }),
        },
        401: err('Missing or invalid bearer token'),
        403: err('forbidden: agents cannot read or approve reviews'),
      },
    },
  },
  '/invoices/{id}/review': {
    post: {
      summary: 'Approve the invoice’s sender details and recipient ("Looks right — approve")',
      description: 'Approves the current fromName/fromEmail/paymentDetails values and confirms the toEmail address of the reviewed revision. Workspace token only.',
      ...userOnly,
      parameters: [idParam, ifMatchRequired],
      responses: {
        200: {
          description: 'Approved',
          content: jsonContent({ type: 'object', required: ['invoice', 'approved'], properties: { invoice: ref('Invoice'), approved: { type: 'array', items: reviewField } } }),
        },
        400: err('Missing If-Match or invalid id'),
        401: err('Missing or invalid bearer token'),
        403: err('forbidden: agents cannot approve'),
        404: err('Invoice not found'),
        410: err('Invoice was deleted'),
        412: err('The invoice changed since the reviewed revision'),
      },
    },
  },
  '/clients/{id}/review': {
    post: {
      summary: 'Confirm the client’s email address',
      description: 'Confirms the email address of the reviewed client revision as one the user entered. Workspace token only.',
      ...userOnly,
      parameters: [idParam, ifMatchRequired],
      responses: {
        200: {
          description: 'Confirmed (confirmed=false: it already was)',
          content: jsonContent({ type: 'object', required: ['client', 'confirmed'], properties: { client: ref('Client'), confirmed: { type: 'boolean' } } }),
        },
        400: err('Missing If-Match, invalid id or the client has no email'),
        401: err('Missing or invalid bearer token'),
        403: err('forbidden: agents cannot confirm addresses'),
        404: err('Client not found'),
        410: err('Client was deleted'),
        412: err('The client changed since the reviewed revision'),
      },
    },
  },
};

export const emailOpenApiPaths: Record<string, Json> = {
  ...reviewPaths,
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
          description: 'Up to 255 printable ASCII characters, not starting with "internal:" (reserved for the server’s own sends → 400). A repeat with the same key and body replays the first result (Idempotent-Replayed: true); a different body → 409 idempotency_conflict.',
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
