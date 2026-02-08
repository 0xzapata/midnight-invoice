import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isTestEnvironment } from "@/lib/utils";
import { useInvoiceStore } from "@/stores/useInvoiceStore";
import { useSyncStore } from "@/stores/useSyncStore";
import { useTeamContext } from "@/stores/useTeamContext";
import { Invoice, InvoiceFormData } from "@/types/invoice";
import { useCallback, useMemo } from "react";
import { Doc, Id } from "../../convex/_generated/dataModel";

function mapDocToInvoice(doc: Doc<"invoices">): Invoice {
  return {
    ...doc,
    id: doc._id,
    status: doc.status,
    createdAt: doc._creationTime ? new Date(doc._creationTime).toISOString() : new Date().toISOString(),
    toName: doc.clientSnapshot?.name || "",
    toEmail: doc.clientSnapshot?.email || "",
    toAddress: doc.clientSnapshot?.address || "",
  };
}

function computeNextInvoiceNumber(invoices: Doc<"invoices">[]): string {
  const maxNum = invoices.reduce((max, inv) => {
    const num = parseInt((inv.invoiceNumber || "").replace(/\D/g, ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `INV-${String(maxNum + 1).padStart(4, '0')}`;
}

export function useInvoiceData() {
  const inTestEnv = isTestEnvironment();
  const auth = useConvexAuth();
  const isAuthenticated = inTestEnv ? false : auth.isAuthenticated;
  const { startSync, completeSync } = useSyncStore();
  const localStore = useInvoiceStore();
  const { currentTeamId } = useTeamContext();
  
  const cloudInvoices = useQuery(
    api.invoices.list, 
    (!inTestEnv && isAuthenticated) 
      ? { teamId: currentTeamId as Id<"teams"> | undefined } 
      : "skip"
  );
  const createInvoice = useMutation(api.invoices.create);
  const updateInvoice = useMutation(api.invoices.update);
  const removeInvoice = useMutation(api.invoices.remove);
  const getNextInvoiceNumberMutation = useMutation(api.invoices.getNextInvoiceNumber);

  const saveInvoice = useCallback(
    async (formData: InvoiceFormData, id?: string) => {
      startSync();
      
      try {
        if (!inTestEnv && isAuthenticated) {
          if (id) {
            const { toName, toEmail, toAddress, ...rest } = formData;
            await updateInvoice({
              id: id as Id<"invoices">,
              ...rest,
              clientSnapshot: {
                name: toName,
                email: toEmail,
                address: toAddress,
              },
            });
            return { ...formData, id } as Invoice;
          } else {
            const { toName, toEmail, toAddress, ...rest } = formData;
            const newId = await createInvoice({
              ...rest,
              teamId: currentTeamId as Id<"teams"> | undefined,
              clientSnapshot: {
                name: toName,
                email: toEmail,
                address: toAddress,
              },
              status: "draft"
            });
            return { ...formData, id: newId, createdAt: new Date().toISOString() } as Invoice;
          }
        } else {
          try {
            const saved = localStore.saveInvoice(formData, id);
            return saved;
          } finally {
            completeSync();
          }
        }
      } catch (error) {
        console.error('Failed to save invoice:', error);
        throw error;
      } finally {
        if (!inTestEnv && isAuthenticated) {
          completeSync();
        }
      }
    },
    [inTestEnv, isAuthenticated, createInvoice, updateInvoice, localStore, startSync, completeSync, currentTeamId]
  );

  const deleteInvoice = useCallback(
    async (id: string) => {
      startSync();
      
      try {
        if (!inTestEnv && isAuthenticated) {
          await removeInvoice({ id: id as Id<"invoices"> });
        } else {
          localStore.deleteInvoice(id);
        }
      } catch (error) {
        console.error('Failed to delete invoice:', error);
        throw error;
      } finally {
        completeSync();
      }
    },
    [inTestEnv, isAuthenticated, removeInvoice, localStore, startSync, completeSync]
  );
  
  const getInvoice = useCallback((id: string) => {
    if (!inTestEnv && isAuthenticated) {
      const doc = cloudInvoices?.find((inv) => inv._id === id); 
      return doc ? mapDocToInvoice(doc) : undefined;
    } else {
      return localStore.getInvoice(id);
    }
  }, [inTestEnv, isAuthenticated, cloudInvoices, localStore]);

  const getNextInvoiceNumber = useCallback(async () => {
    if (!inTestEnv && isAuthenticated) {
      return await getNextInvoiceNumberMutation({ teamId: currentTeamId as Id<"teams"> | undefined });
    } else {
      return localStore.getNextInvoiceNumber();
    }
  }, [inTestEnv, isAuthenticated, getNextInvoiceNumberMutation, localStore, currentTeamId]);

  if (!inTestEnv && isAuthenticated) {
    const mappedInvoices: Invoice[] = (cloudInvoices || []).map(mapDocToInvoice);

    return {
      invoices: mappedInvoices,
      isLoading: cloudInvoices === undefined,
      saveInvoice,
      deleteInvoice,
      getInvoice,
      getNextInvoiceNumber,
      saveDraft: localStore.saveDraft,
      loadDraft: localStore.loadDraft,
      clearDraft: localStore.clearDraft,
      source: 'cloud' as const
    };
  }

  return {
    invoices: localStore.invoices,
    isLoading: !localStore._hasHydrated,
    saveInvoice,
    deleteInvoice,
    getInvoice,
    getNextInvoiceNumber,
    saveDraft: localStore.saveDraft,
    loadDraft: localStore.loadDraft,
    clearDraft: localStore.clearDraft,
    source: 'local' as const
  };
}
