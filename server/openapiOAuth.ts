/**
 * OpenAPI 3.1 fragments for the OAuth consent API under /api/v1 (used by the
 * app's consent screen), merged into the document by server/openapi.ts.
 *
 * The OAuth protocol endpoints themselves (/api/oauth/authorize, /token,
 * /register, /revoke) are outside /api/v1 and are described by the RFC 8414
 * authorization-server metadata at /.well-known/oauth-authorization-server
 * (and AGENT_API.md), which is what OAuth/MCP clients read; the document
 * points there via `x-oauth`.
 */
import { SCOPES } from '../shared/api';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: Json) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: jsonContent(ref('Error')) });
const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const userOnly = { security: [{ bearerAuth: [] }], 'x-required-credential': 'workspace token' };
const scopeList = { type: 'array', items: { type: 'string', enum: [...SCOPES] } };

const E = {
  400: err('Invalid body, or scopes that were not requested (invalid_scope)'),
  401: err('Missing or invalid bearer token'),
  403: err('Not the workspace token (agents cannot approve agents)'),
  404: err('No such authorization request'),
  409: err('Already approved or denied (details.status)'),
  410: err('Expired (10 minutes)'),
  415: err('Content-Type must be application/json'),
  429: err('Rate limited (Retry-After header)'),
};

const requestIdParam = {
  name: 'request_id',
  in: 'path',
  required: true,
  description: 'Id from the consent URL /agents/authorize?request=… (created by GET /api/oauth/authorize)',
  schema: { type: 'string' },
};

const decision = ok('Where to send the browser: the client redirect URI with code (or error=access_denied), state and iss', ref('OAuthDecision'));
function ok(description: string, schema: Json) {
  return { description, content: jsonContent(schema) };
}

export const oauthOpenApiSchemas: Record<string, Json> = {
  OAuthRequestPreview: {
    type: 'object',
    properties: {
      request: {
        type: 'object',
        properties: {
          id: str(),
          client: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['dcr', 'cimd'] },
              name: str({ description: 'Chosen by the client: show as untrusted plain text' }),
              metadataHost: { type: ['string', 'null'], description: 'cimd: host publishing the client metadata document' },
              clientUri: { type: ['string', 'null'] },
            },
          },
          redirect: {
            type: 'object',
            properties: {
              uri: str(),
              kind: { type: 'string', enum: ['https', 'loopback', 'custom_scheme'] },
              display: str({ description: 'Host[:port], or the custom scheme' }),
            },
          },
          requestedScopes: scopeList,
          scopesDefaulted: { type: 'boolean', description: 'The client asked for no scope; the defaults were used' },
          existingAgent: { type: ['object', 'null'], description: 'Active agent this client already has here; approving updates it' },
          createdAt: str({ format: 'date-time' }),
          expiresAt: str({ format: 'date-time' }),
        },
      },
    },
  },
  OAuthDecision: {
    type: 'object',
    required: ['status', 'redirectTo'],
    properties: { status: { type: 'string', enum: ['approved', 'denied'] }, redirectTo: str({ format: 'uri' }), scopes: scopeList },
  },
};

export const oauthOpenApiPaths: Record<string, Json> = {
  '/oauth/requests/{request_id}': {
    get: {
      summary: 'Preview a pending OAuth authorization request (consent screen)',
      ...userOnly,
      parameters: [requestIdParam],
      responses: { 200: ok('Pending request', ref('OAuthRequestPreview')), 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 429: E[429] },
    },
  },
  '/oauth/requests/{request_id}/approve': {
    post: {
      summary: 'Approve, optionally narrowing the scopes; issues the authorization code',
      description: 'Not CORS-enabled and only accepts the workspace token in the Authorization header, so it cannot be triggered cross-site.',
      ...userOnly,
      parameters: [requestIdParam],
      requestBody: { required: false, content: jsonContent({ type: 'object', additionalProperties: false, properties: { scopes: { ...scopeList, minItems: 1 } } }) },
      responses: { 200: decision, 400: E[400], 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 415: E[415], 429: E[429] },
    },
  },
  '/oauth/requests/{request_id}/deny': {
    post: {
      summary: 'Deny; the client receives error=access_denied',
      ...userOnly,
      parameters: [requestIdParam],
      responses: { 200: decision, 401: E[401], 403: E[403], 404: E[404], 409: E[409], 410: E[410], 429: E[429] },
    },
  },
};
