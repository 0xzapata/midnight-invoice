import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Invoice, InvoiceFormData } from '@/types/invoice';

// Creative session name generators
const adjectives = ['Cosmic', 'Swift', 'Golden', 'Stellar', 'Bright', 'Noble', 'Grand', 'Prime', 'Royal', 'Epic'];
const nouns = ['Phoenix', 'Dragon', 'Thunder', 'Aurora', 'Nexus', 'Zenith', 'Summit', 'Pulse', 'Wave', 'Spark'];

function generateCreativeSessionName(): string {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj} ${noun} ${num}`;
}

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

export const useInvoiceStore = create<InvoiceState>()(
    persist(
        (set, get) => ({
            invoices: [],
            drafts: {},
            _hasHydrated: false,

            setHasHydrated: (value) => set({ _hasHydrated: value }),

            saveInvoice: (formData, id) => {
                const invoiceName = formData.invoiceName || generateCreativeSessionName();
                const invoiceId = id || crypto.randomUUID();

                const newInvoice: Invoice = {
                    ...formData,
                    invoiceName,
                    id: invoiceId,
                    createdAt: new Date().toISOString(),
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

                return newInvoice;
            },

            deleteInvoice: (id) => {
                set((state) => ({
                    invoices: state.invoices.filter((inv) => inv.id !== id),
                }));
            },

            getInvoice: (id) => {
                return get().invoices.find((inv) => inv.id === id);
            },

            getNextInvoiceNumber: () => {
                const { invoices } = get();
                const maxNum = invoices.reduce((max, inv) => {
                    const num = parseInt(inv.invoiceNumber.replace(/\D/g, ''), 10);
                    return isNaN(num) ? max : Math.max(max, num);
                }, 0);
                return `INV-${String(maxNum + 1).padStart(4, '0')}`;
            },

            saveDraft: (id, formData) => {
                set((state) => ({
                    drafts: { ...state.drafts, [id]: formData },
                }));
            },

            loadDraft: (id) => {
                return get().drafts[id] || null;
            },

            clearDraft: (id) => {
                set((state) => {
                    const { [id]: _, ...remainingDrafts } = state.drafts;
                    return { drafts: remainingDrafts };
                });
            },
        }),
        {
            name: 'invoice-storage',
            partialize: (state) => ({
                invoices: state.invoices,
                drafts: state.drafts,
            }),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);

// Selector for hydration status
export const useHasHydrated = () => useInvoiceStore((state) => state._hasHydrated);
