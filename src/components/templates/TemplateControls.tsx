import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BookmarkPlus, Check, ChevronsUpDown, FileStack } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { activeTemplatesSorted, templateDataFromInvoice, useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import type { InvoiceFormData } from '@/types/invoice';
import { cn } from '@/lib/utils';
import { localToday } from '../../../shared/invoice-status';
import type { InvoiceTemplate, TemplateFormData } from '../../../shared/types/template';
import { TemplateFormDialog } from './TemplateFormDialog';
import { isPristineForTemplate, templateFormPatch, type ApplyMode } from './templateApply';
import { notifyTemplateApplied } from './useNewInvoiceFromTemplate';

/** Combobox listing the saved (not archived) templates. */
export function TemplatePicker({
  onPick,
  selectedId,
  trigger,
  align = 'end',
}: {
  onPick: (template: InvoiceTemplate) => void;
  selectedId?: string;
  /** Custom trigger (rendered with asChild); default: a small outline button. */
  trigger?: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const templates = useTemplateStore((s) => s.templates);
  const active = activeTemplatesSorted(templates);
  const selected = selectedId ? templates.find((t) => t.id === selectedId) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={selected ? `Template: ${selected.name}. Apply a template` : 'Apply a template'}
            className="h-8 min-w-0 max-w-[13rem] justify-between gap-1 text-xs"
          >
            <FileStack className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{selected ? selected.name : 'From template'}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align={align}>
        <Command>
          <CommandInput placeholder="Search templates…" />
          <CommandList>
            <CommandEmpty>{templates.length === 0 ? 'No templates yet.' : 'No template found.'}</CommandEmpty>
            {active.length > 0 && (
              <CommandGroup heading="Templates">
                {active.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.name} ${t.description} ${t.id}`}
                    onSelect={() => {
                      setOpen(false);
                      onPick(t);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4 shrink-0', selectedId === t.id ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate">{t.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {t.description || `${t.lineItems.length} line item${t.lineItems.length === 1 ? '' : 's'}`}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t border-border p-1">
            <Link
              to="/templates"
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileStack className="h-3.5 w-3.5" aria-hidden="true" />
              Manage templates
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "Save as template": opens the template dialog prefilled from an invoice. */
export function SaveAsTemplateButton({ invoice, compact = false, className }: { invoice: () => Partial<InvoiceFormData>; compact?: boolean; className?: string }) {
  const [initial, setInitial] = useState<TemplateFormData | null>(null);
  const open = () => {
    const inv = invoice();
    const name = inv.invoiceName?.trim() || (inv.toName?.trim() ? `${inv.toName.trim()} invoice` : 'New template');
    setInitial(templateDataFromInvoice(inv, name));
  };
  const save = (data: TemplateFormData) => {
    const saved = useTemplateStore.getState().saveTemplate(data);
    setInitial(null);
    // No navigation here: the invoice form also renders outside a router (tests, embeds).
    toast.success(`Saved the template “${saved.name}”`, { description: 'Find it under Templates, or use “From template” on a new invoice.' });
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open} className={className} title="Save as template">
        <BookmarkPlus className={cn('h-4 w-4', !compact && 'sm:mr-2')} aria-hidden="true" />
        <span className={compact ? 'sr-only' : 'sr-only sm:not-sr-only'}>Save as template</span>
      </Button>
      <TemplateFormDialog open={initial !== null} onOpenChange={(o) => !o && setInitial(null)} initial={initial ?? undefined} onSave={save} />
    </>
  );
}

/**
 * Top of the invoice form: apply a template ("From template") and save the
 * invoice as a template. Applying never silently overwrites what the user
 * already typed: on a form with content the user chooses between adding the
 * template's items (keeping everything typed) and replacing.
 */
export function InvoiceTemplateBar({
  values,
  touched,
  onApply,
}: {
  values: InvoiceFormData;
  touched: () => { currency: boolean; taxRate: boolean };
  onApply: (patch: Partial<InvoiceFormData>) => void;
}) {
  const [pending, setPending] = useState<InvoiceTemplate | null>(null);
  const hasTemplates = useTemplateStore((s) => s.templates.some((t) => !t.archivedAt));

  const apply = (template: InvoiceTemplate, mode: ApplyMode) => {
    const { patch, report } = templateFormPatch(template, values, {
      clients: useClientStore.getState().clients,
      mode,
      touched: touched(),
      today: localToday(),
    });
    onApply(patch);
    setPending(null);
    notifyTemplateApplied(mode === 'merge' ? `Added “${template.name}” to this invoice` : `Applied “${template.name}”`, report);
  };

  const pick = (template: InvoiceTemplate) => {
    if (isPristineForTemplate(values)) apply(template, 'replace');
    else setPending(template);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
      <p className="text-xs text-muted-foreground">{hasTemplates ? 'Start from a saved template, or save this one for later.' : 'Save this invoice as a reusable template.'}</p>
      <div className="flex items-center gap-2">
        {hasTemplates && <TemplatePicker onPick={pick} selectedId={values.templateId} />}
        <SaveAsTemplateButton invoice={() => values} compact className="h-8 w-8 px-0" />
      </div>
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply “{pending?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This invoice already has content. Add the template’s line items and fill only the empty fields, or replace the line items, name, notes and terms with the template’s.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={() => pending && apply(pending, 'replace')}>
              Replace
            </Button>
            <Button type="button" onClick={() => pending && apply(pending, 'merge')} autoFocus>
              Add to invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
