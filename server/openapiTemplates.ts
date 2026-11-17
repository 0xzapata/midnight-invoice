/**
 * OpenAPI 3.1 fragments for /api/v1/templates, merged into the document by
 * server/openapi.ts (whose consistency test covers these routes too).
 */
import { TEMPLATE_PLACEHOLDERS } from '../shared/template-placeholders';
import { TEMPLATE_LIMITS } from '../shared/types/template';
import { LIMITS } from './schemas';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: Json) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: jsonContent(ref('Error')) });
const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const bearer = [{ bearerAuth: [] }];
const scoped = (scope: string) => ({ security: bearer, 'x-required-scope': scope });

const E = {
  400: err('Invalid request (validation_failed, invalid_json, bad_request)'),
  401: err('Missing or invalid bearer token (WWW-Authenticate: Bearer)'),
  403: err('Authenticated but not allowed (insufficient_scope or forbidden)'),
  404: err('Not found'),
  409: err('Conflict'),
  410: err('Gone (deleted template)'),
  412: err('If-Match / If-None-Match precondition failed'),
  413: err('Body too large'),
  415: err('Content-Type must be application/json'),
};

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const ifMatch = {
  name: 'If-Match',
  in: 'header',
  required: false,
  description: 'ETag (revision) from a previous response, e.g. "3". Mismatch → 412.',
  schema: { type: 'string' },
};
const body = (schema: string) => ({ required: true, content: jsonContent(ref(schema)) });
const result = (d: string) => ({
  description: d,
  headers: { ETag: { schema: { type: 'string' }, description: 'Quoted revision' } },
  content: jsonContent({ type: 'object', required: ['template'], properties: { template: ref('Template') } }),
});

