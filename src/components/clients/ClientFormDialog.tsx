import { useId, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencySelector } from '@/components/ui/CurrencySelector';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CLIENT_LIMITS, type Client, type ClientFormData } from '../../../shared/types/client';

interface ClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this client; omitted = new client. */
  client?: Client;
  /** Prefill for a new client (e.g. from an invoice's Bill To). */
  initial?: Partial<ClientFormData>;
  onSave: (data: ClientFormData) => void;
}

interface Draft {
  name: string;
  email: string;
  address: string;
  defaultCurrency: string;
  defaultTaxRate: string;
  paymentTermsDays: string;
  notes: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDraft(c?: Partial<ClientFormData>): Draft {
  return {
    name: c?.name ?? '',
    email: c?.email ?? '',
    address: c?.address ?? '',
    defaultCurrency: c?.defaultCurrency ?? '',
    defaultTaxRate: c?.defaultTaxRate != null ? String(c.defaultTaxRate) : '',
    paymentTermsDays: c?.paymentTermsDays != null ? String(c.paymentTermsDays) : '',
    notes: c?.notes ?? '',
  };
}

function validateClientDraft(d: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!d.name.trim()) errors.name = 'Client name is required';
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) errors.email = 'Invalid email format';
  if (d.defaultTaxRate.trim()) {
    const n = Number(d.defaultTaxRate);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.defaultTaxRate = 'Tax rate must be between 0 and 100';
  }
  if (d.paymentTermsDays.trim()) {
    const n = Number(d.paymentTermsDays);
    if (!Number.isInteger(n) || n < 0 || n > CLIENT_LIMITS.maxPaymentTermsDays) errors.paymentTermsDays = `Whole days, 0–${CLIENT_LIMITS.maxPaymentTermsDays}`;
  }
  return errors;
}

/** Add / edit a saved client. Renders nothing while closed (the form remounts with fresh values on open). */
export function ClientFormDialog({ open, onOpenChange, client, initial, onSave }: ClientFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full">
          <ClientForm client={client} initial={initial} onCancel={() => onOpenChange(false)} onSave={onSave} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ClientForm({ client, initial, onCancel, onSave }: Omit<ClientFormDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(client ?? initial));
  const [submitted, setSubmitted] = useState(false);
  const errors = validateClientDraft(draft);
  const shown = submitted ? errors : {};
  const id = useId();
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSave({
      name: draft.name,
      email: draft.email,
      address: draft.address,
      defaultCurrency: draft.defaultCurrency || null,
      defaultTaxRate: draft.defaultTaxRate.trim() ? Number(draft.defaultTaxRate) : null,
      paymentTermsDays: draft.paymentTermsDays.trim() ? Number(draft.paymentTermsDays) : null,
      notes: draft.notes,
    });
  };

  const field = (key: keyof Draft) => ({
    id: `${id}-${key}`,
    'aria-invalid': !!shown[key] || undefined,
    'aria-describedby': shown[key] ? `${id}-${key}-error` : undefined,
  });
  const error = (key: keyof Draft) =>
    shown[key] ? (
      <p id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive">
        {shown[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <DialogHeader>
        <DialogTitle>{client ? 'Edit client' : 'New client'}</DialogTitle>
        <DialogDescription>
          {client
            ? 'Changes apply to new invoices. Existing invoices keep the details they were issued with.'
            : 'Saved clients fill the Bill To section of new invoices.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
            Name / Company
          </Label>
          <Input {...field('name')} value={draft.name} onChange={set('name')} maxLength={CLIENT_LIMITS.name} placeholder="Client name" className="bg-secondary border-border" autoFocus />
          {error('name')}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-email`} className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input {...field('email')} type="email" value={draft.email} onChange={set('email')} maxLength={CLIENT_LIMITS.email} placeholder="client@email.com" className="bg-secondary border-border" />
          {error('email')}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${id}-address`} className="text-xs text-muted-foreground">
            Address
          </Label>
          <Textarea {...field('address')} value={draft.address} onChange={set('address')} maxLength={CLIENT_LIMITS.address} rows={3} placeholder="Street, City, Country" className="bg-secondary border-border resize-none" />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">Defaults for new invoices</legend>
        <p className="text-xs text-muted-foreground">Leave empty to use your usual defaults.</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2">
            <Label id={`${id}-currency-label`} className="text-xs text-muted-foreground">
              Currency
            </Label>
            <div className="flex items-center gap-1" aria-labelledby={`${id}-currency-label`}>
              <CurrencySelector value={draft.defaultCurrency} onChange={(v) => setDraft((d) => ({ ...d, defaultCurrency: v }))} className="min-w-0 flex-1" />
              {draft.defaultCurrency && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setDraft((d) => ({ ...d, defaultCurrency: '' }))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Clear default currency</span>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-defaultTaxRate`} className="text-xs text-muted-foreground">
              Tax rate (%)
            </Label>
            <Input {...field('defaultTaxRate')} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft.defaultTaxRate} onChange={set('defaultTaxRate')} placeholder="Default" className="bg-secondary border-border" />
            {error('defaultTaxRate')}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-paymentTermsDays`} className="text-xs text-muted-foreground">
              Payment terms (days)
            </Label>
            <Input {...field('paymentTermsDays')} type="number" inputMode="numeric" min="0" step="1" value={draft.paymentTermsDays} onChange={set('paymentTermsDays')} placeholder="e.g. 30" className="bg-secondary border-border" />
            {error('paymentTermsDays')}
          </div>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${id}-notes`} className="text-xs text-muted-foreground">
          Private notes (not printed on invoices)
        </Label>
        <Textarea {...field('notes')} value={draft.notes} onChange={set('notes')} maxLength={CLIENT_LIMITS.notes} rows={2} className="bg-secondary border-border resize-none text-sm" />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{client ? 'Save changes' : 'Save client'}</Button>
      </DialogFooter>
    </form>
  );
}
