/**
 * Remote MCP endpoint (POST /api/mcp), built on the official MCP TypeScript
 * SDK v2 (`@modelcontextprotocol/server`). `createMcpHandler` is web-standard
 * (Request → Response) and builds a fresh McpServer per request from the
 * factory below, so it is stateless and runs per request in a Worker. It
 * serves the 2026-07-28 protocol; 2025-era clients (initialize handshake) are
 * routed with the SDK's `isLegacyRequest` to a per-request stateless
 * `WebStandardStreamableHTTPServerTransport` with `enableJsonResponse`, so both
 * eras get plain JSON responses (no SSE, no sessions).
 *
 * Authentication happens before the SDK (same Bearer tokens as REST); the
 * resolved principal is handed to the factory via `authInfo`, which registers
 * only the tools the credential has scopes for. Each tool re-checks its scope.
 */
import {
  createMcpHandler,
  isJsonContentType,
  isLegacyRequest,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Scope } from '../shared/api';
import { API_BASE_PATH } from '../shared/api';
import { hasScope, requireScope, type Principal } from './auth';
import type { AppDeps } from './deps';
import type { Repository } from './db/repository';
import { ApiError } from './errors';
import { pdfFilename } from './pdf/render';
import { DEFAULT_INVOICE_THEME, INVOICE_THEMES } from '@/components/invoice/invoiceTheme';
import { invoiceInputSchema, invoicePatchSchema, isoDateTime, LIMITS } from './schemas';
import * as invoices from './services/invoices';
import { registerClientTools } from './mcpClients';
import { registerStatusTools, statusListFilters } from './mcpStatusTools';
import { registerActivityTools } from './mcpActivity';
import type { ActivityRequest } from './services/activity';
import { downloadInvoicePdf } from './services/invoicePdf';

export const MCP_SERVER_INFO = { name: 'midnight-invoice', version: '1.0.0' };

const FIELD_DOCS: Record<string, string> = {
  invoiceNumber: 'Invoice number, e.g. "INV-0042". Omit on create to allocate the next number automatically.',
  invoiceName: 'Optional human-friendly title for the invoice.',
  issueDate: 'Issue date, YYYY-MM-DD. Defaults to today (UTC).',
  dueDate: 'Due date, YYYY-MM-DD, or "" for none.',
  fromName: 'Sender name/company. Defaults to workspace settings.',
  fromAddress: 'Sender address (multi-line allowed). Defaults to workspace settings.',
  fromEmail: 'Sender email. Defaults to workspace settings.',
  toName: 'Client name/company. Omit when clientId is given to use the saved client’s name.',
  toAddress: 'Client address (multi-line allowed). Omit when clientId is given to use the saved client’s address.',
  toEmail: 'Client email. Omit when clientId is given to use the saved client’s email.',
  lineItems: `Line items (1-${LIMITS.maxLineItems}). Each: description, quantity >= 0, unit price >= 0; id is generated if omitted.`,
  taxRate: 'Tax rate in percent (0-100). Defaults to workspace settings.',
  notes: 'Free-text notes printed on the invoice.',
  paymentDetails: 'Payment instructions (bank, IBAN, …). Defaults to workspace settings.',
  currency: 'ISO 4217 currency code, e.g. USD or EUR. Defaults to workspace settings.',
  clientId:
    'Id of a saved client to bill (from list_clients / get_client; requires clients:read). Look the client up first — never invent an address. ' +
    'Omitted toName/toAddress/toEmail are filled from the client, and omitted currency/taxRate/dueDate from its defaults before the workspace settings. ' +
    'null unlinks (update only).',
  status: 'Invoice status: draft (default), sent, paid or void. To change the status of an existing invoice prefer set_invoice_status.',
  sentAt: 'Date the invoice was sent, YYYY-MM-DD. Defaults to today when status is sent.',
  paidAt: 'Date the invoice was paid, YYYY-MM-DD. Defaults to today when status is paid.',
};

function describeShape<T extends z.ZodRawShape>(shape: T): T {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, FIELD_DOCS[key] ? (schema as z.ZodType).describe(FIELD_DOCS[key]) : schema]),
  ) as T;
}

