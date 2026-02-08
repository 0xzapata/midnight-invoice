import { Id } from '../../convex/_generated/dataModel';

export interface InvoiceSubscriptionEvent {
  type: 'storage' | 'network' | 'remote';
  invoiceId?: Id<'invoices'>;
  timestamp: number;
}

export function useInvoiceSubscription() {
  const subscribe = (callback: (event: InvoiceSubscriptionEvent) => void) => {
    let subscribed = true;

    const handleStorage = (e: globalThis.StorageEvent) => {
      if (!subscribed || e.key !== 'invoices') return;

      let invoiceId: Id<'invoices'> | undefined;
      if (e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          invoiceId = parsed._id;
        } catch {
          invoiceId = undefined;
        }
      }

      callback({
        type: 'storage',
        invoiceId,
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
