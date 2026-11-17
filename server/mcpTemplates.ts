/**
 * MCP tools for invoice templates, registered by server/mcp.ts through its
 * scope-gated `tool` helper (hidden unless the credential has the scope).
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TEMPLATE_PLACEHOLDERS } from '../shared/template-placeholders';
import { TEMPLATE_LIMITS } from '../shared/types/template';
import { hasScope } from './auth';
import type { ToolRegistrar } from './mcpClients';
import { LIMITS } from './schemas';
import * as templates from './services/templates';
import type { ServiceContext } from './services/invoices';
import { instantiateTemplateSchema, templateInputSchema, templatePatchSchema } from './templateSchemas';

const PLACEHOLDER_LIST = TEMPLATE_PLACEHOLDERS.map((p) => `{{${p.name}}}`).join(', ');

const TEMPLATE_FIELD_DOCS: Record<string, string> = {
  name: 'Template name the user will recognise, e.g. "Monthly retainer – Globex".',
  description: 'What the template is for (not printed on invoices).',
  clientId: 'Saved client new invoices are billed to by default (id from list_clients; requires clients:read), or null for none.',
  lineItems: `Line items (0-${TEMPLATE_LIMITS.maxLineItems}). Each: description (may use placeholders), quantity >= 0, unit price >= 0.`,
  taxRate: 'Tax rate in percent (0-100), or null to use the client default / workspace setting.',
  currency: 'ISO 4217 code, or null to use the client default / workspace setting.',
  notes: 'Notes printed on invoices; may use placeholders. "" = none.',
  paymentDetails: 'Payment instructions; "" = workspace setting.',
  paymentTermsDays: 'Invoices are due this many days after their issue date, or null for the client terms / no due date.',
  invoiceNamePattern: `Invoice name; may use placeholders, e.g. "Retainer {{month_name}} {{year}}". Supported placeholders: ${PLACEHOLDER_LIST}.`,
  archivedAt: 'ISO timestamp to archive (hidden from the app’s template pickers), null to unarchive.',
};

const INSTANTIATE_FIELD_DOCS: Record<string, string> = {
  issueDate: 'Issue date, YYYY-MM-DD (default today, UTC). Placeholders such as {{month_name}} are resolved against it.',
  clientId: 'Bill this saved client instead of the template’s default client; null for no saved client.',
  lineItems: 'Replaces ALL of the template’s line items (used as given, no placeholders). Omit to use the template’s lines.',
  invoiceNumber: 'Omit to allocate the next number.',
  dueDate: 'YYYY-MM-DD or "". Omit to use issue date + the template’s payment terms.',
};

function describe<T extends z.ZodRawShape>(shape: T, docs: Record<string, string>): T {
  return Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, docs[k] ? (s as z.ZodType).describe(docs[k]) : s])) as T;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

const idInput = z.object({ id: z.string().describe('Template id (UUID, from list_templates).') });

export function registerTemplateTools(tool: ToolRegistrar, ctx: ServiceContext): void {
  tool(
    'list_templates',
    'templates:read',
    {
      title: 'List invoice templates',
      description:
        'List the user’s saved invoice templates (reusable blueprints with line items, terms and an optional default client), optionally searching by name or description. ' +
        'When the user refers to a template or a recurring kind of invoice ("the usual retainer", "my monthly Globex invoice"), call this first and then create_invoice_from_template ' +
        'instead of building the invoice by hand. Archived templates are included with archivedAt set.',
      inputSchema: z.object({
        query: z.string().max(TEMPLATE_LIMITS.name).optional().describe('Search text matched against template name and description, e.g. "retainer".'),
        limit: z.number().int().min(1).max(LIMITS.listMax).optional().describe(`Max results (default ${LIMITS.listMax}).`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const res = await templates.listTemplates(ctx, { q: query, limit });
      return json({ templates: res.templates, hasMore: res.hasMore });
    },
  );

  tool(
    'get_template',
    'templates:read',
    { title: 'Get invoice template', description: 'Get one invoice template by id.', inputSchema: idInput, annotations: { readOnlyHint: true } },
    async ({ id }) => json({ template: await templates.getTemplate(ctx, id) }),
  );

  tool(
    'create_template',
    'templates:write',
    {
      title: 'Create invoice template',
      description:
        `Save a new reusable invoice template. Only name is required. Check list_templates first so you do not create a duplicate. Text fields may use placeholders (${PLACEHOLDER_LIST}), resolved when an invoice is created from the template; unknown placeholders are left as typed.`,
      inputSchema: z.object(describe(templateInputSchema.omit({ createdAt: true, id: true }).shape, TEMPLATE_FIELD_DOCS)),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => json({ template: await templates.createTemplate(ctx, args) }),
  );

  tool(
    'update_template',
    'templates:write',
    {
      title: 'Update invoice template',
      description:
        'Update some fields of a template; omitted fields are kept, lineItems replaces the whole list. Invoices already created from it never change. Pass expected_revision to avoid overwriting concurrent changes.',
      inputSchema: z.object({
        id: z.string().describe('Template id (UUID).'),
        expected_revision: z.number().int().optional().describe('Optional optimistic-concurrency check: fail if the template changed since you read it.'),
        ...describe(templatePatchSchema.omit({ id: true }).shape, TEMPLATE_FIELD_DOCS),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, expected_revision, ...patch }) => json({ template: await templates.patchTemplate(ctx, id, patch, { ifMatch: expected_revision }) }),
  );

  tool(
    'delete_template',
    'templates:write',
    {
      title: 'Delete invoice template',
      description:
        'Delete an invoice template (soft delete). Invoices created from it are not affected. Prefer update_template with archivedAt to hide a template the user may need again. Deleting an already deleted template succeeds.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      await templates.deleteTemplate(ctx, id, {});
      return json({ deleted: true, id });
    },
  );

  // Needs both invoices:write (registered on it) and templates:read.
  if (hasScope(ctx.principal, 'templates:read')) {
    tool(
      'create_invoice_from_template',
      'invoices:write',
      {
        title: 'Create invoice from template',
        description:
          'Create a new draft invoice from a saved template (find it with list_templates). This is the preferred way to create an invoice whenever the user mentions a template or a recurring invoice. ' +
          'Values you pass win over the template, the template wins over the client’s defaults and the workspace settings; omit what the template already has. ' +
          'Placeholders in the template are resolved for the issue date; the result lists any unknown or unresolved ones and warnings to relay to the user. ' +
          'The invoice is an independent copy (later template edits do not change it). Also requires templates:read (and clients:read when billed to a saved client).',
        inputSchema: z.object({
          id: z.string().describe('Template id (UUID, from list_templates).'),
          ...describe(instantiateTemplateSchema.shape, INSTANTIATE_FIELD_DOCS),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async ({ id, ...overrides }) => json(await templates.instantiateTemplate(ctx, id, overrides)),
    );
  }
}