const createInput = z.object(describeShape(invoiceInputSchema.omit({ createdAt: true, id: true }).shape));
const updateInput = z.object({
  id: z.string().describe('Invoice id (UUID).'),
  expected_revision: z
    .number()
    .int()
    .optional()
    .describe('Optional optimistic-concurrency check: fail if the invoice revision changed since you read it.'),
  ...describeShape(invoicePatchSchema.omit({ id: true }).shape),
});
const idInput = z.object({ id: z.string().describe('Invoice id (UUID).') });
const listInput = z.object({
  updated_since: isoDateTime.optional().describe('Only invoices changed at or after this ISO timestamp.'),
  include_deleted: z.boolean().optional().describe('Include soft-deleted invoices (tombstones). Default false.'),
  limit: z.number().int().min(1).max(LIMITS.listMax).optional().describe(`Max results (default ${LIMITS.listMax}).`),
  ...statusListFilters,
  client_id: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a client id (UUID)')
    .transform((v) => v.toLowerCase())
    .optional()
    .describe('Only invoices billed to this saved client (id from list_clients).'),
});

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function toolError(error: unknown, deps: AppDeps): CallToolResult {
  if (error instanceof ApiError) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(error.toBody()) }] };
  }
  deps.logError?.('MCP tool failed', error);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'internal_error', message: 'Internal error' } }) }] };
}

interface McpRequestEnv {
  principal: Principal;
  baseUrl: string;
  activity?: ActivityRequest;
}

