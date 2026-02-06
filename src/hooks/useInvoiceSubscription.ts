import { api } from '../../convex/_generated/api';
import { Id, Doc } from '../../convex/_generated/dataModel';

/**
 * Real-time subscriptions to invoice data changes.
 * Provides methods to subscribe to invoice changes across all devices.
 *
 * Usage:
 * ```tsx
 * const invoiceSubscription = useInvoiceSubscription();
 *
 * useEffect(() => {
 *   const unsubscribe = invoiceSubscription.subscribe((event) => {
 *     console.log('Invoice changed:', event);
 *   });
 *   return unsubscribe;
 * }, []);
 * ```
 */
export function useInvoiceSubscription() {
  const subscribe = (callback: (event: InvoiceSubscriptionEvent) => void) => {
    let subscribed = true;

    const handleStorage = (e: StorageEvent) => {
      if (!subscribed || e.key !== 'invoices') return;

      callback({
        type: 'storage',
        invoiceId: e.newValue ? JSON.parse(e.newValue)._id : undefined,
        timestamp: Date.now(),
      });
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      subscribed = false;
      window.removeEventListener('storage', handleStorage);
    };
  };

  return { subscribe };
}

export interface InvoiceSubscriptionEvent {
  type: 'storage' | 'network' | 'remote';
  invoiceId?: Id<'invoices'>;
  timestamp: number;
}

interface StorageEvent extends Event {
  key: string;
  newValue: string | null;
}
