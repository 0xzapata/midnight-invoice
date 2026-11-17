import { useId, useState, type FocusEvent, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Braces, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencySelector } from '@/components/ui/CurrencySelector';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { activeClientsSorted, useClientStore } from '@/stores/useClientStore';
import { formatCurrency } from '@/lib/invoice-utils';
import { localToday } from '../../../shared/invoice-status';
import { resolvePlaceholders, TEMPLATE_PLACEHOLDERS } from '../../../shared/template-placeholders';
import { TEMPLATE_LIMITS, type InvoiceTemplate, type TemplateFormData } from '../../../shared/types/template';

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this template; omitted = new template. */
  template?: InvoiceTemplate;
  /** Prefill for a new template (e.g. "Save as template" from an invoice). */
  initial?: TemplateFormData;
  onSave: (data: TemplateFormData) => void;
}

interface DraftLine {
  id: string;
  description: string;
  quantity: string;
  price: string;
}

interface Draft {
  name: string;
  description: string;
  clientId: string;
  lines: DraftLine[];
  currency: string;
  taxRate: string;
  paymentTermsDays: string;
  invoiceNamePattern: string;
  notes: string;
  paymentDetails: string;
}

type TextField = 'invoiceNamePattern' | 'notes' | `line:${string}`;

const newLine = (): DraftLine => ({ id: crypto.randomUUID(), description: '', quantity: '1', price: '' });

function toDraft(t?: Partial<TemplateFormData>): Draft {
  return {
    name: t?.name ?? '',
    description: t?.description ?? '',
    clientId: t?.clientId ?? '',
    lines: t?.lineItems?.length
      ? t.lineItems.map((li) => ({ id: li.id || crypto.randomUUID(), description: li.description, quantity: String(li.quantity), price: String(li.price) }))
      : [newLine()],
    currency: t?.currency ?? '',
    taxRate: t?.taxRate != null ? String(t.taxRate) : '',
    paymentTermsDays: t?.paymentTermsDays != null ? String(t.paymentTermsDays) : '',
    invoiceNamePattern: t?.invoiceNamePattern ?? '',
    notes: t?.notes ?? '',
    paymentDetails: t?.paymentDetails ?? '',
  };
}

type Errors = Partial<Record<'name' | 'taxRate' | 'paymentTermsDays' | 'lines', string>> & { lineErrors?: Record<string, string> };

function validate(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Template name is required';
  if (d.taxRate.trim()) {
    const n = Number(d.taxRate);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.taxRate = 'Tax rate must be between 0 and 100';
  }
  if (d.paymentTermsDays.trim()) {
    const n = Number(d.paymentTermsDays);
    if (!Number.isInteger(n) || n < 0 || n > TEMPLATE_LIMITS.maxPaymentTermsDays) errors.paymentTermsDays = `Whole days, 0–${TEMPLATE_LIMITS.maxPaymentTermsDays}`;
  }
  const lineErrors: Record<string, string> = {};
  for (const li of d.lines) {
    const blank = !li.description.trim() && !li.price.trim();
    if (blank) continue;
    if (!li.description.trim()) lineErrors[li.id] = 'Add a description';
    else if (!Number.isFinite(Number(li.quantity)) || Number(li.quantity) < 0) lineErrors[li.id] = 'Quantity must be 0 or more';
    else if (li.price.trim() && (!Number.isFinite(Number(li.price)) || Number(li.price) < 0)) lineErrors[li.id] = 'Price must be 0 or more';
  }
  if (Object.keys(lineErrors).length) errors.lineErrors = lineErrors;
  return errors;
}

const hasErrors = (e: Errors) => Object.keys(e).length > 0;