function buildServer(deps: AppDeps, repo: Repository, env: McpRequestEnv): McpServer {
  const { principal, baseUrl } = env;
  // One server per request; `activity.tool` is set per tool call for the activity log.
  const ctx: invoices.ServiceContext = { repo, deps, principal, activity: env.activity ? { ...env.activity, source: 'mcp' } : undefined };
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      'Midnight Invoice: create, read, update and delete invoices in the workspace that approved this agent. ' +
      'Amounts are numbers in the invoice currency; totals (subtotal, taxAmount, total) are computed by the server. ' +
      'To invoice a saved client, find it with list_clients and pass its id as clientId instead of typing its details. ' +
      'Only tools allowed by your scopes are listed.',
  });

  const tool = <S extends z.ZodObject>(
    name: string,
    scope: Scope,
    config: { title: string; description: string; inputSchema: S; annotations: Record<string, boolean> },
    run: (args: z.infer<S>) => Promise<CallToolResult>,
  ) => {
    if (!hasScope(principal, scope)) return; // hidden from tools/list, unknown on tools/call
    server.registerTool(
      name,
      {
        title: config.title,
        description: `${config.description} Requires scope ${scope}.`,
        inputSchema: config.inputSchema,
        annotations: { title: config.title, openWorldHint: false, ...config.annotations },
      },
      (async (args: z.infer<S>) => {
        try {
          requireScope(principal, scope);
          if (ctx.activity) ctx.activity.tool = name;
          return await run(args);
        } catch (error) {
          return toolError(error, deps);
        }
      }) as never,
    );
  };

  tool(
    'list_invoices',
    'invoices:read',
    {
      title: 'List invoices',
      description:
        'List invoices in the workspace, oldest change first, with computed totals, status and overdue days. Soft-deleted invoices are excluded unless include_deleted is true. ' +
        'Filter with status (e.g. ["overdue"] for unpaid invoices past their due date, ["sent","overdue"] for everything unpaid), due_before, due_after and client.',
      inputSchema: listInput,
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      json(
        await invoices.listInvoices(ctx, {
          updatedSince: args.updated_since,
          includeDeleted: args.include_deleted,
          limit: args.limit,
          filters: invoices.listFiltersOf(args),
        }),
      ),
  );

  tool(
    'get_invoice',
    'invoices:read',
    { title: 'Get invoice', description: 'Get one invoice by id, including line items and computed totals.', inputSchema: idInput, annotations: { readOnlyHint: true } },
    async ({ id }) => json({ invoice: await invoices.getInvoice(ctx, id) }),
  );

  tool(
    'create_invoice',
    'invoices:write',
    {
      title: 'Create invoice',
      description:
        'Create an invoice. Only lineItems and the client are required: pass clientId of a saved client (look it up with list_clients first; do not invent an address) or toName. ' +
        'Sender fields, currency, tax rate and payment details default to the client’s defaults and then the workspace settings, issueDate to today, and the invoice number is allocated automatically when omitted.',
      inputSchema: createInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => json({ invoice: await invoices.createInvoice(ctx, args) }),
  );

  tool(
    'update_invoice',
    'invoices:write',
    {
      title: 'Update invoice',
      description:
        'Update some fields of an invoice; fields you omit are kept. lineItems, if given, replaces the whole list. Setting clientId to another saved client (look it up first) also refills toName/toAddress/toEmail you omit. Pass expected_revision to avoid overwriting concurrent changes.',
      inputSchema: updateInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, expected_revision, ...patch }) =>
      json({ invoice: await invoices.patchInvoice(ctx, id, patch, { ifMatch: expected_revision }) }),
  );

  tool(
    'delete_invoice',
    'invoices:delete',
    {
      title: 'Delete invoice',
      description: 'Delete an invoice (soft delete: it disappears from the app and listings). Deleting an already deleted invoice succeeds.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      await invoices.deleteInvoice(ctx, id, {});
      return json({ deleted: true, id });
    },
  );

  tool(
    'get_next_invoice_number',
    'invoices:read',
    {
      title: 'Next invoice number',
      description: 'Return the next sequential invoice number (e.g. INV-0007), as the app would suggest it.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => json({ invoiceNumber: await invoices.nextInvoiceNumber(ctx) }),
  );

  tool(
    'get_settings',
    'settings:read',
    {
      title: 'Get default settings',
      description: 'Return the workspace default sender settings (name, email, address, payment details, notes, tax rate, currency) used to prefill new invoices.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => json(await invoices.getSettings(ctx)),
  );

  tool(
    'get_invoice_pdf',
    'invoices:read',
    {
      title: 'Get invoice PDF',
      description:
        'Render an invoice as PDF, styled like the app’s invoice preview. Returns the PDF as an embedded base64 resource plus the REST URL (GET with the same Bearer key) to download it.',
      inputSchema: idInput.extend({
        theme: z
          .enum(INVOICE_THEMES)
          .optional()
          .describe(`Colour theme of the PDF, as in the app's light/dark preview. Default: ${DEFAULT_INVOICE_THEME}.`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, theme }) => {
      const { invoice, bytes } = await downloadInvoicePdf(ctx, id, theme ?? DEFAULT_INVOICE_THEME);
      const url = `${baseUrl}${API_BASE_PATH}/invoices/${invoice.id}/pdf${theme ? `?theme=${theme}` : ''}`;
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        content: [
          {
            type: 'text',
            text: `PDF for ${invoice.invoiceNumber} (${bytes.length} bytes, ${pdfFilename(invoice.invoiceNumber)}). Download URL (requires the same Authorization header): ${url}`,
          },
          { type: 'resource', resource: { uri: url, mimeType: 'application/pdf', blob: btoa(binary) } },
        ],
      };
    },
  );

  registerClientTools(tool, ctx);
  registerStatusTools(tool, ctx);
  registerActivityTools(tool, ctx);

  return server;
}

export function createMcpEndpoint(deps: AppDeps, repo: Repository) {
  const onerror = (error: Error) => deps.logError?.('MCP transport error', error);
  const envOf = (authInfo: AuthInfo | undefined): McpRequestEnv => {
    const env = authInfo?.extra?.mcpEnv as McpRequestEnv | undefined;
    if (!env) throw new Error('MCP request reached the SDK without an authenticated principal');
    return env;
  };
  // 2026-07-28 ("modern") requests: the SDK's per-request handler, JSON responses only.
  const modern = createMcpHandler((reqCtx) => buildServer(deps, repo, envOf(reqCtx.authInfo)), {
    legacy: 'reject',
    responseMode: 'json',
    maxRequestBodySize: LIMITS.invoiceBodyBytes,
    onerror,
  });

  return async (request: Request, principal: Principal, baseUrl: string, activity?: ActivityRequest): Promise<Response> => {
    const authInfo: AuthInfo = {
      token: 'redacted',
      clientId: principal.type === 'agent' ? principal.agentId : `workspace:${principal.workspaceId}`,
      scopes: [...principal.scopes],
      extra: { mcpEnv: { principal, baseUrl, activity } satisfies McpRequestEnv },
    };
    if (!isJsonContentType(request.headers.get('content-type'))) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Content-Type must be application/json' } },
        { status: 415 },
      );
    }
    if (await isLegacyRequest(request, undefined, { maxRequestBodySize: LIMITS.invoiceBodyBytes })) {
      // 2025-era clients (initialize handshake): a fresh stateless server +
      // transport per request, answering with plain JSON instead of SSE (the
      // SDK's built-in legacy fallback always streams).
      const server = buildServer(deps, repo, envOf(authInfo));
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: LIMITS.invoiceBodyBytes,
      });
      transport.onerror = onerror;
      await server.connect(transport);
      try {
        return await transport.handleRequest(request, { authInfo });
      } finally {
        void server.close();
      }
    }
    return modern.fetch(request, { authInfo });
  };
}
