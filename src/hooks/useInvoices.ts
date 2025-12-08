import { useInvoiceStore, useHasHydrated } from '@/stores/useInvoiceStore';

/**
 * Backwards-compatible hook wrapping the Zustand invoice store.
 * Components can continue using this hook without changes.
 */
export function useInvoices() {
  const store = useInvoiceStore();
  const hasHydrated = useHasHydrated();

  return {
    invoices: store.invoices,
    isLoading: !hasHydrated,
    saveInvoice: store.saveInvoice,
    deleteInvoice: store.deleteInvoice,
    getInvoice: store.getInvoice,
    getNextInvoiceNumber: store.getNextInvoiceNumber(),
    saveDraft: store.saveDraft,
    loadDraft: store.loadDraft,
    clearDraft: store.clearDraft,
    // No longer needed with Zustand, kept for API compatibility
    refreshInvoices: () => { },
  };
}

// Re-export hydration hook for direct usage
export { useHasHydrated };