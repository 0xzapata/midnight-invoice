/**
 * OpenAPI 3.1 description of /api/v1 (served at GET /api/v1/openapi.json).
 * server/openapi.test.ts asserts every documented operation is routed and
 * every route is documented.
 */
import { SCOPES, SCOPE_DESCRIPTIONS } from '../shared/api';
import { INVOICE_STATUSES, STATUS_TRANSITIONS } from '../shared/invoice-status';
import { LIMITS } from './schemas';
import { clientOpenApiPaths, clientOpenApiSchemas } from './openapiClients';
import { templateOpenApiPaths, templateOpenApiSchemas } from './openapiTemplates';
import { oauthOpenApiPaths, oauthOpenApiSchemas } from './openapiOAuth';
import { emailOpenApiPaths, emailOpenApiSchemas } from './openapiEmail';
import { activityOpenApiPaths, activityOpenApiSchemas } from './openapiActivity';
import { recurringOpenApiPaths, recurringOpenApiSchemas } from './recurring/openapi';
import { DEFAULT_INVOICE_THEME, INVOICE_THEMES } from '@/components/invoice/invoiceTheme';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: Json) => ({ 'application/json': { schema } });
const ok = (description: string, schema: Json) => ({ description, content: jsonContent(schema) });
const err = (description: string) => ({ description, content: jsonContent(ref('Error')) });

const E = {
  400: err('Invalid request (validation_failed, invalid_json, bad_request)'),
  401: err('Missing or invalid bearer token (WWW-Authenticate: Bearer)'),
  403: err('Authenticated but not allowed (insufficient_scope or forbidden)'),
  404: err('Not found'),
  409: err('Conflict'),
  410: err('Gone (deleted invoice or expired registration)'),
  412: err('If-Match / If-None-Match precondition failed'),
  413: err('Body too large'),
  415: err('Content-Type must be application/json'),
  429: err('Rate limited (Retry-After header)'),
};

const bearer = [{ bearerAuth: [] }];
const scoped = (scope: string) => ({ security: bearer, 'x-required-scope': scope });
const userOnly = { security: bearer, 'x-required-credential': 'workspace token' };
const agentOnly = { security: bearer, 'x-required-credential': 'agent key' };

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const userCodeParam = {
  name: 'user_code',
  in: 'path',
  required: true,
  description: 'Code shown to the user, e.g. WXYZ-BCDF (case-insensitive, dash optional)',
  schema: { type: 'string' },
};
const ifMatch = {
  name: 'If-Match',
  in: 'header',
  required: false,
  description: 'ETag (revision) from a previous response, e.g. "3". Mismatch → 412.',
  schema: { type: 'string' },
};
const invoiceBody = (schema: string) => ({ required: true, content: jsonContent(ref(schema)) });
const invoiceResult = (d: string) => ({
  description: d,
  headers: { ETag: { schema: { type: 'string' }, description: 'Quoted revision' } },
  content: jsonContent({ type: 'object', required: ['invoice'], properties: { invoice: ref('Invoice') } }),
});

const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const scopeSchema = { type: 'string', enum: [...SCOPES] };
const scopes = { type: 'array', items: scopeSchema, minItems: 1, uniqueItems: true };

