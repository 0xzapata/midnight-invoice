import { useInvoiceData } from './useInvoiceData';
import { useHasHydrated } from '@/stores/useInvoiceStore';

/**
 * Backwards-compatible hook wrapping the unified invoice data hook.
 * Components can continue using this hook without changes.
 */
export function useInvoices() {
  const invoiceData = useInvoiceData();

  return {
    ...invoiceData,
    // No longer needed, kept for API compatibility
    refreshInvoices: () => { },
  };
}

// Re-export hydration hook for direct usage
export { useHasHydrated };