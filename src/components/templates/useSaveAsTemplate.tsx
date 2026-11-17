import { useContext, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router';
import { toast } from 'sonner';
import { templateDataFromInvoice, useTemplateStore } from '@/stores/useTemplateStore';
import type { InvoiceFormData } from '@/types/invoice';
import type { TemplateFormData } from '../../../shared/types/template';
import { TemplateFormDialog } from './TemplateFormDialog';

/**
 * "Save as template": `start()` opens the template dialog prefilled from the
 * invoice; render `dialog` once. After saving, the toast offers to open
 * /templates. The router's navigator is read from context without
 * `useNavigate` (which throws outside a router), because the invoice form is
 * also rendered on its own (tests); there the toast has no action.
 */
export function useSaveAsTemplate(invoice: () => Partial<InvoiceFormData>) {
  const [initial, setInitial] = useState<TemplateFormData | null>(null);
  const navigation = useContext(UNSAFE_NavigationContext) as { navigator?: { push: (to: string) => void } } | null;
  const navigator = navigation?.navigator;

  const start = () => {
    const inv = invoice();
    const name = inv.invoiceName?.trim() || (inv.toName?.trim() ? `${inv.toName.trim()} invoice` : 'New template');
    setInitial(templateDataFromInvoice(inv, name));
  };
  const save = (data: TemplateFormData) => {
    const saved = useTemplateStore.getState().saveTemplate(data);
    setInitial(null);
    toast.success(`Saved the template “${saved.name}”`, {
      description: 'Use it with “From template” on a new invoice.',
      ...(navigator && { action: { label: 'View templates', onClick: () => navigator.push('/templates') } }),
    });
  };
  const dialog = <TemplateFormDialog open={initial !== null} onOpenChange={(o) => !o && setInitial(null)} initial={initial ?? undefined} onSave={save} />;
  return { start, dialog };
}
