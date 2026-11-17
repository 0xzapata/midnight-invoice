import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { activeClientsSorted, useClientStore } from '@/stores/useClientStore';
import { activeTemplatesSorted, useTemplateStore } from '@/stores/useTemplateStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { formatCurrency } from '@/lib/invoice-utils';
import { cn } from '@/lib/utils';
import { addDaysIso } from '../../shared/types/client';
import { invoiceFieldsFromTemplate } from '../../shared/types/template';
import {
  AUTO_ACTION_LABELS,
  describeSchedule,
  formatRunDate,
  FREQUENCY_LABELS,
  isValidIsoDate,
  isValidTimeZone,
  localDateIn,
  nextRunDate,
  RECURRING_FREQUENCIES,
  RECURRING_LIMITS,
  upcomingRunDates,
  type RecurringAutoAction,
  type RecurringFrequency,
  type RecurringSchedule,
} from '../../shared/recurring';
import type { RecurringInput } from '../../shared/api';

export interface RecurringPrefill {
  templateId?: string;
  clientId?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this schedule; omitted = new schedule. */
  schedule?: RecurringSchedule;
  prefill?: RecurringPrefill;
  /** Resolves with null when saved, or with a message to show. */
  onSave: (input: RecurringInput) => Promise<string | null>;
}

type EndMode = 'never' | 'date' | 'count';

interface Draft {
  name: string;
  templateId: string;
  /** "" = the template's default client. */
  clientId: string;
  frequency: RecurringFrequency;
  startDate: string;
  timezone: string;
  endMode: EndMode;
  endDate: string;
  maxOccurrences: string;
  autoAction: RecurringAutoAction;
  notes: string;
  taxRate: string;
}

function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

function supportedTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

function timeZones(current: string): string[] {
  const set = new Set(['UTC', ...supportedTimeZones()]);
  set.add(current);
  return [...set];
}

/** The 1st of next month in `tz` (a sensible default start for monthly billing). */
function firstOfNextMonth(tz: string): string {
  const today = localDateIn(new Date(), tz);
  const [y, m] = today.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function toDraft(s: RecurringSchedule | undefined, prefill: RecurringPrefill | undefined, templateName: (id: string) => string | undefined): Draft {
  if (s) {
    return {
      name: s.name,
      templateId: s.templateId,
      clientId: s.clientId ?? '',
      frequency: s.frequency,
      startDate: s.startDate,
      timezone: s.timezone,
      endMode: s.endDate ? 'date' : s.maxOccurrences != null ? 'count' : 'never',
      endDate: s.endDate ?? '',
      maxOccurrences: s.maxOccurrences != null ? String(s.maxOccurrences) : '12',
      autoAction: s.autoAction,
      notes: s.overrides.notes ?? '',
      taxRate: s.overrides.taxRate != null ? String(s.overrides.taxRate) : '',
    };
  }
  const tz = browserTimeZone();
  const templateId = prefill?.templateId ?? '';
  const name = templateId ? templateName(templateId) : undefined;
  return {
    name: name ? `${name} – monthly` : '',
    templateId,
    clientId: prefill?.clientId ?? '',
    frequency: 'monthly',
    startDate: firstOfNextMonth(tz),
    timezone: tz,
    endMode: 'never',
    endDate: '',
    maxOccurrences: '12',
    autoAction: 'draft',
    notes: '',
    taxRate: '',
  };
}

type Errors = Partial<Record<'name' | 'templateId' | 'startDate' | 'endDate' | 'maxOccurrences' | 'taxRate' | 'timezone', string>>;

function validate(d: Draft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = 'Give the schedule a name';
  if (!d.templateId) e.templateId = 'Pick the template the invoices are made from';
  if (!isValidIsoDate(d.startDate)) e.startDate = 'Pick a start date';
  if (!isValidTimeZone(d.timezone)) e.timezone = 'Pick a time zone';
  if (d.endMode === 'date') {
    if (!isValidIsoDate(d.endDate)) e.endDate = 'Pick an end date';
    else if (isValidIsoDate(d.startDate) && d.endDate < d.startDate) e.endDate = 'The end date must be on or after the start date';
  }
  if (d.endMode === 'count') {
    const n = Number(d.maxOccurrences);
    if (!Number.isInteger(n) || n < 1 || n > RECURRING_LIMITS.maxOccurrences) e.maxOccurrences = `Enter a number from 1 to ${RECURRING_LIMITS.maxOccurrences}`;
  }
  if (d.taxRate.trim() !== '') {
    const t = Number(d.taxRate);
    if (!Number.isFinite(t) || t < 0 || t > 100) e.taxRate = 'Enter a tax rate from 0 to 100';
  }
  return e;
}

function toInput(d: Draft): RecurringInput {
  return {
    name: d.name.trim(),
    templateId: d.templateId,
    clientId: d.clientId || null,
    frequency: d.frequency,
    startDate: d.startDate,
    timezone: d.timezone,
    endDate: d.endMode === 'date' ? d.endDate : null,
    maxOccurrences: d.endMode === 'count' ? Number(d.maxOccurrences) : null,
    autoAction: d.autoAction,
    overrides: { notes: d.notes.trim() ? d.notes : null, taxRate: d.taxRate.trim() === '' ? null : Number(d.taxRate) },
  };
}

/** Create or edit a recurring schedule. Renders nothing while closed (remounts with fresh values on open). */
export function RecurringFormDialog({ open, onOpenChange, schedule, prefill, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full sm:max-w-3xl">
          <RecurringForm schedule={schedule} prefill={prefill} onCancel={() => onOpenChange(false)} onSave={onSave} />
        </DialogContent>
      )}
    </Dialog>
  );
}

