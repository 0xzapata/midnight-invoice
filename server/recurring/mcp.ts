/**
 * MCP tools for recurring invoices, registered by server/mcp.ts through its
 * scope-gated `tool` helper (hidden unless the credential has the scope; the
 * extra scopes a write needs are checked by the service).
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { RECURRING_LIMITS } from '../../shared/recurring';
import type { ToolRegistrar } from '../mcpClients';
import { isoDate } from '../schemas';
import type { ServiceContext } from '../services/invoices';
import { RECURRING_FIELDS } from './schemas';
import * as recurring from './service';

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

const CONFIRM =
  'Before calling, confirm with the user in plain words: the cadence (e.g. "every month on the 1st"), the start date, the time zone the dates are counted in, ' +
  'when it ends, and that each invoice will be created automatically.';

const DOCS: Record<string, string> = {
  name: 'Name the user will recognise, e.g. "Globex retainer".',
  templateId: 'Template every invoice is generated from (id from list_templates; create the template first with create_template if needed).',
  clientId: 'Saved client to bill instead of the template’s default client (id from list_clients; requires clients:read), or null to use the template’s.',
  frequency: 'weekly, biweekly (every 2 weeks), monthly, quarterly (every 3 months) or yearly.',
  startDate:
    'First run date, YYYY-MM-DD, also the anchor: weekly schedules run on its weekday, monthly/quarterly/yearly ones on its day of the month (the 31st → the last day of shorter months; 29 Feb → 28 Feb in other years). ' +
    'Today or later; an invoice is generated on each run date and dated with it.',
  timezone: 'IANA time zone the run dates are counted in, e.g. "Europe/Berlin" (default UTC). Ask the user; generation happens shortly after local midnight there.',
  endDate: 'Last possible run date (inclusive), YYYY-MM-DD, or null for no end date.',
  maxOccurrences: `Stop after this many invoices (1-${RECURRING_LIMITS.maxOccurrences}), or null for no limit.`,
  autoAction:
    'What happens to each generated invoice: "draft" (default; the user reviews and sends it) or "mark_sent" (marked sent on its run date). "send_email" can only be chosen by the user in the app, never by an agent.',
  overrides: 'Optional values that win over the template: notes (may use placeholders such as {{month_name}}) and taxRate (percent); null = the template’s.',
};

const describe = <T extends z.ZodRawShape>(shape: T): T =>
  Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, DOCS[k] ? (s as z.ZodType).describe(DOCS[k]) : s])) as T;

const idInput = z.object({ id: z.string().describe('Recurring schedule id (UUID, from list_recurring).') });
const revision = z.number().int().optional().describe('Optional optimistic-concurrency check: fail if the schedule changed since you read it (its revision).');

const createShape = describe({
  name: RECURRING_FIELDS.name,
  templateId: RECURRING_FIELDS.templateId,
  clientId: RECURRING_FIELDS.clientId.optional(),
  frequency: RECURRING_FIELDS.frequency,
  startDate: RECURRING_FIELDS.startDate,
  timezone: RECURRING_FIELDS.timezone.optional(),
  endDate: RECURRING_FIELDS.endDate.optional(),
  maxOccurrences: RECURRING_FIELDS.maxOccurrences.optional(),
  autoAction: RECURRING_FIELDS.autoAction.optional(),
  overrides: RECURRING_FIELDS.overrides.optional(),
});

export function registerRecurringTools(tool: ToolRegistrar, ctx: ServiceContext): void {
  tool(
    'list_recurring',
    'recurring:read',
    {
      title: 'List recurring invoice schedules',
      description:
        'List the user’s recurring invoice schedules (e.g. "monthly retainer for Globex on the 1st") with their cadence summary, status (active, paused, ended), next run date, last result and any error. ' +
        'Call this before creating a schedule so you do not create a duplicate. Generated invoices are listed by list_invoices with recurring_id.',
      inputSchema: z.object({
        status: z.array(z.enum(['active', 'paused', 'ended'])).min(1).optional().describe('Only schedules with these statuses.'),
        template_id: RECURRING_FIELDS.templateId.optional().describe('Only schedules using this template.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, template_id }) => json(await recurring.listRecurring(ctx, { status, templateId: template_id })),
  );

  tool(
    'get_recurring',
    'recurring:read',
    { title: 'Get recurring schedule', description: 'Get one recurring invoice schedule by id.', inputSchema: idInput, annotations: { readOnlyHint: true } },
    async ({ id }) => json({ recurring: await recurring.getRecurring(ctx, id) }),
  );

  tool(
    'preview_recurring',
    'recurring:read',
    {
      title: 'Preview recurring schedule',
      description:
        'Show the next run dates of a schedule and its next invoice as it would be generated (placeholders resolved for that run date, totals computed), plus any problem that would stop it. ' +
        'Use it to show the user what will happen. Also requires templates:read.',
      inputSchema: idInput.extend({ count: z.number().int().min(1).max(RECURRING_LIMITS.previewMax).optional().describe('How many upcoming dates (default 6).') }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, count }) => json(await recurring.previewRecurring(ctx, id, count ?? 6)),
  );

  tool(
    'create_recurring',
    'recurring:write',
    {
      title: 'Create recurring invoice schedule',
      description:
        `Set up a schedule that generates an invoice from a template automatically every period (as drafts unless autoAction is "mark_sent"). ${CONFIRM} ` +
        'Find the template with list_templates (and the client with list_clients). Then show the user the result’s summary and nextRunDate, or preview_recurring. ' +
        'Also requires invoices:write and templates:read (plus clients:read with clientId).',
      inputSchema: z.object(createShape),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => json({ recurring: await recurring.createRecurring(ctx, args) }),
  );

  tool(
    'update_recurring',
    'recurring:write',
    {
      title: 'Update recurring schedule',
      description:
        `Change some fields of a recurring schedule; omitted fields are kept. Changing frequency, startDate or timezone recomputes the next run date from today. ${CONFIRM} ` +
        'Invoices already generated never change. Also requires invoices:write and templates:read (plus clients:read with clientId).',
      inputSchema: z.object({ id: z.string().describe('Recurring schedule id (UUID).'), expected_revision: revision, ...describe(createShape) }).partial({
        name: true,
        templateId: true,
        frequency: true,
        startDate: true,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, expected_revision, ...patch }) => json({ recurring: await recurring.patchRecurring(ctx, id, patch, { ifMatch: expected_revision }) }),
  );

  tool(
    'pause_recurring',
    'recurring:write',
    {
      title: 'Pause recurring schedule',
      description: 'Pause a schedule: no invoices are generated until it is resumed. Pausing a paused schedule succeeds.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => json({ recurring: await recurring.pauseRecurring(ctx, id) }),
  );

  tool(
    'resume_recurring',
    'recurring:write',
    {
      title: 'Resume recurring schedule',
      description:
        'Resume a paused schedule. Periods missed while paused are skipped, except the most recent one, which is generated next (tell the user which date that is). ' +
        'Also requires invoices:write and templates:read.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => json({ recurring: await recurring.resumeRecurring(ctx, id) }),
  );

  tool(
    'run_recurring_now',
    'recurring:write',
    {
      title: 'Generate next recurring invoice now',
      description:
        'Generate the schedule’s next invoice now instead of waiting for its run date (the invoice is dated with that run date). Pass period = the schedule’s nextRunDate: ' +
        'retrying with the same period returns the invoice already generated instead of generating the following one. Ask the user first. Also requires invoices:write and templates:read.',
      inputSchema: idInput.extend({ period: isoDate.optional().describe('The run date to generate (the schedule’s nextRunDate), YYYY-MM-DD.') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, period }) => json(await recurring.runRecurringNow(ctx, id, period ? { period } : {})),
  );

  tool(
    'delete_recurring',
    'recurring:write',
    {
      title: 'Delete recurring schedule',
      description: 'Delete a recurring schedule: no more invoices are generated. Invoices it already generated are kept. Prefer pause_recurring if the user may want it again. Deleting twice succeeds.',
      inputSchema: idInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      await recurring.deleteRecurring(ctx, id, {});
      return json({ deleted: true, id });
    },
  );
}
