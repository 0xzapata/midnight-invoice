/**
 * OpenAPI 3.1 fragments for /api/v1/clients, merged into the document by
 * server/openapi.ts (whose consistency test covers these routes too).
 */
import { CLIENT_LIMITS } from '../shared/types/client';
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
  410: err('Gone (deleted client)'),
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
  content: jsonContent({ type: 'object', required: ['client'], properties: { client: ref('Client') } }),
});

const clientFields: Json = {
  name: str({ minLength: 1, maxLength: CLIENT_LIMITS.name }),
  email: str({ maxLength: CLIENT_LIMITS.email, description: 'Empty string or an email address' }),
  address: str({ maxLength: CLIENT_LIMITS.address }),
  defaultCurrency: { type: ['string', 'null'], description: 'ISO 4217 code for new invoices; null = workspace default' },
  defaultTaxRate: { type: ['number', 'null'], minimum: 0, maximum: 100, description: 'Percent for new invoices; null = workspace default' },
  paymentTermsDays: {
    type: ['integer', 'null'],
    minimum: 0,
    maximum: CLIENT_LIMITS.maxPaymentTermsDays,
    description: 'New invoices are due issueDate + this many days; null = no due date',
  },
  notes: str({ maxLength: CLIENT_LIMITS.notes, description: 'Private, never printed on invoices' }),
  archivedAt: { type: ['string', 'null'], format: 'date-time', description: 'Set to archive (hidden from the app’s picker), null to unarchive' },
};

export const clientOpenApiSchemas: Record<string, Json> = {
  ClientInput: {
    type: 'object',
    required: ['name'],
    properties: { ...clientFields, createdAt: str({ format: 'date-time', description: 'PUT only: kept when the PUT creates the client' }) },
  },
  ClientPatch: { type: 'object', properties: clientFields, description: 'Any subset of fields' },
  Client: {
    type: 'object',
    required: ['id', 'name', 'email', 'address', 'defaultCurrency', 'defaultTaxRate', 'paymentTermsDays', 'notes', 'archivedAt', 'createdAt', 'updatedAt', 'deletedAt', 'revision', 'createdBy', 'updatedBy'],
    properties: {
      id: str({ format: 'uuid' }),
      ...clientFields,
      createdAt: str({ format: 'date-time' }),
      updatedAt: str({ format: 'date-time', description: 'Set by the server (D1 clock) on every write' }),
      deletedAt: { type: ['string', 'null'], format: 'date-time' },
      revision: { type: 'integer', description: 'Incremented on every write; also the ETag' },
      createdBy: ref('Actor'),
      updatedBy: ref('Actor'),
      invoiceCount: { type: 'integer', description: 'Live invoices referencing this client; only for credentials with invoices:read' },
    },
  },
};

export const clientOpenApiPaths: Record<string, Json> = {
  '/clients': {
    get: {
      summary: 'List or search saved clients (sync feed)',
      description:
        'Same ordering, paging and sync contract as GET /invoices: ordered by (updatedAt, id); updated_since is inclusive; continue with next.updated_since + next.after_id; ' +
        'tombstones only with include_deleted=true. q filters by case-insensitive substring of name or email. Archived clients are included (archivedAt set).',
      ...scoped('clients:read'),
      parameters: [
        { name: 'q', in: 'query', schema: str({ maxLength: CLIENT_LIMITS.name }), description: 'Search name or email' },
        { name: 'updated_since', in: 'query', schema: str({ format: 'date-time' }) },
        { name: 'after_id', in: 'query', schema: str(), description: 'From `next.after_id`; requires updated_since' },
        { name: 'include_deleted', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: LIMITS.listMax, default: LIMITS.listMax } },
      ],
      responses: {
        200: {
          description: 'Clients',
          content: jsonContent({
            type: 'object',
            properties: {
              clients: { type: 'array', items: ref('Client') },
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
      summary: 'Save a new client',
      ...scoped('clients:write'),
      requestBody: body('ClientInput'),
      responses: { 201: result('Created'), 400: E[400], 401: E[401], 403: E[403], 413: E[413], 415: E[415] },
    },
  },
  '/clients/{id}': {
    get: { summary: 'Get a client', ...scoped('clients:read'), parameters: [idParam], responses: { 200: result('OK'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 410: E[410] } },
    put: {
      summary: 'Create or replace a client with a client-chosen UUID',
      description: '201 when created, 200 when replaced. A deleted id returns 410. If-None-Match: * = create only.',
      ...scoped('clients:write'),
      parameters: [idParam, ifMatch, { name: 'If-None-Match', in: 'header', required: false, schema: { const: '*' } }],
      requestBody: body('ClientInput'),
      responses: { 200: result('Replaced'), 201: result('Created'), 400: E[400], 401: E[401], 403: E[403], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
    },
    patch: {
      summary: 'Update some fields of a client (e.g. archive with archivedAt)',
      ...scoped('clients:write'),
      parameters: [idParam, ifMatch],
      requestBody: body('ClientPatch'),
      responses: { 200: result('Updated'), 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 412: E[412], 413: E[413], 415: E[415] },
    },
    delete: {
      summary: 'Soft-delete a client (idempotent). Invoices keep their copy of its details.',
      ...scoped('clients:write'),
      parameters: [idParam, ifMatch],
      responses: { 204: { description: 'Deleted (or already deleted)' }, 400: E[400], 401: E[401], 403: E[403], 404: E[404], 412: E[412] },
    },
  },
};
