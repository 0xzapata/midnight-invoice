import { useState, useEffect } from 'react';
import { useInvoiceData } from '@/hooks/useInvoiceData';
import { useInvoiceSubscription } from '@/hooks/useInvoiceSubscription';
import { Invoice } from '@/types/invoice';
import { ConflictResolutionModal } from '@/components/modals/ConflictResolutionModal';
import { useOptimisticUpdates } from '@/hooks/useOptimisticUpdates';

export function ConflictDetectionWrapper() {
  const { getInvoice } = useInvoiceData();
  const { subscribe } = useInvoiceSubscription();
  const { optimisticDelete } = useOptimisticUpdates();
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [localInvoice, setLocalInvoice] = useState<Invoice | null>(null);
  const [cloudInvoice, setCloudInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === 'storage' && event.invoiceId) {
        const current = getInvoice(event.invoiceId);

        if (current) {
          setLocalInvoice(current);
          setShowConflictModal(true);
        }
      }
    });

    return () => unsubscribe();
  }, [getInvoice, subscribe]);

  const handleResolve = async (action: 'local' | 'cloud' | 'merge') => {
    if (!localInvoice || !cloudInvoice) return;

    try {
      if (action === 'local') {
        await optimisticDelete(cloudInvoice.id);
        setShowConflictModal(false);
        setCloudInvoice(null);
      } else if (action === 'cloud') {
        await optimisticDelete(localInvoice.id);
        setShowConflictModal(false);
        setLocalInvoice(null);
      } else if (action === 'merge') {
        setShowConflictModal(false);
      }
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
      alert('Failed to resolve conflict. Please try again.');
    }
  };

  const handleCancel = () => {
    setShowConflictModal(false);
    setLocalInvoice(null);
    setCloudInvoice(null);
  };

  return (
    <>
      {showConflictModal && localInvoice && cloudInvoice && (
        <ConflictResolutionModal
          isOpen={showConflictModal}
          onClose={handleCancel}
          localInvoice={localInvoice}
          cloudInvoice={cloudInvoice}
          onResolve={handleResolve}
        />
      )}
    </>
  );
}
