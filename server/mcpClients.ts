/**
 * MCP tools for saved clients, registered by server/mcp.ts through its
 * scope-gated `tool` helper (hidden unless the credential has the scope).
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Scope } from '../shared/api';
import { CLIENT_LIMITS } from '../shared/types/client';
import { clientInputSchema, clientPatchSchema } from './clientSchemas';
import { LIMITS } from './schemas';
import * as clients from './services/clients';
import type { ServiceContext } from './services/invoices';

export type ToolRegistrar = <S extends z.ZodObject>(
  name: string,
  scope: Scope,
  config: { title: string; description: string; inputSchema: S; annotations: Record<string, boolean> },
  run: (args: z.infer<S>) => Promise<CallToolResult>,
) => void;

const CLIENT_FIELD_DOCS: Record<string, string> = {
  name: 'Client name or company, as printed on invoices.',
  email: 'Billing email.',
  address: 'Postal address (multi-line allowed).',
  defaultCurrency: 'ISO 4217 code used for new invoices for this client, or null for the workspace default.',
  defaultTaxRate: 'Tax rate in percent (0-100) for new invoices for this client, or null for the workspace default.',
  paymentTermsDays: 'New invoices are due this many days after their issue date (e.g. 30), or null for no due date.',
  notes: 'Private notes about the client (not printed on invoices).',
  archivedAt: 'ISO timestamp to archive the client (hidden from the app’s client picker), null to unarchive.',
};

function describe<T extends z.ZodRawShape>(shape: T): T {
  return Object.fromEntries(
    Object.entries(shape).map(([k, s]) => [k, CLIENT_FIELD_DOCS[k] ? (s as z.ZodType).describe(CLIENT_FIELD_DOCS[k]) : s]),
  ) as T;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

const idInput = z.object({ id: z.string().describe('Client id (UUID).') });

export function registerClientTools(tool: ToolRegistrar, ctx: ServiceContext): void {
  tool(
    'list_clients',
    'clients:read',
    {
      title: 'List clients',
      description:
        'List saved clients, optionally searching by name or email (case-insensitive substring). Use this to find a client before creating an invoice for it; archived clients are included with archivedAt set.',
      inputSchema: z.object({
        query: z.string().max(CLIENT_LIMITS.name).optional().describe('Search text matched against client name and email, e.g. "globex".'),
        limit: z.number().int().min(1).max(LIMITS.listMax).optional().describe(`Max results (default ${LIMITS.listMax}).`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const res = await clients.listClients(ctx, { q: query, limit });
      return json({ clients: res.clients, hasMore: res.hasMore });
    },
  );

  tool(
    'get_client',
    'clients:read',
    { title: 'Get client', description: 'Get one saved client by id.', inputSchema: idInput, annotations: { readOnlyHint: true } },
    async ({ id }) => json({ client: await clients.getClient(ctx, id) }),
  );

  tool(
    'create_client',
    'clients:write',
    {
      title: 'Create client',
      description: 'Save a new client. Only name is required. Check list_clients first so you do not create a duplicate.',
      inputSchema: z.object(describe(clientInputSchema.omit({ createdAt: true, id: true }).shape)),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => json({ client: await clients.createClient(ctx, args) }),
  );

  tool(
    'update_client',
    'clients:write',
    {
      title: 'Update client',
      description:
        'Update some fields of a saved client; omitted fields are kept. Existing invoices are not changed (they keep their own copy of the client details). Pass expected_revision to avoid overwriting concurrent changes.',
      inputSchema: z.object({
        id: z.string().describe('Client id (UUID).'),
        expected_revision: z.number().int().optional().describe('Optional optimistic-concurrency check: fail if the client changed since you read it.'),
        ...describe(clientPatchSchema.omit({ id: true }).shape),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, expected_revision, ...patch }) => json({ client: await clients.patchClient(ctx, id, patch, { ifMatch: expected_revision }) }),
  );

  tool(
    'delete_client',
    'clients:write',
    {
      title: 'Delete client',
      description:
        'Delete a saved client (soft delete). Invoices billed to it keep their copy of its details. Prefer update_client with archivedAt to hide a client you may need again. Deleting an already deleted client succeeds.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      await clients.deleteClient(ctx, id, {});
      return json({ deleted: true, id });
    },
  );
}
