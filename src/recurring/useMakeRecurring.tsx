import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { templateDataFromInvoice, useTemplateStore } from '@/stores/useTemplateStore';
import type { Invoice } from '@/types/invoice';

/** `/recurring` with the new-schedule dialog prefilled. */
export function recurringLink(templateId: string, clientId?: string | null): string {
  const params = new URLSearchParams({ template: templateId });
  if (clientId) params.set('client', clientId);
  return `/recurring?${params}`;
}

/**
 * "Make recurring" for an invoice: schedules are made from templates, so an
 * invoice that came from a template that still exists goes straight to the
 * new-schedule dialog; otherwise it asks before saving the invoice as a
 * template first. Render `dialog` once.
 */
export function useMakeRecurring(invoice: Invoice | undefined) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const template = useTemplateStore((s) => (invoice?.templateId ? s.templates.find((t) => t.id === invoice.templateId) : undefined));
  const name = invoice ? invoice.invoiceName?.trim() || (invoice.toName?.trim() ? `${invoice.toName.trim()} invoice` : 'Recurring invoice') : '';

  const start = () => {
    if (!invoice) return;
    if (template && !template.archivedAt) navigate(recurringLink(template.id, invoice.clientId), { viewTransition: true });
    else setConfirming(true);
  };
  const createTemplate = () => {
    if (!invoice) return;
    const saved = useTemplateStore.getState().saveTemplate(templateDataFromInvoice(invoice, name));
    toast.success(`Saved the template “${saved.name}”`, { description: 'Now choose how often to create the invoice.' });
    navigate(recurringLink(saved.id, invoice.clientId), { viewTransition: true });
  };

  const dialog = (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save this invoice as a template first?</AlertDialogTitle>
          <AlertDialogDescription>
            Recurring invoices are created from a template. “{name}” will be saved as a template with this invoice’s line items, tax rate, currency, notes and payment terms
            (not its number or dates), and then you choose how often to bill.
            {invoice && !invoice.clientId ? ' This invoice is not billed to a saved client, so pick one in the next step.' : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={createTemplate}>Save template and continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { start, dialog };
}
