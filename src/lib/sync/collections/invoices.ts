/** Sync descriptor for invoices (useInvoiceStore ↔ /api/v1/invoices). */
import type { ApiInvoice } from '../../../../shared/api';
import type { Invoice } from '@/types/invoice';
import { api } from '@/lib/api';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { useCloudStore } from '@/stores/useCloudStore';
import type { SyncCollection } from '../collection';
import { syncKey } from '../collectionNames';
import {
  contentEquals,
  contentOf,
  FIELD_LABELS,
  fromApiInvoice,
  mergeContent,
  toInvoiceInput,
  withoutServerState,
  type ContentField,
  type InvoiceContent,
} from '../fields';

/**
 * The client reference is uploaded only while the client can exist on the
 * server: it is still saved here and was not refused by the server. A
 * reference to a client deleted (or never uploadable) is dropped from the
 * upload rather than making the whole invoice fail; the invoice keeps its
 * own copy of the client's details either way.
 */
function uploadableClientId(clientId: string | undefined): string | undefined {
  if (!clientId) return undefined;
  const client = useClientStore.getState().clients.find((c) => c.id === clientId);
  if (!client) return undefined;
  const refused = syncKey('clients', clientId) in useCloudStore.getState().syncErrors;
  return refused && client.revision === undefined ? undefined : clientId;
}

function setLocal(id: string, next: Invoice, insertIfMissing: boolean): void {
  useInvoiceStore.setState((state) => {
    const index = state.invoices.findIndex((inv) => inv.id === id);
    if (index < 0) return insertIfMissing ? { invoices: [next, ...state.invoices] } : {};
    const invoices = [...state.invoices];
    invoices[index] = next;
    return { invoices };
  });
}

export const invoiceCollection: SyncCollection<Invoice, ApiInvoice, InvoiceContent> = {
  name: 'invoices',
  plural: 'invoices',
  fallbackLabel: 'An invoice',
  label: (invoice) => invoice.invoiceNumber,
  fieldLabel: (field) => FIELD_LABELS[field as ContentField] ?? field,

  all: () => useInvoiceStore.getState().invoices,
  getLocal: (id) => useInvoiceStore.getState().invoices.find((inv) => inv.id === id),
  setLocal,
  setAll: (invoices) => useInvoiceStore.setState({ invoices }),
  removeLocal: (id) => useInvoiceStore.setState((state) => ({ invoices: state.invoices.filter((inv) => inv.id !== id) })),

  listPage: async (p) => {
    const page = await api.listInvoices({ includeDeleted: true, updatedSince: p.updatedSince, afterId: p.afterId });
    return { items: page.invoices, syncedAt: page.syncedAt, hasMore: page.hasMore, next: page.next };
  },
  fetchOne: async (id) => (await api.getInvoice(id)).invoice,
  put: async (local, pre) => {
    const input = toInvoiceInput(local);
    const clientId = uploadableClientId(local.clientId);
    if (clientId) input.clientId = clientId;
    else delete input.clientId;
    return (await api.putInvoice(local.id, input, pre)).invoice;
  },
  remove: (id, pre) => api.deleteInvoice(id, pre),

  contentOf,
  contentEquals,
  merge: (base, local, server) => mergeContent(base, local, server),
  fromServer: fromApiInvoice,
  withContent: (server, merged, local) => {
    const next: Invoice = { ...fromApiInvoice(server), ...merged, invoiceName: merged.invoiceName || local.invoiceName };
    if (!next.clientId) delete next.clientId;
    return next;
  },
  withoutServerState,
  dependencies: (invoice) => (invoice.clientId ? [{ collection: 'clients', id: invoice.clientId }] : []),
  // The store lists newest first; reverse so ties keep creation order, then sort (stable) by createdAt.
  uploadOrder: (invoices) => [...invoices].reverse().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
};
