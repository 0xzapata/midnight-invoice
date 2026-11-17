/**
 * In-memory `/recurring` routes for jsdom tests, installed on a fake API with
 * `installFakeRecurring(fake)` (kept out of fakeApi.ts so the recurring
 * feature stays self-contained). Same calendar rules as the server
 * (shared/recurring.ts); run-now creates the invoice on the fake server with
 * `recurringId` and the `system` actor, so the next sync pulls it.
 */
import type { RecurringInput } from '../../shared/api';
import { addDays, describeSchedule, localDateIn, nextRunDate, type RecurringSchedule } from '../../shared/recurring';
import type { FakeApi, RecordedRequest } from './fakeApi';

export function installFakeRecurring(fake: FakeApi, opts: { today?: string } = {}) {
  const schedules = new Map<string, RecurringSchedule>();
  let seq = 0;
  const today = (tz: string) => opts.today ?? localDateIn(new Date(), tz);
  const withSummary = (s: RecurringSchedule): RecurringSchedule => ({ ...s, summary: describeSchedule(s, { nextRunDate: s.nextRunDate, status: s.status }) });

  const build = (id: string, input: RecurringInput, existing?: RecurringSchedule): RecurringSchedule => {
    const cfg = {
      name: input.name,
      templateId: input.templateId,
      clientId: input.clientId ?? null,
      frequency: input.frequency,
      startDate: input.startDate,
      timezone: input.timezone ?? 'UTC',
      endDate: input.endDate ?? null,
      maxOccurrences: input.maxOccurrences ?? null,
      autoAction: input.autoAction ?? 'draft',
      overrides: { notes: input.overrides?.notes ?? null, taxRate: input.overrides?.taxRate ?? null },
    };
    const next = nextRunDate(cfg, { onOrAfter: today(cfg.timezone), lastRunDate: existing?.lastRunDate, runCount: existing?.runCount ?? 0 });
    const at = new Date().toISOString();
    return withSummary({
      id,
      ...cfg,
      status: next === null ? 'ended' : existing?.status === 'paused' ? 'paused' : (input.status ?? 'active'),
      nextRunDate: next,
      lastRunDate: existing?.lastRunDate ?? null,
      lastInvoiceId: existing?.lastInvoiceId ?? null,
      runCount: existing?.runCount ?? 0,
      lastError: null,
      retryAt: null,
      skippedCount: existing?.skippedCount ?? 0,
      lastSkipped: existing?.lastSkipped ?? null,
      summary: '',
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      deletedAt: null,
      revision: (existing?.revision ?? 0) + 1,
      createdBy: existing?.createdBy ?? { type: 'user' },
      updatedBy: { type: 'user' },
    });
  };

  const invalidRefs = (input: RecurringInput) => {
    const t = fake.server.getTemplate(input.templateId);
    if (!t) return fake.apiError(400, 'validation_failed', 'Unknown template', [{ path: 'templateId', message: 'No template with this id exists in this workspace' }]);
    if (input.clientId && !fake.server.getClient(input.clientId)) return fake.apiError(400, 'validation_failed', 'Unknown client', [{ path: 'clientId', message: 'No client with this id exists in this workspace' }]);
    return undefined;
  };

  fake.use((req: RecordedRequest) => {
    const { method, path, body } = req;
    if (!path.startsWith('/recurring')) return undefined;
    if (req.headers.authorization !== `Bearer ${fake.state.token}`) return fake.apiError(401, 'unauthorized', 'Missing or invalid bearer token');
    if (path === '/recurring' && method === 'GET') return fake.json(200, { recurring: [...schedules.values()].filter((s) => !s.deletedAt) });
    if (path === '/recurring' && method === 'POST') {
      const input = body as RecurringInput;
      const invalid = invalidRefs(input);
      if (invalid) return invalid;
      const s = build(`00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, input);
      schedules.set(s.id, s);
      return fake.json(201, { recurring: s }, { etag: `"${s.revision}"` });
    }
    const m = /^\/recurring\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
    if (!m) return undefined;
    const existing = schedules.get(m[1]);
    if (!existing || existing.deletedAt) return fake.apiError(404, 'not_found', 'Recurring schedule not found');
    const action = m[2];
    const save = (s: RecurringSchedule) => {
      const next = withSummary({ ...s, updatedAt: new Date().toISOString() });
      schedules.set(next.id, next);
      return fake.json(200, { recurring: next }, { etag: `"${next.revision}"` });
    };
    if (!action && method === 'PATCH') {
      const input = { ...existing, ...(body as Partial<RecurringInput>), overrides: { ...existing.overrides, ...(body as Partial<RecurringInput>).overrides } } as RecurringInput;
      const invalid = invalidRefs(input);
      if (invalid) return invalid;
      return save(build(existing.id, input, existing));
    }
    if (!action && method === 'DELETE') {
      schedules.set(existing.id, { ...existing, deletedAt: new Date().toISOString() });
      return new Response(null, { status: 204 });
    }
    if (action === 'pause' && method === 'POST') return save({ ...existing, status: 'paused', revision: existing.revision + 1 });
    if (action === 'resume' && method === 'POST') return save({ ...existing, status: 'active', revision: existing.revision + 1 });
    if (action === 'run-now' && method === 'POST') {
      const period = existing.nextRunDate!;
      const template = fake.server.getTemplate(existing.templateId)!;
      const invoiceId = `11111111-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      const invoice = fake.server.create(
        invoiceId,
        {
          toName: fake.server.getClient(existing.clientId ?? template.clientId ?? '')?.name ?? 'Client',
          issueDate: period,
          lineItems: template.lineItems.map(({ description, quantity, price }) => ({ description, quantity, price })),
          templateId: template.id,
          recurringId: existing.id,
        },
        { type: 'system', recurringId: existing.id, recurringName: existing.name },
      );
      const next = nextRunDate(existing, { onOrAfter: addDays(period, 1), lastRunDate: period, runCount: existing.runCount + 1 });
      const updated = withSummary({ ...existing, nextRunDate: next, status: next ? existing.status : 'ended', lastRunDate: period, lastInvoiceId: invoiceId, runCount: existing.runCount + 1 });
      schedules.set(existing.id, updated);
      return fake.json(201, { period, generated: true, invoice, recurring: updated });
    }
    if (action === 'preview' && method === 'GET') {
      return fake.json(200, { recurring: existing, upcoming: existing.nextRunDate ? [existing.nextRunDate] : [], nextInvoice: null, placeholders: { unknown: [], unresolved: [] }, warnings: [], problem: null });
    }
    return undefined;
  });

  return {
    schedules,
    add(input: RecurringInput, extra: Partial<RecurringSchedule> = {}): RecurringSchedule {
      const s = withSummary({ ...build(`00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, input), ...extra });
      schedules.set(s.id, s);
      return s;
    },
  };
}
