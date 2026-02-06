import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id, Doc } from '../../convex/_generated/dataModel';

export function useOptimisticUpdates() {
  const updateInvoice = useMutation(api.invoices.update);
  const removeInvoice = useMutation(api.invoices.remove);
  
  const invoicesQuery = useQuery(api.invoices.list);
  
  return {
    optimisticUpdate: async (id: string, updates: Partial<Doc<'invoices'>>) => {
      const current = invoicesQuery.find(inv => inv._id === id || inv.id === id);
      
      if (current) {
        await updateInvoice({
          id: id as Id<'invoices'>,
          ...updates,
        });
        
        return current;
      }
      
      return null;
    },
    
    optimisticDelete: async (id: string) => {
      await removeInvoice({ id: id as Id<'invoices'> });
    },
  };
}
