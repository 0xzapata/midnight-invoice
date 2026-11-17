/**
 * MCP tool `get_my_activity` (scope activity:read), registered by
 * server/mcp.ts. An agent key only ever sees entries it made itself.
 */
import { z } from 'zod';
import { ACTIVITY_PAGE } from '../shared/activity';
import type { ToolRegistrar } from './mcpClients';
import { isoDateTime } from './schemas';
import { listActivity, parseActivityQuery } from './services/activity';
import type { ServiceContext } from './services/invoices';

export function registerActivityTools(tool: ToolRegistrar, ctx: ServiceContext): void {
  tool(
    'get_my_activity',
    'activity:read',
    {
      title: 'My activity',
      description:
        'What you (this agent) did in this workspace, newest first: invoices and clients you created, changed or deleted, status changes, PDF downloads. ' +
        'Use it to check whether you already did something (e.g. created this month’s invoice) before doing it again. ' +
        'Entries name the changed fields, never their values. Never includes the user’s or other agents’ activity.',
      inputSchema: z.object({
        action: z.string().max(500).optional().describe('Comma-separated action codes or prefixes, e.g. "invoice.created" or "invoice.,client."'),
        entity_type: z.string().max(32).optional().describe('Only entries about this kind of thing: invoice, client, settings.'),
        entity_id: z.string().max(64).optional().describe('Only entries about this invoice/client id.'),
        since: isoDateTime.optional().describe('Only entries at or after this ISO timestamp.'),
        until: isoDateTime.optional().describe('Only entries at or before this ISO timestamp.'),
        before: z.string().max(40).optional().describe('Paging cursor: next.before from the previous result.'),
        limit: z.number().int().min(1).max(ACTIVITY_PAGE.max).optional().describe(`Max entries (default ${ACTIVITY_PAGE.default}).`),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const result = await listActivity(ctx, parseActivityQuery(args));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
    },
  );
}
