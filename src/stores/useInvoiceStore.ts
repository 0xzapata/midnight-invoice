import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Invoice, InvoiceFormData } from '@/types/invoice';
import { CURRENT_INVOICE_VERSION, migrateInvoiceStore } from '@/lib/storageMigrations';
import { emitLocalInvoiceChange } from '@/lib/sync/localChanges';
import { isGeneratedInvoiceName } from '@/lib/invoiceName';

/**
 * Invoice store state interface.
 *
 * @property invoices - Array of saved invoices
 * @property drafts - Map of invoice ID to draft form data
 * @property _hasHydrated - Whether the store has loaded from localStorage
 */
interface InvoiceState {
    invoices: Invoice[];
    drafts: Record<string, InvoiceFormData>;
    _hasHydrated: boolean;

    // Actions
    setHasHydrated: (value: boolean) => void;
    saveInvoice: (formData: InvoiceFormData, id?: string) => Invoice;
    deleteInvoice: (id: string) => void;
    getInvoice: (id: string) => Invoice | undefined;
    getNextInvoiceNumber: () => string;
    saveDraft: (id: string, formData: InvoiceFormData) => void;
    loadDraft: (id: string) => InvoiceFormData | null;
    clearDraft: (id: string) => void;
}

/**
 * Zustand store for invoice management with localStorage persistence.
 *
 * Features:
 * - Automatic persistence to localStorage via `persist` middleware
 * - Hydration detection for loading states
 * - Draft management per invoice
 * - Sequential invoice number generation
 *
 * @example
 * // Access store in a component
 * const invoices = useInvoiceStore((state) => state.invoices);
 * const saveInvoice = useInvoiceStore((state) => state.saveInvoice);
 *
 * @example
 * // Save a new invoice
 * const invoice = saveInvoice(formData);
 *
 * @example
 * // Check if store has hydrated from localStorage
 * const hasHydrated = useHasHydrated();
 */
export const useInvoiceStore = create<InvoiceState>()(
    persist(
        (set, get) => ({
            invoices: [],
            drafts: {},
            _hasHydrated: false,

            /**
             * Sets the hydration status.
             * Called automatically when the store rehydrates from localStorage.
             */
            setHasHydrated: (value) => set({ _hasHydrated: value }),

            /**
             * Saves or updates an invoice.
             *
             * @param formData - The invoice form data to save
             * @param id - Optional ID for updating existing invoice
             * @returns The saved invoice object
             */
            saveInvoice: (formData, id) => {
                const invoiceId = id || crypto.randomUUID();
                const existing = get().invoices.find((inv) => inv.id === invoiceId);
                // Only a name the user typed is stored (and printed). Unnamed invoices get
                // their dashboard label from `invoiceListLabel`; a label an earlier version
                // stored in `invoiceName` is kept so the dashboard keeps calling it the same.
                const invoiceName = formData.invoiceName?.trim()
                    || (isGeneratedInvoiceName(existing?.invoiceName) ? existing.invoiceName : undefined);

                // Form data may carry server metadata copied from the loaded invoice;
                // that bookkeeping belongs to the stored invoice, not to the form.
                const {
                    revision: _revision,
                    updatedAt: _updatedAt,
                    deletedAt: _deletedAt,
                    createdBy: _createdBy,
                    updatedBy: _updatedBy,
                    ...fields
                } = formData as InvoiceFormData & Partial<Invoice>;

                const newInvoice: Invoice = {
                    ...fields,
                    version: CURRENT_INVOICE_VERSION,
                    invoiceName,
                    id: invoiceId,
                    createdAt: existing?.createdAt ?? new Date().toISOString(),
                    // Cloud sync metadata (absent on purely local invoices): the last
                    // known server revision is the base for the next upload.
                    ...(existing?.revision !== undefined && { revision: existing.revision }),
                    ...(existing?.updatedAt !== undefined && { updatedAt: existing.updatedAt }),
                    ...(existing?.createdBy && { createdBy: existing.createdBy }),
                    ...(existing?.updatedBy && { updatedBy: existing.updatedBy }),
                };

                set((state) => {
                    const existingIndex = state.invoices.findIndex((inv) => inv.id === invoiceId);
                    let updatedInvoices: Invoice[];

                    if (existingIndex >= 0) {
                        updatedInvoices = [...state.invoices];
                        updatedInvoices[existingIndex] = newInvoice;
                    } else {
                        updatedInvoices = [newInvoice, ...state.invoices];
                    }

                    return { invoices: updatedInvoices };
                });

                emitLocalInvoiceChange({ type: 'upsert', id: invoiceId });
                return newInvoice;
            },

            /**
             * Deletes an invoice by ID.
             *
             * @param id - The invoice ID to delete
             */
            deleteInvoice: (id) => {
                const existing = get().invoices.find((inv) => inv.id === id);
                set((state) => ({
                    invoices: state.invoices.filter((inv) => inv.id !== id),
                }));
                if (existing) emitLocalInvoiceChange({ type: 'delete', id, invoice: existing });
            },

            /**
             * Retrieves an invoice by ID.
             *
             * @param id - The invoice ID to find
             * @returns The invoice if found, undefined otherwise
             */
            getInvoice: (id) => {
                return get().invoices.find((inv) => inv.id === id);
            },

            /**
             * Generates the next sequential invoice number.
             * Finds the highest existing number and increments it.
             *
             * @returns Invoice number in format 'INV-XXXX'
             */
            getNextInvoiceNumber: () => {
                const { invoices } = get();
                const maxNum = invoices.reduce((max, inv) => {
                    const num = parseInt(inv.invoiceNumber.replace(/\D/g, ''), 10);
                    return isNaN(num) ? max : Math.max(max, num);
                }, 0);
                return `INV-${String(maxNum + 1).padStart(4, '0')}`;
            },

            /**
             * Saves a draft for an invoice.
             *
             * @param id - The invoice ID to associate the draft with
             * @param formData - The form data to save as draft
             */
            saveDraft: (id, formData) => {
                set((state) => ({
                    drafts: { ...state.drafts, [id]: formData },
                }));
            },

            /**
             * Loads a draft for an invoice.
             *
             * @param id - The invoice ID to load draft for
             * @returns The draft form data if found, null otherwise
             */
            loadDraft: (id) => {
                return get().drafts[id] || null;
            },

            /**
             * Clears a draft for an invoice.
             *
             * @param id - The invoice ID to clear draft for
             */
            clearDraft: (id) => {
                set((state) => {
                    const { [id]: _, ...remainingDrafts } = state.drafts;
                    return { drafts: remainingDrafts };
                });
            },
        }),
        {
            name: 'invoice-storage',
            version: CURRENT_INVOICE_VERSION,
            migrate: migrateInvoiceStore,
            partialize: (state) => ({
                invoices: state.invoices,
                drafts: state.drafts,
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('Failed to rehydrate invoice store from localStorage:', error);
                    // Still set hydrated to true so app doesn't hang
                }
                state?.setHasHydrated(true);
            },
        }
    )
);

/**
 * Hook to check if the store has hydrated from localStorage.
 *
 * Use this to show loading states during initial page load.
 *
 * @returns true when the store has finished loading from localStorage
 *
 * @example
 * const hasHydrated = useHasHydrated();
 * if (!hasHydrated) return <LoadingSpinner />;
 */
export const useHasHydrated = () => useInvoiceStore((state) => state._hasHydrated);