/** Add / edit an invoice template. Renders nothing while closed (the form remounts with fresh values on open). */
export function TemplateFormDialog({ open, onOpenChange, template, initial, onSave }: TemplateFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full sm:max-w-2xl">
          <TemplateForm template={template} initial={initial} onCancel={() => onOpenChange(false)} onSave={onSave} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TemplateForm({ template, initial, onCancel, onSave }: Omit<TemplateFormDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(template ?? initial));
  const [submitted, setSubmitted] = useState(false);
  // The text field placeholders are inserted into (the last one focused) and its element, for the cursor position.
  const [focused, setFocused] = useState<{ field: TextField; el: HTMLInputElement | HTMLTextAreaElement | null }>({ field: 'invoiceNamePattern', el: null });
  const clients = useClientStore((s) => s.clients);
  const pickable = activeClientsSorted(clients);
  const selectedClient = clients.find((c) => c.id === draft.clientId);
  const errors = validate(draft);
  const shown: Errors = submitted ? errors : {};
  const id = useId();
  const set = (key: Exclude<keyof Draft, 'lines'>) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const setLine = (lineId: string, key: keyof Omit<DraftLine, 'id'>, value: string) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((li) => (li.id === lineId ? { ...li, [key]: value } : li)) }));

  /** Inserts `{{name}}` at the cursor of the last focused text field (placeholder helper). */
  const insertPlaceholder = (name: string) => {
    const token = `{{${name}}}`;
    const { field: target, el } = focused;
    const current = target.startsWith('line:') ? (draft.lines.find((l) => `line:${l.id}` === target)?.description ?? '') : draft[target as 'notes' | 'invoiceNamePattern'];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    // Render the new value first, then put the cursor right after the inserted placeholder.
    flushSync(() => {
      if (target.startsWith('line:')) setLine(target.slice(5), 'description', next);
      else setDraft((d) => ({ ...d, [target]: next }));
    });
    if (el?.isConnected) {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }
  };

  const textProps = (field: TextField) => ({
    onFocus: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => setFocused({ field, el: e.currentTarget }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors(errors)) return;
    onSave({
      name: draft.name,
      description: draft.description,
      clientId: draft.clientId || null,
      lineItems: draft.lines
        .filter((li) => li.description.trim())
        .map((li) => ({ id: li.id, description: li.description, quantity: Number(li.quantity) || 0, price: Number(li.price) || 0 })),
      taxRate: draft.taxRate.trim() ? Number(draft.taxRate) : null,
      currency: draft.currency || null,
      notes: draft.notes,
      paymentDetails: draft.paymentDetails,
      paymentTermsDays: draft.paymentTermsDays.trim() ? Number(draft.paymentTermsDays) : null,
      invoiceNamePattern: draft.invoiceNamePattern,
    });
  };

  // Live preview: placeholders resolved for an invoice issued today.
  const ctx = { issueDate: localToday(), clientName: selectedClient?.name, invoiceNumber: 'INV-0042' };
  const preview = {
    name: resolvePlaceholders(draft.invoiceNamePattern, ctx),
    lines: draft.lines.filter((l) => l.description.trim()).map((l) => ({ ...l, resolved: resolvePlaceholders(l.description, ctx) })),
    notes: resolvePlaceholders(draft.notes, ctx),
  };
  const unknown = [...new Set([preview.name, ...preview.lines.map((l) => l.resolved), preview.notes].flatMap((r) => r.unknown))];
  const subtotal = preview.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0);
  const usesPlaceholders = preview.name.text !== draft.invoiceNamePattern || preview.notes.text !== draft.notes || preview.lines.some((l) => l.resolved.text !== l.description) || unknown.length > 0;

  const label = 'text-xs text-muted-foreground';
  const error = (key: 'name' | 'taxRate' | 'paymentTermsDays') =>
    shown[key] ? (
      <p id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive">
        {shown[key]}
      </p>
    ) : null;
  const aria = (key: 'name' | 'taxRate' | 'paymentTermsDays') => ({
    id: `${id}-${key}`,
    'aria-invalid': !!shown[key] || undefined,
    'aria-describedby': shown[key] ? `${id}-${key}-error` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <DialogHeader>
        <DialogTitle>{template ? 'Edit template' : 'New template'}</DialogTitle>
        <DialogDescription>
          {template
            ? 'Changes apply to invoices you create from now on. Invoices already created from this template keep what they were issued with.'
            : 'A reusable blueprint: create invoices from it with the line items, terms and notes filled in.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`} className={label}>
            Template name
          </Label>
          <Input {...aria('name')} value={draft.name} onChange={set('name')} maxLength={TEMPLATE_LIMITS.name} placeholder="e.g. Monthly retainer" className="bg-secondary border-border" autoFocus />
          {error('name')}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-client`} className={label}>
            Default client (optional)
          </Label>
          <select
            id={`${id}-client`}
            value={draft.clientId}
            onChange={set('clientId')}
            className="flex h-9 w-full rounded-md border border-border bg-secondary px-3 py-1 text-sm text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">No default client</option>
            {pickable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {selectedClient && !pickable.includes(selectedClient) && <option value={selectedClient.id}>{selectedClient.name} (archived)</option>}
            {draft.clientId && !selectedClient && <option value={draft.clientId}>Deleted client</option>}
          </select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-description`} className={label}>
            Description (optional, not printed)
          </Label>
          <Input id={`${id}-description`} value={draft.description} onChange={set('description')} maxLength={TEMPLATE_LIMITS.description} placeholder="What this template is for" className="bg-secondary border-border" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-invoiceNamePattern`} className={label}>
            Invoice name (optional)
          </Label>
          <Input
            id={`${id}-invoiceNamePattern`}
            {...textProps('invoiceNamePattern')}
            value={draft.invoiceNamePattern}
            onChange={set('invoiceNamePattern')}
            maxLength={TEMPLATE_LIMITS.invoiceNamePattern}
            placeholder="e.g. Retainer {{month_name}} {{year}}"
            className="bg-secondary border-border"
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <legend className="text-sm font-medium text-foreground">Line items</legend>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, newLine()] }))}>
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add item
          </Button>
        </div>
        <ul className="space-y-3">
          {draft.lines.map((li, index) => {
            const err = shown.lineErrors?.[li.id];
            return (
              <li key={li.id} className={index > 0 ? "space-y-1 max-sm:border-t max-sm:border-border max-sm:pt-3" : "space-y-1"}>
                <div className="grid grid-cols-[1fr_4.5rem_6rem_2.25rem] items-end gap-2 max-sm:grid-cols-[1fr_1fr_2.25rem]">
                  <div className="space-y-1 max-sm:col-span-3">
                    <Label htmlFor={`${id}-line-${li.id}`} className={index === 0 ? 'text-[10px] text-muted-foreground' : 'sr-only'}>
                      Description{index > 0 ? ` (item ${index + 1})` : ''}
                    </Label>
                    <Input
                      id={`${id}-line-${li.id}`}
                      {...textProps(`line:${li.id}`)}
                      value={li.description}
                      onChange={(e) => setLine(li.id, 'description', e.target.value)}
                      maxLength={TEMPLATE_LIMITS.lineDescription}
                      placeholder="e.g. Retainer {{prev_month_name}}"
                      aria-invalid={!!err || undefined}
                      aria-describedby={err ? `${id}-line-${li.id}-error` : undefined}
                      className="bg-secondary border-border text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-qty-${li.id}`} className={index === 0 ? 'text-[10px] text-muted-foreground' : 'sr-only max-sm:not-sr-only max-sm:text-[10px] max-sm:text-muted-foreground'}>
                      Qty
                    </Label>
                    <Input id={`${id}-qty-${li.id}`} type="number" inputMode="decimal" min="0" value={li.quantity} onChange={(e) => setLine(li.id, 'quantity', e.target.value)} className="bg-secondary border-border text-right text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-price-${li.id}`} className={index === 0 ? 'text-[10px] text-muted-foreground' : 'sr-only max-sm:not-sr-only max-sm:text-[10px] max-sm:text-muted-foreground'}>
                      Price
                    </Label>
                    <Input id={`${id}-price-${li.id}`} type="number" inputMode="decimal" min="0" step="0.01" value={li.price} onChange={(e) => setLine(li.id, 'price', e.target.value)} placeholder="0" className="bg-secondary border-border text-right text-sm" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    disabled={draft.lines.length === 1}
                    onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== li.id) }))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove item {index + 1}</span>
                  </Button>
                </div>
                {err && (
                  <p id={`${id}-line-${li.id}-error`} role="alert" className="text-xs text-destructive">
                    {err}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Empty rows are ignored. A template without line items fills only the other fields.</p>
      </fieldset>

      <section aria-labelledby={`${id}-ph-heading`} className="space-y-3 border border-border bg-secondary/40 p-3">
        <div className="flex items-start gap-2">
          <Braces className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <h3 id={`${id}-ph-heading`} className="font-sans text-sm font-medium text-foreground">
              Placeholders
            </h3>
            <p className="text-xs text-muted-foreground">
              Filled in when an invoice is created, for its issue date. Click one to insert it into the invoice name, a line description or the notes (wherever your cursor was).
            </p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Insert a placeholder">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertPlaceholder(p.name)}
                title={`${p.description} (e.g. ${p.example})`}
                aria-label={`Insert {{${p.name}}}: ${p.description}`}
                className="border border-border bg-background px-1.5 py-0.5 font-code text-[11px] text-foreground hover:border-primary/60 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {`{{${p.name}}}`}
              </button>
            </li>
          ))}
        </ul>
        {usesPlaceholders && (
          <div className="space-y-1.5 border-t border-border pt-3" aria-live="polite">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview for an invoice issued today</p>
            {draft.invoiceNamePattern.trim() && <p className="text-sm font-medium text-foreground break-words">{preview.name.text}</p>}
            {preview.lines.length > 0 && (
              <ul className="space-y-0.5 text-xs text-foreground">
                {preview.lines.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">{l.resolved.text}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency((Number(l.quantity) || 0) * (Number(l.price) || 0), draft.currency || 'USD')}</span>
                  </li>
                ))}
              </ul>
            )}
            {draft.notes.trim() && <p className="whitespace-pre-line break-words text-xs text-muted-foreground">{preview.notes.text}</p>}
            {preview.lines.length > 1 && <p className="text-right text-xs tabular-nums text-muted-foreground">Subtotal {formatCurrency(subtotal, draft.currency || 'USD')}</p>}
            {unknown.length > 0 && (
              <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                Not a placeholder (will stay as typed): {unknown.map((n) => `{{${n}}}`).join(', ')}
              </p>
            )}
            {!selectedClient && [preview.name, preview.notes, ...preview.lines.map((l) => l.resolved)].some((r) => r.unresolved.includes('client_name')) && (
              <p className="text-xs text-muted-foreground">{'{{client_name}}'} is the Bill To name of the invoice.</p>
            )}
          </div>
        )}
      </section>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">Terms</legend>
        <p className="text-xs text-muted-foreground">Leave empty to use the client’s defaults, then your usual defaults.</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2 sm:col-span-1">
            <Label id={`${id}-currency-label`} className={label}>
              Currency
            </Label>
            <div className="flex items-center gap-1" aria-labelledby={`${id}-currency-label`}>
              <CurrencySelector value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} className="min-w-0 flex-1" />
              {draft.currency && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setDraft((d) => ({ ...d, currency: '' }))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Clear currency</span>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2 sm:col-span-1">
            <Label htmlFor={`${id}-taxRate`} className={label}>
              Tax rate (%)
            </Label>
            <Input {...aria('taxRate')} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft.taxRate} onChange={set('taxRate')} placeholder="Default" className="bg-secondary border-border" />
            {error('taxRate')}
          </div>
          <div className="space-y-2 sm:col-span-1 max-sm:col-span-1">
            <Label htmlFor={`${id}-paymentTermsDays`} className={label}>
              Payment terms (days)
            </Label>
            <Input {...aria('paymentTermsDays')} type="number" inputMode="numeric" min="0" step="1" value={draft.paymentTermsDays} onChange={set('paymentTermsDays')} placeholder="e.g. 14" className="bg-secondary border-border" />
            {error('paymentTermsDays')}
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-notes`} className={label}>
            Notes (printed)
          </Label>
          <Textarea id={`${id}-notes`} {...textProps('notes')} value={draft.notes} onChange={set('notes')} maxLength={TEMPLATE_LIMITS.notes} rows={3} placeholder="Thank you for your business!" className="bg-secondary border-border resize-none text-sm" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-paymentDetails`} className={label}>
            Payment details
          </Label>
          <Textarea id={`${id}-paymentDetails`} value={draft.paymentDetails} onChange={set('paymentDetails')} maxLength={TEMPLATE_LIMITS.paymentDetails} rows={3} placeholder="Empty: your default payment details" className="bg-secondary border-border resize-none text-sm" />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{template ? 'Save changes' : 'Save template'}</Button>
      </DialogFooter>
    </form>
  );
}
