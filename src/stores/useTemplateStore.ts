import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InvoiceTemplate, TemplateFormData } from '../../shared/types/template';
import type { InvoiceFormData } from '@/types/invoice';
import { CURRENT_TEMPLATE_VERSION, migrateTemplateStore, type TemplatePersistedState } from '@/lib/storageMigrations';
import { emitLocalChange } from '@/lib/sync/localChanges';

export const TEMPLATE_STORAGE_KEY = 'template-storage';

interface TemplateState {
  templates: InvoiceTemplate[];
  _hasHydrated: boolean;

  setHasHydrated: (value: boolean) => void;
  saveTemplate: (data: TemplateFormData, id?: string) => InvoiceTemplate;
  setArchived: (id: string, archived: boolean) => void;
  deleteTemplate: (id: string) => void;
  getTemplate: (id: string) => InvoiceTemplate | undefined;
}

const finite = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const clean = (data: TemplateFormData): TemplateFormData => ({
  name: data.name.trim(),
  description: data.description.trim(),
  clientId: data.clientId || null,
  lineItems: data.lineItems
    .filter((li) => li.description.trim() !== '')
    .map((li) => ({ id: li.id || crypto.randomUUID(), description: li.description.trim(), quantity: finite(li.quantity) ?? 0, price: finite(li.price) ?? 0 })),
  taxRate: finite(data.taxRate),
  currency: data.currency || null,
  notes: data.notes,
  paymentDetails: data.paymentDetails,
  paymentTermsDays: finite(data.paymentTermsDays) === null ? null : Math.max(0, Math.round(data.paymentTermsDays!)),
  invoiceNamePattern: data.invoiceNamePattern.trim(),
});

/**
 * Invoice templates, local-first like invoices and clients: persisted in
 * localStorage, usable offline and without cloud sync. User edits are
 * reported to the sync engine through emitLocalChange; changes applied from
 * the server use setState directly so they are never echoed back.
 */
export const useTemplateStore = create<TemplateState>()(
  persist(
    (set, get) => ({
      templates: [],
      _hasHydrated: false,
      setHasHydrated: (value) => set({ _hasHydrated: value }),

      saveTemplate: (data, id) => {
        const templateId = id || crypto.randomUUID();
        const existing = get().templates.find((t) => t.id === templateId);
        const now = new Date().toISOString();
        const template: InvoiceTemplate = {
          ...clean(data),
          id: templateId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          archivedAt: existing?.archivedAt ?? null,
          // Sync metadata: the last known server revision is the base for the next upload.
          ...(existing?.revision !== undefined && { revision: existing.revision }),
          ...(existing?.createdBy && { createdBy: existing.createdBy }),
          ...(existing?.updatedBy && { updatedBy: existing.updatedBy }),
        };
        set((state) => {
          const index = state.templates.findIndex((t) => t.id === templateId);
          if (index < 0) return { templates: [template, ...state.templates] };
          const templates = [...state.templates];
          templates[index] = template;
          return { templates };
        });
        emitLocalChange({ collection: 'templates', type: 'upsert', id: templateId });
        return template;
      },

      setArchived: (id, archived) => {
        const existing = get().templates.find((t) => t.id === id);
        if (!existing || !!existing.archivedAt === archived) return;
        const now = new Date().toISOString();
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? { ...t, archivedAt: archived ? now : null, updatedAt: now } : t)),
        }));
        emitLocalChange({ collection: 'templates', type: 'upsert', id });
      },

      deleteTemplate: (id) => {
        const existing = get().templates.find((t) => t.id === id);
        set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }));
        if (existing) emitLocalChange({ collection: 'templates', type: 'delete', id, entity: existing });
      },

      getTemplate: (id) => get().templates.find((t) => t.id === id),
    }),
    {
      name: TEMPLATE_STORAGE_KEY,
      version: CURRENT_TEMPLATE_VERSION,
      migrate: migrateTemplateStore,
      partialize: (state): TemplatePersistedState => ({ templates: state.templates }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Failed to rehydrate template store from localStorage:', error);
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** Live (not archived) templates sorted by name, for pickers. */
export function activeTemplatesSorted(templates: InvoiceTemplate[]): InvoiceTemplate[] {
  return templates.filter((t) => !t.archivedAt).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Template form data from an invoice ("Save as template"): its line items,
 * terms, notes, payment details and client. Dates and the invoice number are
 * not part of a template; the due date becomes payment terms in days.
 */
export function templateDataFromInvoice(invoice: Partial<InvoiceFormData>, name: string): TemplateFormData {
  let paymentTermsDays: number | null = null;
  if (invoice.issueDate && invoice.dueDate) {
    const days = Math.round((Date.parse(`${invoice.dueDate}T00:00:00Z`) - Date.parse(`${invoice.issueDate}T00:00:00Z`)) / 86_400_000);
    if (Number.isFinite(days) && days >= 0) paymentTermsDays = days;
  }
  return {
    name,
    description: '',
    clientId: invoice.clientId ?? null,
    lineItems: (invoice.lineItems ?? [])
      .filter((li) => li.description.trim() !== '')
      .map((li) => ({ id: crypto.randomUUID(), description: li.description, quantity: li.quantity, price: li.price })),
    taxRate: typeof invoice.taxRate === 'number' ? invoice.taxRate : null,
    currency: invoice.currency || null,
    notes: invoice.notes ?? '',
    paymentDetails: invoice.paymentDetails ?? '',
    paymentTermsDays,
    invoiceNamePattern: '',
  };
}
