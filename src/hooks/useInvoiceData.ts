import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isTestEnvironment } from "@/lib/utils";
import { useInvoiceStore } from "@/stores/useInvoiceStore";
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

function computeNextInvoiceNumber(invoices: any[]): string {
  const maxNum = invoices.reduce((max, inv) => {
    const num = parseInt((inv.invoiceNumber || inv.invoice_number || "").replace(/\D/g, ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `INV-${String(maxNum + 1).padStart(4, '0')}`;
}

export function useInvoiceData() {
  // Check if we're in test environment to avoid Convex context issues
  const inTestEnv = isTestEnvironment();
  
  // Always call hooks unconditionally (React Rules of Hooks)
  // In test environments, hooks will be called but not invoked
  const auth = useConvexAuth();
  const isAuthenticated = inTestEnv ? false : auth.isAuthenticated;

  const localStore = useInvoiceStore();

  // Query is skipped in test environment or when unauthenticated
  const cloudInvoices = useQuery(api.invoices.list, (!inTestEnv && isAuthenticated) ? {} : "skip");
  const createInvoice = useMutation(api.invoices.create);
  const updateInvoice = useMutation(api.invoices.update);
  const removeInvoice = useMutation(api.invoices.remove);
  const getNextNumberMutation = useMutation(api.invoices.getNextInvoiceNumber);

  const saveInvoice = useCallback(
    async (formData: InvoiceFormData, id?: string) => {
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
        // In test environment or when not authenticated, always use local store
        return localStore.saveInvoice(formData, id);
      }
    },
    [inTestEnv, isAuthenticated, createInvoice, updateInvoice, localStore]
  );

  const deleteInvoice = useCallback(
      async (id: string) => {
          if (!inTestEnv && isAuthenticated) {
              await removeInvoice({ id: id as Id<"invoices"> });
          } else {
              localStore.deleteInvoice(id);
          }
      },
      [inTestEnv, isAuthenticated, removeInvoice, localStore]
  );
  
  const getInvoice = useCallback((id: string) => {
      if (!inTestEnv && isAuthenticated) {
          const doc = cloudInvoices?.find((inv: any) => inv._id === id || inv.id === id); 
          return doc ? mapDocToInvoice(doc) : undefined;
      } else {
          return localStore.getInvoice(id);
      }
  }, [inTestEnv, isAuthenticated, cloudInvoices, localStore]);

    const cachedNextInvoiceNumber = useMemo(() => {
        if (!inTestEnv && isAuthenticated && cloudInvoices) {
            return computeNextInvoiceNumber(cloudInvoices);
        } else {
            return localStore.getNextInvoiceNumber();
        }
    }, [inTestEnv, isAuthenticated, cloudInvoices, localStore]);

    if (!inTestEnv && isAuthenticated) {
        const mappedInvoices: Invoice[] = (cloudInvoices || []).map(mapDocToInvoice);

        return {
            invoices: mappedInvoices,
            isLoading: cloudInvoices === undefined,
            saveInvoice,
            deleteInvoice,
            getInvoice,
            getNextInvoiceNumber: cachedNextInvoiceNumber,
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
      getNextInvoiceNumber: cachedNextInvoiceNumber,
      saveDraft: localStore.saveDraft,
      loadDraft: localStore.loadDraft,
      clearDraft: localStore.clearDraft,
      source: 'local' as const
  };
}