const control =
  'flex h-10 w-full rounded-md border border-border bg-secondary px-3 py-1 text-sm text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';
const label = 'text-xs text-muted-foreground';

function RecurringForm({ schedule, prefill, onCancel, onSave }: Omit<Props, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const templates = useTemplateStore((s) => s.templates);
  const clients = useClientStore((s) => s.clients);
  const settings = useSettingsStore((s) => s.settings);
  const [draft, setDraft] = useState<Draft>(() => toDraft(schedule, prefill, (id) => templates.find((t) => t.id === id)?.name));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const id = useId();
  const errors = validate(draft);
  const shown: Errors = submitted ? errors : {};
  const set = <K extends keyof Draft>(key: K) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value as Draft[K] }));
  const zones = useMemo(() => timeZones(draft.timezone), [draft.timezone]);

  const pickableTemplates = activeTemplatesSorted(templates);
  const template = templates.find((t) => t.id === draft.templateId);
  const templateClient = template?.clientId ? clients.find((c) => c.id === template.clientId) : undefined;
  const pickableClients = activeClientsSorted(clients);
  const client = draft.clientId ? clients.find((c) => c.id === draft.clientId) : templateClient;

  // Live plain-language summary and upcoming dates (same calendar rules as the server).
  const input = toInput(draft);
  const valid = !errors.startDate && !errors.endDate && !errors.maxOccurrences && !errors.timezone;
  const today = isValidTimeZone(draft.timezone) ? localDateIn(new Date(), draft.timezone) : null;
  const runCount = schedule?.runCount ?? 0;
  const next = valid && today ? nextRunDate({ ...input, endDate: input.endDate ?? null, maxOccurrences: input.maxOccurrences ?? null }, { onOrAfter: today, lastRunDate: schedule?.lastRunDate, runCount }) : null;
  const cadence = { frequency: draft.frequency, startDate: draft.startDate, endDate: input.endDate ?? null, maxOccurrences: input.maxOccurrences ?? null };
  const summary = valid ? describeSchedule(cadence, { nextRunDate: next }) : null;
  const upcoming = valid && next ? upcomingRunDates(cadence, next, 6, runCount) : [];

  const err = (key: keyof Errors) =>
    shown[key] ? (
      <p id={`${id}-${key}-error`} className="text-xs text-destructive">
        {shown[key]}
      </p>
    ) : null;
  const aria = (key: keyof Errors) => ({ id: `${id}-${key}`, 'aria-invalid': !!shown[key] || undefined, 'aria-describedby': shown[key] ? `${id}-${key}-error` : undefined });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setServerError(null);
    const problem = await onSave(input);
    setSaving(false);
    if (problem) setServerError(problem);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <DialogHeader>
        <DialogTitle>{schedule ? `Edit “${schedule.name}”` : 'New recurring invoice'}</DialogTitle>
        <DialogDescription>
          The server creates an invoice from the template on every run date, even when this browser is closed. Invoices are independent copies: changing the schedule never
          changes invoices already created.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`} className={label}>
            Schedule name
          </Label>
          <Input {...aria('name')} value={draft.name} onChange={set('name')} maxLength={RECURRING_LIMITS.name} placeholder="e.g. Globex retainer" className="bg-secondary border-border" autoFocus />
          {err('name')}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-templateId`} className={label}>
            Template
          </Label>
          <select {...aria('templateId')} value={draft.templateId} onChange={set('templateId')} className={control}>
            <option value="">Choose a template…</option>
            {pickableTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {template && !pickableTemplates.includes(template) && <option value={template.id}>{template.name} (archived)</option>}
            {draft.templateId && !template && <option value={draft.templateId}>Template not in this browser</option>}
          </select>
          {err('templateId')}
          {pickableTemplates.length === 0 && <p className="text-xs text-muted-foreground">No templates yet: add one on the Templates page first.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-client`} className={label}>
            Bill to
          </Label>
          <select id={`${id}-client`} value={draft.clientId} onChange={set('clientId')} className={control}>
            <option value="">{templateClient ? `The template’s client (${templateClient.name})` : 'The template’s client (none set)'}</option>
            {pickableClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-frequency`} className={label}>
            How often
          </Label>
          <select id={`${id}-frequency`} value={draft.frequency} onChange={set('frequency')} className={control}>
            {RECURRING_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-startDate`} className={label}>
            First invoice on
          </Label>
          <Input {...aria('startDate')} type="date" value={draft.startDate} onChange={set('startDate')} className="bg-secondary border-border" />
          {err('startDate')}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-timezone`} className={label}>
            Time zone
          </Label>
          <select {...aria('timezone')} value={draft.timezone} onChange={set('timezone')} className={control}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {err('timezone')}
        </div>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className={cn(label, 'mb-2')}>Ends</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
            <Radio name={`${id}-end`} checked={draft.endMode === 'never'} onChange={() => setDraft((d) => ({ ...d, endMode: 'never' }))}>
              Never
            </Radio>
            <div className="flex flex-wrap items-center gap-2">
              <Radio name={`${id}-end`} checked={draft.endMode === 'date'} onChange={() => setDraft((d) => ({ ...d, endMode: 'date' }))}>
                On
              </Radio>
              <Input
                {...aria('endDate')}
                aria-label="End date"
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value, endMode: 'date' }))}
                className="h-9 w-40 bg-secondary border-border"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Radio name={`${id}-end`} checked={draft.endMode === 'count'} onChange={() => setDraft((d) => ({ ...d, endMode: 'count' }))}>
                After
              </Radio>
              <Input
                {...aria('maxOccurrences')}
                aria-label="Number of invoices"
                type="number"
                min={1}
                max={RECURRING_LIMITS.maxOccurrences}
                value={draft.maxOccurrences}
                onChange={(e) => setDraft((d) => ({ ...d, maxOccurrences: e.target.value, endMode: 'count' }))}
                className="h-9 w-20 bg-secondary border-border"
              />
              <span className="text-sm text-foreground">invoices</span>
            </div>
          </div>
          {err('endDate')}
          {err('maxOccurrences')}
        </fieldset>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className={cn(label, 'mb-2')}>When an invoice is created</legend>
          <div className="flex flex-col gap-2">
            {(['draft', 'mark_sent'] as const).map((a) => (
              <Radio key={a} name={`${id}-action`} checked={draft.autoAction === a} onChange={() => setDraft((d) => ({ ...d, autoAction: a }))}>
                {AUTO_ACTION_LABELS[a]}
                {a === 'draft' && <span className="text-muted-foreground"> (recommended)</span>}
              </Radio>
            ))}
            {draft.autoAction === 'send_email' ? (
              <Radio name={`${id}-action`} checked onChange={() => undefined}>
                {AUTO_ACTION_LABELS.send_email}
              </Radio>
            ) : (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Emailing invoices automatically will be available once email sending is set up. Only you can turn it on; agents never can.
              </p>
            )}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor={`${id}-taxRate`} className={label}>
            Tax rate override (%)
          </Label>
          <Input {...aria('taxRate')} type="number" min={0} max={100} step="0.01" value={draft.taxRate} onChange={set('taxRate')} placeholder="Empty: the template’s" className="bg-secondary border-border" />
          {err('taxRate')}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-notes`} className={label}>
            Notes override (optional, placeholders such as {'{{month_name}}'} work)
          </Label>
          <Textarea id={`${id}-notes`} value={draft.notes} onChange={set('notes')} maxLength={RECURRING_LIMITS.notes} rows={2} placeholder="Empty: the template’s notes" className="bg-secondary border-border resize-none text-sm" />
        </div>
      </div>

      <section aria-label="Schedule preview" className="space-y-3 rounded-lg border border-border bg-background/40 p-3 sm:p-4">
        <p className="flex items-start gap-2 text-sm font-medium text-foreground" role="status" aria-live="polite" data-testid="recurring-summary">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{summary ?? 'Fill in the dates to see when invoices are created.'}</span>
        </p>
        {upcoming.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Upcoming invoices ({draft.timezone.replace(/_/g, ' ')})</p>
            <ol className="flex flex-wrap gap-1.5" aria-label="Upcoming run dates">
              {upcoming.map((d) => (
                <li key={d} className="border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
                  {formatRunDate(d)}
                </li>
              ))}
            </ol>
          </div>
        )}
        {template && upcoming[0] && <NextInvoicePreview date={upcoming[0]} draft={draft} settingsCurrency={settings.currency} settingsTaxRate={settings.taxRate} clientName={client?.name ?? null} />}
      </section>

      {serverError && (
        <p role="alert" className="border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : schedule ? 'Save changes' : 'Create schedule'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-primary" />
      <span>{children}</span>
    </label>
  );
}

/** The next invoice as it would be generated (computed locally from the synced template and client). */
function NextInvoicePreview({
  date,
  draft,
  clientName,
  settingsCurrency,
  settingsTaxRate,
}: {
  date: string;
  draft: Draft;
  clientName: string | null;
  settingsCurrency: string;
  settingsTaxRate: number;
}) {
  const template = useTemplateStore((s) => s.templates.find((t) => t.id === draft.templateId));
  const client = useClientStore((s) => {
    const id = draft.clientId || template?.clientId;
    return id ? s.clients.find((c) => c.id === id) : undefined;
  });
  if (!template) return null;
  const notes = draft.notes.trim() ? draft.notes : template.notes;
  const app = invoiceFieldsFromTemplate({ ...template, clientId: null, notes }, { issueDate: date, clientName }, () => crypto.randomUUID());
  const currency = template.currency ?? client?.defaultCurrency ?? settingsCurrency;
  const override = draft.taxRate.trim() === '' ? null : Number(draft.taxRate);
  const taxRate = override ?? template.taxRate ?? client?.defaultTaxRate ?? settingsTaxRate;
  const subtotal = app.fields.lineItems.reduce((s, l) => s + l.quantity * l.price, 0);
  const due = app.fields.dueDate ?? (client?.paymentTermsDays != null ? addDaysIso(date, client.paymentTermsDays) : null);
  return (
    <div className="border-t border-border pt-3" aria-label="Next invoice preview">
      <p className="mb-2 text-xs text-muted-foreground">Next invoice, as it will be created</p>
      <div className="space-y-1 text-sm">
        <p className="font-medium text-foreground break-words">{app.fields.invoiceName || template.name}</p>
        <p className="text-xs text-muted-foreground">
          Dated {formatRunDate(date)}
          {due ? ` · due ${formatRunDate(due)}` : ''} · bill to {clientName ?? 'nobody yet (pick a client)'}
        </p>
        <ul className="space-y-0.5 text-xs text-foreground">
          {app.fields.lineItems.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(l.quantity * l.price, currency)}</span>
            </li>
          ))}
        </ul>
        <p className="flex justify-between gap-3 border-t border-border pt-1 text-xs font-medium text-foreground">
          <span>Total{taxRate ? ` incl. ${taxRate}% tax` : ''}</span>
          <span className="tabular-nums text-primary">{formatCurrency(subtotal * (1 + taxRate / 100), currency)}</span>
        </p>
        {(app.unknown.length > 0 || app.unresolved.length > 0) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Placeholders left as typed: {[...app.unknown, ...app.unresolved].map((n) => `{{${n}}}`).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