const PLACEHOLDER_DOC = `Placeholders: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p.name}}} (${p.description}, e.g. ${p.example})`).join('; ')}. Unknown names are left as typed.`;

const templateFields: Json = {
  name: str({ minLength: 1, maxLength: TEMPLATE_LIMITS.name }),
  description: str({ maxLength: TEMPLATE_LIMITS.description, description: 'What the template is for; never printed' }),
  clientId: { type: ['string', 'null'], format: 'uuid', description: 'Default saved client (requires clients:read when set or changed; must be a live client). null = none' },
  lineItems: {
    type: 'array',
    maxItems: TEMPLATE_LIMITS.maxLineItems,
    items: ref('LineItemInput'),
    description: `Line descriptions may contain placeholders. ${PLACEHOLDER_DOC}`,
  },
  taxRate: { type: ['number', 'null'], minimum: 0, maximum: 100, description: 'Percent; null = client default, then settings' },
  currency: { type: ['string', 'null'], description: 'ISO 4217 code; null = client default, then settings' },
  notes: str({ maxLength: TEMPLATE_LIMITS.notes, description: 'Printed notes; may contain placeholders. "" = none' }),
  paymentDetails: str({ maxLength: TEMPLATE_LIMITS.paymentDetails, description: '"" = settings.paymentDetails' }),
  paymentTermsDays: {
    type: ['integer', 'null'],
    minimum: 0,
    maximum: TEMPLATE_LIMITS.maxPaymentTermsDays,
    description: 'dueDate = issueDate + this many days; null = client terms, else no due date',
  },
  invoiceNamePattern: str({ maxLength: TEMPLATE_LIMITS.invoiceNamePattern, description: 'Invoice name; may contain placeholders. "" = default naming' }),
  archivedAt: { type: ['string', 'null'], format: 'date-time', description: 'Set to archive (hidden from the app’s pickers), null to unarchive' },
};

export const templateOpenApiSchemas: Record<string, Json> = {
  TemplateInput: {
    type: 'object',
    required: ['name'],
    properties: { ...templateFields, createdAt: str({ format: 'date-time', description: 'PUT only: kept when the PUT creates the template' }) },
  },
  TemplatePatch: { type: 'object', properties: templateFields, description: 'Any subset of fields; lineItems replaces the list' },
  Template: {
    type: 'object',
    required: [
      'id', 'name', 'description', 'clientId', 'lineItems', 'taxRate', 'currency', 'notes', 'paymentDetails', 'paymentTermsDays',
      'invoiceNamePattern', 'archivedAt', 'createdAt', 'updatedAt', 'deletedAt', 'revision', 'createdBy', 'updatedBy',
    ],
    properties: {
      id: str({ format: 'uuid' }),
      ...templateFields,
      lineItems: { type: 'array', items: ref('LineItem') },
      createdAt: str({ format: 'date-time' }),
      updatedAt: str({ format: 'date-time', description: 'Set by the server (D1 clock) on every write' }),
      deletedAt: { type: ['string', 'null'], format: 'date-time' },
      revision: { type: 'integer', description: 'Incremented on every write; also the ETag' },
      createdBy: ref('Actor'),
      updatedBy: ref('Actor'),
    },
  },
  InstantiateTemplateRequest: {
    description:
      'Optional explicit values for the new invoice: any InvoicePatch field (status, sentAt, paidAt and templateId are ignored: the invoice is a draft that records this template). Each one given wins over the template ' +
      '(lineItems replaces all template lines; clientId null = no saved client). Given values are used verbatim (no placeholders).',
    allOf: [ref('InvoicePatch')],
  },
  InstantiateTemplateResult: {
    type: 'object',
    required: ['invoice', 'template', 'placeholders', 'warnings'],
    properties: {
      invoice: ref('Invoice'),
      template: { type: 'object', properties: { id: str({ format: 'uuid' }), name: str(), revision: { type: 'integer' } } },
      placeholders: {
        type: 'object',
        properties: {
          unknown: { type: 'array', items: str(), description: '{{names}} that are not placeholders (left as typed)' },
          unresolved: { type: 'array', items: str(), description: 'Known placeholders without a value, e.g. client_name with no client (left as typed)' },
        },
      },
      warnings: { type: 'array', items: str() },
    },
  },
};

export const templateOpenApiPaths: Record<string, Json> = {
  '/templates': {
    get: {
      summary: 'List or search invoice templates (sync feed)',
      description:
        'Same ordering, paging and sync contract as GET /invoices: ordered by (updatedAt, id); updated_since is inclusive; continue with next.updated_since + next.after_id; ' +
        'tombstones only with include_deleted=true. q filters by case-insensitive substring of name or description. Archived templates are included (archivedAt set).',
      ...scoped('templates:read'),
      parameters: [
        { name: 'q', in: 'query', schema: str({ maxLength: TEMPLATE_LIMITS.name }), description: 'Search name or description' },
        { name: 'updated_since', in: 'query', schema: str({ format: 'date-time' }) },
        { name: 'after_id', in: 'query', schema: str(), description: 'From `next.after_id`; requires updated_since' },
        { name: 'include_deleted', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: LIMITS.listMax, default: LIMITS.listMax } },
      ],
      responses: {
        200: {
          description: 'Templates',
          content: jsonContent({
            type: 'object',
            properties: {
              templates: { type: 'array', items: ref('Template') },
              syncedAt: str({ format: 'date-time' }),
              hasMore: { type: 'boolean' },
              next: { type: ['object', 'null'], properties: { updated_since: str(), after_id: str() } },
            },
          }),
        },
        400: E[400],
        401: E[401],
        403: E[403],
      },
    },
    post: {
      summary: 'Save a new invoice template',
      ...scoped('templates:write'),
      requestBody: body('TemplateInput'),
      responses: { 201: result('Created'), 400: E[400], 401: E[401], 403: E[403], 413: E[413], 415: E[415] },
    },
  },
  '/templates/{id}': {
    get: { summary: 'Get a template', ...scoped('templates:read'), parameters: [idParam], responses: { 200: result('OK'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 410: E[410] } },
    put: {
      summary: 'Create or replace a template with a client-chosen UUID',
      description: '201 when created, 200 when replaced. A deleted id returns 410. If-None-Match: * = create only.',
      ...scoped('templates:write'),
      parameters: [idParam, ifMatch, { name: 'If-None-Match', in: 'header', required: false, schema: { const: '*' } }],
      requestBody: body('TemplateInput'),
      responses: { 200: result('Replaced'), 201: result('Created'), 400: E[400], 401: E[401], 403: E[403], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
    },
    patch: {
      summary: 'Update some fields of a template (e.g. archive with archivedAt)',
      ...scoped('templates:write'),
      parameters: [idParam, ifMatch],
      requestBody: body('TemplatePatch'),
      responses: { 200: result('Updated'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
    },
    delete: {
      summary: 'Soft-delete a template (idempotent). Invoices created from it are unaffected.',
      ...scoped('templates:write'),
      parameters: [idParam, ifMatch],
      responses: { 204: { description: 'Deleted (or already deleted)' }, 400: E[400], 401: E[401], 403: E[403], 404: E[404], 412: E[412] },
    },
  },
  '/templates/{id}/instantiate': {
    post: {
      summary: 'Create a draft invoice from a template',
      description:
        'Precedence for every field: explicit request value → template → client defaults → workspace settings. dueDate = issueDate + template.paymentTermsDays unless given. ' +
        `Placeholders in the template’s invoice name, line descriptions and notes are resolved against the issue date (default today, UTC), the Bill To name and the invoice number. ${PLACEHOLDER_DOC} ` +
        'The invoice is an independent snapshot that records templateId. Requires invoices:write and templates:read (plus clients:read when billed to a saved client).',
      ...scoped('invoices:write'),
      'x-also-required-scopes': ['templates:read'],
      parameters: [idParam],
      requestBody: { required: false, content: jsonContent(ref('InstantiateTemplateRequest')) },
      responses: {
        201: {
          description: 'Invoice created',
          headers: { ETag: { schema: { type: 'string' }, description: 'Quoted revision of the invoice' }, Location: { schema: { type: 'string' } } },
          content: jsonContent(ref('InstantiateTemplateResult')),
        },
        400: E[400],
        401: E[401],
        403: E[403],
        404: E[404],
        410: E[410],
        413: E[413],
        415: E[415],
      },
    },
  },
};
