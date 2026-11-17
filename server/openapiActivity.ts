/**
 * OpenAPI 3.1 fragments for the activity log (GET /activity,
 * GET /agents/:id/activity), merged into the document by server/openapi.ts.
 */
import { ACTIVITY_ACTIONS, ACTIVITY_PAGE, ACTIVITY_RETENTION } from '../shared/activity';
import { INVOICE_STATUSES } from '../shared/invoice-status';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: Json) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: jsonContent(ref('Error')) });
const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const security = { security: [{ bearerAuth: [] }], 'x-required-credential': 'workspace token, or agent key with activity:read (own entries only)' };

const E = {
  400: err('Invalid query parameters (validation_failed)'),
  401: err('Missing or invalid bearer token'),
  403: err('insufficient_scope (agent without activity:read) or forbidden (an agent asking for others’ activity)'),
  404: err('Agent not found'),
};

const filters = [
  { name: 'actor', in: 'query', required: false, schema: str({ pattern: '^(user|system|agent:.+)$' }), description: 'user, system or agent:<id> (who did it)' },
  { name: 'action', in: 'query', required: false, schema: str(), description: 'Comma list of action codes or prefixes (OR), e.g. invoice.,agent.revoked' },
  { name: 'entity_type', in: 'query', required: false, schema: str(), description: 'invoice, client, settings, agent, agent_registration' },
  { name: 'entity_id', in: 'query', required: false, schema: str() },
  { name: 'since', in: 'query', required: false, schema: str({ format: 'date-time' }), description: 'Inclusive' },
  { name: 'until', in: 'query', required: false, schema: str({ format: 'date-time' }), description: 'Inclusive' },
  { name: 'before', in: 'query', required: false, schema: str(), description: 'Cursor from next.before (older entries)' },
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: ACTIVITY_PAGE.max, default: ACTIVITY_PAGE.default } },
];

const list = { description: 'Entries, newest first', content: jsonContent(ref('ActivityPage')) };

export const activityOpenApiSchemas: Record<string, Json> = {
  ActivityEntry: {
    type: 'object',
    required: ['id', 'time', 'actor', 'action', 'entity', 'changes', 'source', 'tool', 'requestId'],
    properties: {
      id: str({ description: 'Time-ordered id; descending = newest first' }),
      time: str({ format: 'date-time' }),
      actor: {
        type: 'object',
        required: ['type'],
        properties: { type: { enum: ['user', 'agent', 'system'] }, agentId: str(), agentName: str({ description: 'Name at the time' }) },
      },
      action: str({ description: 'Stable dotted code; clients must accept codes they do not know', examples: [...ACTIVITY_ACTIONS] }),
      entity: {
        type: ['object', 'null'],
        properties: { type: str(), id: str(), label: { type: ['string', 'null'], description: 'Snapshot (invoice number, client or agent name)' } },
      },
      changes: {
        type: ['object', 'null'],
        description: 'Compact summary; never document bodies or secrets',
        properties: {
          fields: { type: 'array', items: str(), description: 'Names of changed fields' },
          status: { type: 'object', properties: { from: { enum: [...INVOICE_STATUSES, null] }, to: { enum: [...INVOICE_STATUSES] } } },
          scopes: { type: 'array', items: ref('Scope') },
          counts: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Bulk upload: entities per collection' },
          theme: str(),
          registrationId: str({ description: 'agent.registered: the registration whose agent.approved entry belongs to this agent' }),
        },
      },
      source: { enum: ['rest', 'mcp', 'system'] },
      tool: { type: ['string', 'null'], description: 'MCP tool name' },
      requestId: { type: ['string', 'null'] },
    },
  },
  ActivityPage: {
    type: 'object',
    required: ['activity', 'hasMore', 'next'],
    properties: {
      activity: { type: 'array', items: ref('ActivityEntry') },
      hasMore: { type: 'boolean' },
      next: { type: ['object', 'null'], properties: { before: str() } },
    },
  },
};

export const activityOpenApiPaths: Record<string, Json> = {
  '/activity': {
    get: {
      summary: 'Workspace activity log (audit trail), newest first',
      description:
        'What the user’s browsers and approved agents did: invoice/client/settings writes, status changes, PDF downloads, agent approvals and revocations. ' +
        'An agent key needs activity:read and only ever sees its own entries. ' +
        `Retention (configurable per deployment): by default ${ACTIVITY_RETENTION.days} days / newest ${ACTIVITY_RETENTION.maxRows} entries per workspace.`,
      ...security,
      parameters: [...filters, { name: 'agent_id', in: 'query', required: false, schema: str(), description: 'Entries by or about this agent' }],
      responses: { 200: list, 400: E[400], 401: E[401], 403: E[403] },
    },
  },
  '/agents/{id}/activity': {
    get: {
      summary: 'Activity by or about one agent',
      ...security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: str() }, ...filters],
      responses: { 200: list, 400: E[400], 401: E[401], 403: E[403], 404: E[404] },
    },
  },
};
