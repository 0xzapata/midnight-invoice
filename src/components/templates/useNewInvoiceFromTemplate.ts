import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { localToday } from '../../../shared/invoice-status';
import type { InvoiceTemplate } from '../../../shared/types/template';
import { describePlaceholderReport, newInvoiceDraftFromTemplate, type PlaceholderReport } from './templateApply';

/** Success toast, or a warning listing placeholders that were left in the text. */
export function notifyTemplateApplied(title: string, report: PlaceholderReport) {
  const detail = describePlaceholderReport(report);
  if (detail) toast.warning(title, { description: detail });
  else toast.success(title);
}

/** Creates a new invoice draft from `template` and opens it in the editor. */
export function useNewInvoiceFromTemplate() {
  const navigate = useNavigate();
  return (template: InvoiceTemplate) => {
    const id = crypto.randomUUID();
    const store = useInvoiceStore.getState();
    const { draft, report } = newInvoiceDraftFromTemplate(template, {
      clients: useClientStore.getState().clients,
      settings: useSettingsStore.getState().settings,
      invoiceNumber: store.getNextInvoiceNumber(),
      today: localToday(),
    });
    store.saveDraft(id, draft);
    notifyTemplateApplied(`New invoice from “${template.name}”`, report);
    navigate(`/create/${id}`, { viewTransition: true });
  };
}

