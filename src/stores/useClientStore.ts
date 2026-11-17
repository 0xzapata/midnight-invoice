import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clientDedupeKey, type Client, type ClientFormData } from '../../shared/types/client';
import type { Invoice } from '@/types/invoice';
import { CURRENT_CLIENT_VERSION, migrateClientStore, type ClientPersistedState } from '@/lib/storageMigrations';
import { emitLocalChange } from '@/lib/sync/localChanges';

export const CLIENT_STORAGE_KEY = 'client-storage';

interface ClientState {
  clients: Client[];
  _hasHydrated: boolean;

  setHasHydrated: (value: boolean) => void;
  saveClient: (data: ClientFormData, id?: string) => Client;
  setArchived: (id: string, archived: boolean) => void;
  deleteClient: (id: string) => void;
  getClient: (id: string) => Client | undefined;
  /** Creates a client for every distinct (normalised name + email) Bill To of `invoices` that is not saved yet. */
  importFromInvoices: (invoices: Invoice[]) => Client[];
}

const clean = (data: ClientFormData) => ({
  name: data.name.trim(),
  email: data.email.trim(),
  address: data.address.trim(),
  defaultCurrency: data.defaultCurrency || null,
  defaultTaxRate: typeof data.defaultTaxRate === 'number' && Number.isFinite(data.defaultTaxRate) ? data.defaultTaxRate : null,
  paymentTermsDays: typeof data.paymentTermsDays === 'number' && Number.isFinite(data.paymentTermsDays) ? Math.round(data.paymentTermsDays) : null,
  notes: data.notes ?? '',
});

/**
 * Saved clients (address book), local-first like invoices: persisted in
 * localStorage, works offline and without cloud sync. User edits are reported
 * to the sync engine through emitLocalChange; changes applied from the server
 * use setState directly so they are never echoed back.
 */
export const useClientStore = create<ClientState>()(
  persist(
    (set, get) => ({
      clients: [],
      _hasHydrated: false,
      setHasHydrated: (value) => set({ _hasHydrated: value }),

      saveClient: (data, id) => {
        const clientId = id || crypto.randomUUID();
        const existing = get().clients.find((c) => c.id === clientId);
        const now = new Date().toISOString();
        const client: Client = {
          ...clean(data),
          id: clientId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          archivedAt: existing?.archivedAt ?? null,
          // Sync metadata: the last known server revision is the base for the next upload.
          ...(existing?.revision !== undefined && { revision: existing.revision }),
          ...(existing?.createdBy && { createdBy: existing.createdBy }),
          ...(existing?.updatedBy && { updatedBy: existing.updatedBy }),
        };
        set((state) => {
          const index = state.clients.findIndex((c) => c.id === clientId);
          if (index < 0) return { clients: [client, ...state.clients] };
          const clients = [...state.clients];
          clients[index] = client;
          return { clients };
        });
        emitLocalChange({ collection: 'clients', type: 'upsert', id: clientId });
        return client;
      },

      setArchived: (id, archived) => {
        const existing = get().clients.find((c) => c.id === id);
        if (!existing || !!existing.archivedAt === archived) return;
        const now = new Date().toISOString();
        set((state) => ({
          clients: state.clients.map((c) => (c.id === id ? { ...c, archivedAt: archived ? now : null, updatedAt: now } : c)),
        }));
        emitLocalChange({ collection: 'clients', type: 'upsert', id });
      },

      deleteClient: (id) => {
        const existing = get().clients.find((c) => c.id === id);
        set((state) => ({ clients: state.clients.filter((c) => c.id !== id) }));
        if (existing) emitLocalChange({ collection: 'clients', type: 'delete', id, entity: existing });
      },

      getClient: (id) => get().clients.find((c) => c.id === id),

      importFromInvoices: (invoices) => {
        const known = new Set(get().clients.map((c) => clientDedupeKey(c)));
        // Newest invoice first, so each new client gets its most recent address.
        const sorted = [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const created: Client[] = [];
        for (const invoice of sorted) {
          if (!invoice.toName?.trim()) continue;
          const key = clientDedupeKey(invoice);
          if (known.has(key)) continue;
          known.add(key);
          created.push(
            get().saveClient({ name: invoice.toName, email: invoice.toEmail ?? '', address: invoice.toAddress ?? '' }),
          );
        }
        return created;
      },
    }),
    {
      name: CLIENT_STORAGE_KEY,
      version: CURRENT_CLIENT_VERSION,
      migrate: migrateClientStore,
      partialize: (state): ClientPersistedState => ({ clients: state.clients }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Failed to rehydrate client store from localStorage:', error);
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** Live (not archived) clients sorted by name, for pickers. */
export function activeClientsSorted(clients: Client[]): Client[] {
  return clients.filter((c) => !c.archivedAt).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Invoices billed to `client`: those referencing it by id, plus older
 * invoices without a client reference whose Bill To matches its name and
 * email (e.g. the ones it was imported from).
 */
export function invoicesForClient(client: Client, invoices: Invoice[]): Invoice[] {
  const key = clientDedupeKey(client);
  return invoices.filter((inv) => (inv.clientId ? inv.clientId === client.id : clientDedupeKey(inv) === key));
}
