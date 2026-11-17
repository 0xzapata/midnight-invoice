import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Invoice, InvoiceFormData } from '@/types/invoice';
import { CURRENT_INVOICE_VERSION, migrateInvoiceStore } from '@/lib/storageMigrations';
import { emitLocalInvoiceChange } from '@/lib/sync/localChanges';
import {
    actionTarget,
    localToday,
    normalizeStatusFields,
    statusOf,
    transitionStatus,
    type InvoiceStatus,
    type StatusAction,
    type TransitionResult,
} from '../../shared/invoice-status';

// Creative session name generators
const adjectives = ['Cosmic', 'Swift', 'Golden', 'Stellar', 'Bright', 'Noble', 'Grand', 'Prime', 'Royal', 'Epic'];
const nouns = ['Phoenix', 'Dragon', 'Thunder', 'Aurora', 'Nexus', 'Zenith', 'Summit', 'Pulse', 'Wave', 'Spark'];

/**
 * Generates a creative session name for invoices.
 * Used when the user doesn't provide an invoice name.
 *
 * @returns A creative name like "Cosmic Phoenix 42"
 * @internal
 */
function generateCreativeSessionName(): string {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj} ${noun} ${num}`;
}

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
    /**
     * Status is not part of the form: an existing invoice keeps its status;
     * a new one is a draft unless `options.status` says otherwise.
     */
    saveInvoice: (formData: InvoiceFormData, id?: string, options?: { status?: InvoiceStatus }) => Invoice;
    /**
     * Changes the status with the shared transition rules (shared/invoice-status.ts).
     * Returns the rule's verdict; on success the change is saved and synced like any edit.
     */
    setInvoiceStatus: (id: string, change: StatusAction | { status: InvoiceStatus; paidAt?: string }) => TransitionResult | { ok: false; message: string };
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
            saveInvoice: (formData, id, options) => {
                const invoiceName = formData.invoiceName || generateCreativeSessionName();
                const invoiceId = id || crypto.randomUUID();
                const existing = get().invoices.find((inv) => inv.id === invoiceId);

                // Form data may carry server metadata copied from the loaded invoice;
                // that bookkeeping belongs to the stored invoice, not to the form.
                const {
                    revision: _revision,
                    updatedAt: _updatedAt,
                    deletedAt: _deletedAt,
                    createdBy: _createdBy,
                    updatedBy: _updatedBy,
                    // Status is changed through setInvoiceStatus, never by the form.
                    status: _status,
                    sentAt: _sentAt,
                    paidAt: _paidAt,
                    ...fields
                } = formData as InvoiceFormData & Partial<Invoice>;
                const today = localToday();
                let statusFields = normalizeStatusFields(existing, today);
                if (options?.status && options.status !== statusFields.status) {
                    const result = transitionStatus(statusFields, options.status, { today });
                    if (result.ok) statusFields = result.fields;
                }

                const newInvoice: Invoice = {
                    ...fields,
                    version: CURRENT_INVOICE_VERSION,
                    ...statusFields,
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

            setInvoiceStatus: (id, change) => {
                const existing = get().invoices.find((inv) => inv.id === id);
                if (!existing) return { ok: false, message: 'Invoice not found' };
                const today = localToday();
                let target: InvoiceStatus | null;
                let paidAt: string | undefined;
                if (typeof change === 'string') {
                    target = actionTarget(change, existing);
                    if (target === null) {
                        return { ok: false, message: `Cannot ${change.replace('_', ' ')} an invoice that is ${statusOf(existing)}` };
                    }
                } else {
                    target = change.status;
                    paidAt = change.paidAt;
                }
                const result = transitionStatus(existing, target, { today, paidAt });
                if (!result.ok || !result.changed) return result;
                set((state) => ({
                    invoices: state.invoices.map((inv) => (inv.id === id ? { ...inv, ...result.fields } : inv)),
                }));
                emitLocalInvoiceChange({ type: 'upsert', id });
                return result;
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