const invoiceFields: Json = {
  invoiceNumber: str({ maxLength: LIMITS.invoiceNumber, description: 'Omit to allocate the next INV-NNNN atomically' }),
  invoiceName: str({ maxLength: LIMITS.shortText }),
  issueDate: str({ format: 'date', description: 'YYYY-MM-DD, defaults to today (UTC)' }),
  dueDate: str({ description: 'YYYY-MM-DD or empty string' }),
  fromName: str({ maxLength: LIMITS.shortText, description: 'Defaults to settings.fromName' }),
  fromAddress: str({ maxLength: LIMITS.address, description: 'Defaults to settings.fromAddress' }),
  fromEmail: str({ maxLength: LIMITS.email, description: 'Defaults to settings.fromEmail' }),
  toName: str({ maxLength: LIMITS.shortText }),
  toAddress: str({ maxLength: LIMITS.address }),
  toEmail: str({ maxLength: LIMITS.email }),
  lineItems: { type: 'array', minItems: 1, maxItems: LIMITS.maxLineItems, items: ref('LineItemInput') },
  taxRate: { type: 'number', minimum: 0, maximum: 100, description: 'Percent; defaults to settings.taxRate' },
  notes: str({ maxLength: LIMITS.longText }),
  paymentDetails: str({ maxLength: LIMITS.longText, description: 'Defaults to settings.paymentDetails' }),
  currency: str({ description: 'ISO 4217 code; defaults to settings.currency' }),
  clientId: {
    type: ['string', 'null'],
    format: 'uuid',
    description:
      'Saved client to bill (requires clients:read when set or changed; must be a live client of this workspace). Omitted to* fields are filled from the client; ' +
      'omitted currency/taxRate/dueDate from its defaults, then from settings. null = no client.',
  },
  recurringId: {
    type: ['string', 'null'],
    format: 'uuid',
    description: 'Recurring schedule that generated the invoice: a reference only (set by the generator, kept by sync). null = none.',
  },
  templateId: {
    type: ['string', 'null'],
    format: 'uuid',
    description:
      'Template the invoice was created from: a reference only (set by POST /templates/{id}/instantiate, kept by sync; never applies a template or checks that it exists). null = none.',
  },
  status: {
    type: 'string',
    enum: [...INVOICE_STATUSES],
    description:
      'Default draft on create; omitted on PUT/PATCH = unchanged. PATCH enforces transitions (' +
      Object.entries(STATUS_TRANSITIONS).map(([from, to]) => `${from}→${to.join('|')}`).join(', ') +
      '); PUT (full replace, sync) accepts any status. Invoices saved before statuses existed read as draft.',
  },
  sentAt: { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD; defaults to today when status is sent' },
  paidAt: { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD; set iff status is paid (defaults to today)' },
};

const statusFilterParams = [
  {
    name: 'status',
    in: 'query',
    description: 'Comma list of statuses (OR): draft, sent, paid, void, plus the virtual overdue (sent and dueDate before today, UTC)',
    schema: str({ example: 'sent,overdue' }),
  },
  { name: 'due_before', in: 'query', description: 'dueDate < this date (no due date never matches)', schema: str({ format: 'date' }) },
  { name: 'due_after', in: 'query', description: 'dueDate > this date (no due date never matches)', schema: str({ format: 'date' }) },
  { name: 'client', in: 'query', description: 'Case-insensitive substring of toName', schema: str({ maxLength: LIMITS.shortText }) },
  { name: 'client_id', in: 'query', description: 'Only invoices billed to this saved client (exact clientId)', schema: str({ format: 'uuid' }) },
  { name: 'recurring_id', in: 'query', description: 'Only invoices generated by this recurring schedule (history)', schema: str({ format: 'uuid' }) },
];

const summaryBucket = { type: 'object', required: ['count', 'total'], properties: { count: { type: 'integer' }, total: { type: 'number' } } };

const actor = {
  type: 'object',
  required: ['type'],
  description: 'user = the workspace owner, agent = an approved agent, system = generated by a recurring schedule (recurringId/recurringName)',
  properties: { type: { type: 'string', enum: ['user', 'agent', 'system'] }, agentId: str(), agentName: str(), recurringId: str(), recurringName: str() },
};

const statusActionPaths = () => {
  const actions: [string, string, Json | undefined][] = [
    ['mark-sent', 'Mark a draft as sent (sentAt defaults to today, UTC)', { type: 'object', properties: { sentAt: str({ format: 'date' }) } }],
    ['mark-paid', 'Mark a sent invoice as paid (paidAt defaults to today, UTC)', { type: 'object', properties: { paidAt: str({ format: 'date' }) } }],
    ['void', 'Void (cancel) the invoice (draft, sent or paid)', undefined],
    ['reopen', 'Reopen: paid → sent (undo payment), void → sent if it had been sent, else draft', undefined],
  ];
  return Object.fromEntries(
    actions.map(([path, summary, body]) => [
      `/invoices/{id}/${path}`,
      {
        post: {
          summary,
          description: 'Repeating the current state is a no-op (same revision). Disallowed transitions → 409 invalid_status_transition.',
          ...scoped('invoices:write'),
          parameters: [idParam, ifMatch],
          ...(body ? { requestBody: { required: false, content: jsonContent(body) } } : {}),
          responses: { 200: invoiceResult('Updated'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 412: E[412] },
        },
      },
    ]),
  );
};

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Midnight Invoice API',
      version: '1.0.0',
      description:
        'REST API for Midnight Invoice workspaces. Agents register with POST /agents/register, the user approves the shown code in the app, ' +
        'and the agent exchanges its device_code for an API key at POST /agents/token. A remote MCP endpoint is at POST /api/mcp. See /llms.txt.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Workspace token (mi_ws_…, all scopes) or agent API key (mi_agent_…, approved scopes).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: str(), message: str(), details: {} },
            },
          },
        },
        Scope: { ...scopeSchema, description: Object.entries(SCOPE_DESCRIPTIONS).map(([k, v]) => `${k}: ${v}`).join('; ') },
        Actor: actor,
        ...clientOpenApiSchemas,
        ...templateOpenApiSchemas,
        ...oauthOpenApiSchemas,
        ...emailOpenApiSchemas,
        ...activityOpenApiSchemas,
        ...recurringOpenApiSchemas,
        Workspace: { type: 'object', required: ['id', 'createdAt'], properties: { id: str(), createdAt: str({ format: 'date-time' }) } },
        LineItem: {
          type: 'object',
          required: ['id', 'description', 'quantity', 'price'],
          properties: { id: str(), description: str(), quantity: { type: 'number' }, price: { type: 'number' } },
        },
        LineItemInput: {
          type: 'object',
          required: ['description', 'quantity', 'price'],
          properties: {
            id: str({ maxLength: LIMITS.id, description: 'Generated when omitted' }),
            description: str({ minLength: 1, maxLength: LIMITS.lineDescription }),
            quantity: { type: 'number', minimum: 0 },
            price: { type: 'number', minimum: 0 },
          },
        },
        InvoiceInput: {
          type: 'object',
          required: ['lineItems'],
          description: 'toName is required unless clientId is given',
          properties: { ...invoiceFields, createdAt: str({ format: 'date-time', description: 'PUT only: kept when the PUT creates the invoice' }) },
        },
        InvoicePatch: { type: 'object', properties: invoiceFields, description: 'Any subset; lineItems replaces the list' },
        Invoice: {
          type: 'object',
          required: ['id', 'invoiceNumber', 'issueDate', 'lineItems', 'currency', 'createdAt', 'updatedAt', 'revision', 'createdBy', 'updatedBy', 'subtotal', 'taxAmount', 'total', 'deletedAt', 'status', 'sentAt', 'paidAt', 'isOverdue', 'daysOverdue'],
          properties: {
            id: str({ format: 'uuid' }),
            version: { type: 'integer' },
            ...invoiceFields,
            lineItems: { type: 'array', items: ref('LineItem') },
            createdAt: str({ format: 'date-time' }),
            updatedAt: str({ format: 'date-time', description: 'Set by the server (D1 clock) on every write' }),
            deletedAt: { type: ['string', 'null'], format: 'date-time' },
            revision: { type: 'integer', description: 'Incremented on every write; also the ETag' },
            createdBy: ref('Actor'),
            updatedBy: ref('Actor'),
            subtotal: { type: 'number' },
            taxAmount: { type: 'number' },
            total: { type: 'number' },
            isOverdue: { type: 'boolean', description: 'Derived: status sent and dueDate before today (UTC)' },
            daysOverdue: { type: 'integer', minimum: 0, description: 'Derived: whole days past dueDate, 0 unless overdue' },
          },
        },
        InvoiceSummary: {
          type: 'object',
          required: ['asOf', 'currencies', 'oldestOverdue'],
          properties: {
            asOf: str({ format: 'date', description: 'The UTC date the summary was computed for' }),
            currencies: {
              type: 'array',
              description: 'One entry per currency used by non-void invoices; amounts are never summed across currencies',
              items: {
                type: 'object',
                required: ['currency', 'draft', 'outstanding', 'overdue', 'paidThisMonth', 'paidThisYear'],
                properties: {
                  currency: str(),
                  draft: summaryBucket,
                  outstanding: { ...summaryBucket, description: 'Sent, not overdue' },
                  overdue: { ...summaryBucket, description: 'Sent, dueDate before today' },
                  paidThisMonth: { ...summaryBucket, description: 'Paid, paidAt in the current month' },
                  paidThisYear: { ...summaryBucket, description: 'Paid, paidAt in the current year' },
                },
              },
            },
            oldestOverdue: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: str({ format: 'uuid' }),
                  invoiceNumber: str(),
                  invoiceName: str(),
                  toName: str(),
                  currency: str(),
                  total: { type: 'number' },
                  dueDate: str({ format: 'date' }),
                  daysOverdue: { type: 'integer' },
                },
              },
            },
          },
        },
        Settings: {
          type: 'object',
          required: ['fromName', 'fromEmail', 'fromAddress', 'paymentDetails', 'notes', 'taxRate', 'currency'],
          properties: {
            fromName: str(),
            fromEmail: str(),
            fromAddress: str(),
            paymentDetails: str(),
            notes: str(),
            taxRate: { type: 'number', minimum: 0, maximum: 100 },
            currency: str(),
          },
        },
        AgentSummary: {
          type: 'object',
          properties: {
            id: str(),
            name: str(),
            description: { type: ['string', 'null'] },
            scopes: { type: 'array', items: scopeSchema },
            createdAt: str({ format: 'date-time' }),
            lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
            revokedAt: { type: ['string', 'null'], format: 'date-time' },
            connection: { type: 'string', enum: ['api_key', 'oauth'], description: 'API key (device flow) or OAuth (MCP client)' },
          },
        },
      },
    },
    paths: {
      '/health': { get: { summary: 'Health check', security: [], responses: { 200: ok('OK', { type: 'object', properties: { status: { const: 'ok' }, time: str() } }) } } },
      '/openapi.json': { get: { summary: 'This document', security: [], responses: { 200: { description: 'OpenAPI 3.1 document' } } } },
      ...clientOpenApiPaths,
      ...templateOpenApiPaths,
      ...oauthOpenApiPaths,
      ...activityOpenApiPaths,
      ...recurringOpenApiPaths,
      '/workspaces': {
        post: {
          summary: 'Create an anonymous workspace',
          description: 'Returns the workspace token once; only its SHA-256 is stored. Rate limited per IP.',
          security: [],
          responses: {
            201: ok('Created', { type: 'object', properties: { workspace: ref('Workspace'), token: str({ description: 'mi_ws_…' }) } }),
            403: { ...E[403], description: '`registration_closed`, or `account_required` when the site requires a signed-in account for new workspaces' },
            429: E[429],
          },
        },
      },
      '/workspace': {
        get: { summary: 'Current workspace', ...userOnly, responses: { 200: ok('OK', { type: 'object', properties: { workspace: ref('Workspace') } }), 401: E[401], 403: E[403] } },
        delete: { summary: 'Delete the workspace and all its data', ...userOnly, responses: { 204: { description: 'Deleted' }, 401: E[401], 403: E[403] } },
      },
      '/agents/register': {
        post: {
          summary: 'Start agent registration (device flow)',
          security: [],
          requestBody: {
            required: true,
            content: jsonContent({
              type: 'object',
              required: ['name', 'scopes'],
              properties: { name: str({ maxLength: LIMITS.agentName }), description: str({ maxLength: LIMITS.agentDescription }), scopes },
            }),
          },
          responses: {
            201: ok('Registration started', {
              type: 'object',
              properties: {
                registration_id: str(),
                device_code: str({ description: 'mi_dc_… secret, poll with it' }),
                user_code: str({ example: 'WXYZ-BCDF' }),
                verification_url: str(),
                verification_url_complete: str(),
                expires_in: { type: 'integer' },
                interval: { type: 'integer' },
              },
            }),
            400: E[400],
            413: E[413],
            415: E[415],
            429: E[429],
          },
        },
      },
      '/agents/token': {
        post: {
          summary: 'Poll for / redeem the agent API key',
          description:
            'Errors (HTTP 400, error.code): authorization_pending, slow_down, access_denied, expired_token, invalid_grant (unknown or already redeemed device_code). Success is returned exactly once.',
          security: [],
          requestBody: { required: true, content: jsonContent({ type: 'object', required: ['device_code'], properties: { device_code: str() } }) },
          responses: {
            200: ok('Approved: API key issued', {
              type: 'object',
              properties: {
                api_key: str({ description: 'mi_agent_… (shown once)' }),
                token_type: { const: 'Bearer' },
                agent: { type: 'object', properties: { id: str(), name: str(), scopes: { type: 'array', items: scopeSchema }, workspace_id: str() } },
              },
            }),
            400: err('Device-flow error, see description'),
            429: E[429],
          },
        },
      },
      '/agents/registrations/{user_code}': {
        get: {
          summary: 'Preview a pending registration',
          ...userOnly,
          parameters: [userCodeParam],
          responses: { 200: ok('Pending registration', { type: 'object' }), 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 429: E[429] },
        },
      },
      '/agents/registrations/{user_code}/approve': {
        post: {
          summary: 'Approve (optionally narrowing scopes)',
          ...userOnly,
          parameters: [userCodeParam],
          requestBody: { required: false, content: jsonContent({ type: 'object', properties: { scopes } }) },
          responses: { 200: ok('Approved', { type: 'object' }), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 429: E[429] },
        },
      },
      '/agents/registrations/{user_code}/deny': {
        post: {
          summary: 'Deny',
          ...userOnly,
          parameters: [userCodeParam],
          responses: { 200: ok('Denied', { type: 'object' }), 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 429: E[429] },
        },
      },
      '/agents': {
        get: {
          summary: 'List agents (including revoked)',
          ...userOnly,
          responses: { 200: ok('Agents', { type: 'object', properties: { agents: { type: 'array', items: ref('AgentSummary') } } }), 401: E[401], 403: E[403] },
        },
      },
      '/agents/me': {
        get: { summary: "The calling agent's identity and scopes", ...agentOnly, responses: { 200: ok('Agent', { type: 'object' }), 401: E[401], 403: E[403] } },
      },
      '/agents/{id}': {
        delete: {
          summary: 'Revoke an agent (immediate)',
          ...userOnly,
          parameters: [{ name: 'id', in: 'path', required: true, schema: str() }],
          responses: { 204: { description: 'Revoked (idempotent)' }, 401: E[401], 403: E[403], 404: E[404] },
        },
      },
      '/invoices': {
        get: {
          summary: 'List invoices (sync feed)',
          description:
            'Ordered by (updatedAt, id). Without updated_since: all live invoices. With updated_since: invoices with updatedAt >= updated_since. ' +
            'With updated_since + after_id: keyset continuation (strictly after that position). Tombstones only with include_deleted=true.',
          ...scoped('invoices:read'),
          parameters: [
            { name: 'updated_since', in: 'query', schema: str({ format: 'date-time' }) },
            { name: 'after_id', in: 'query', schema: str(), description: 'From `next.after_id`; requires updated_since' },
            { name: 'include_deleted', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: LIMITS.listMax, default: LIMITS.listMax } },
            ...statusFilterParams,
          ],
          responses: {
            200: ok('Invoices', {
              type: 'object',
              properties: {
                invoices: { type: 'array', items: ref('Invoice') },
                syncedAt: str({ format: 'date-time' }),
                hasMore: { type: 'boolean' },
                next: { type: ['object', 'null'], properties: { updated_since: str(), after_id: str() } },
              },
            }),
            400: E[400],
            401: E[401],
            403: E[403],
          },
        },
        post: {
          summary: 'Create an invoice',
          ...scoped('invoices:write'),
          requestBody: invoiceBody('InvoiceInput'),
          responses: { 201: invoiceResult('Created'), 400: E[400], 401: E[401], 403: E[403], 413: E[413], 415: E[415] },
        },
      },
      '/invoices/next-number': {
        get: {
          summary: 'Next sequential invoice number',
          ...scoped('invoices:read'),
          responses: { 200: ok('Next number', { type: 'object', properties: { invoiceNumber: str({ example: 'INV-0007' }) } }), 401: E[401], 403: E[403] },
        },
      },
      '/invoices/{id}': {
        get: { summary: 'Get an invoice', ...scoped('invoices:read'), parameters: [idParam], responses: { 200: invoiceResult('OK'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 410: E[410] } },
        put: {
          summary: 'Create or replace an invoice with a client-chosen UUID',
          description: '201 when created, 200 when replaced. A deleted id returns 410. If-None-Match: * = create only.',
          ...scoped('invoices:write'),
          parameters: [idParam, ifMatch, { name: 'If-None-Match', in: 'header', required: false, schema: { const: '*' } }],
          requestBody: invoiceBody('InvoiceInput'),
          responses: { 200: invoiceResult('Replaced'), 201: invoiceResult('Created'), 400: E[400], 401: E[401], 403: E[403], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
        },
        patch: {
          summary: 'Update some fields',
          ...scoped('invoices:write'),
          parameters: [idParam, ifMatch],
          requestBody: invoiceBody('InvoicePatch'),
          responses: { 200: invoiceResult('Updated'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
        },
        delete: {
          summary: 'Soft-delete an invoice (idempotent)',
          ...scoped('invoices:delete'),
          parameters: [idParam, ifMatch],
          responses: { 204: { description: 'Deleted (or already deleted)' }, 400: E[400], 401: E[401], 403: E[403], 404: E[404], 412: E[412] },
        },
      },
      '/invoices/{id}/pdf': {
        get: {
          summary: 'Invoice as PDF (rendered by the app’s InvoicePDF component)',
          description: 'Same typefaces, colours and layout as the app’s invoice preview. `theme` picks the preview’s light or dark look (default dark, the app default).',
          ...scoped('invoices:read'),
          parameters: [
            idParam,
            { name: 'theme', in: 'query', required: false, schema: { type: 'string', enum: [...INVOICE_THEMES], default: DEFAULT_INVOICE_THEME } },
          ],
          responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 400: E[400], 401: E[401], 403: E[403], 404: E[404], 410: E[410] },
        },
      },
      '/invoices/summary': {
        get: {
          summary: 'What is unpaid: counts and totals per currency',
          description:
            'Draft, outstanding (sent, not overdue), overdue, paid this month and paid this year, grouped by currency, plus the oldest overdue invoices. ' +
            'Void and deleted invoices are excluded. "Today" is the UTC date.',
          ...scoped('invoices:read'),
          parameters: [
            { name: 'oldest_overdue_limit', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 50, default: 5 } },
          ],
          responses: { 200: ok('Summary', ref('InvoiceSummary')), 400: E[400], 401: E[401], 403: E[403] },
        },
      },
      ...statusActionPaths(),
      ...emailOpenApiPaths,
      '/settings': {
        get: { summary: 'Default sender settings', ...scoped('settings:read'), responses: { 200: ok('Settings', { type: 'object', properties: { settings: ref('Settings'), updatedAt: { type: ['string', 'null'] } } }), 401: E[401], 403: E[403] } },
        put: {
          summary: 'Replace default sender settings',
          ...userOnly,
          requestBody: { required: true, content: jsonContent(ref('Settings')) },
          responses: { 200: ok('Saved', { type: 'object', properties: { settings: ref('Settings'), updatedAt: str() } }), 400: E[400], 401: E[401], 403: E[403] },
        },
      },
    },
    'x-mcp': {
      endpoint: `${baseUrl}/api/mcp`,
      transport: 'streamable-http (stateless, JSON responses)',
      auth: 'Same Bearer credentials, or an OAuth 2.1 access token (MCP authorization; not accepted by this REST API)',
    },
    'x-oauth': {
      protectedResourceMetadata: `${baseUrl}/.well-known/oauth-protected-resource/api/mcp`,
      authorizationServerMetadata: `${baseUrl}/.well-known/oauth-authorization-server`,
    },
  };
}
