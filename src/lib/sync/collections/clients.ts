/** Sync descriptor for saved clients (useClientStore ↔ /api/v1/clients). */
import type { ApiClientRecord, ClientInput } from '../../../../shared/api';
import type { Client } from '../../../../shared/types/client';
import { api } from '@/lib/api';
import { useClientStore } from '@/stores/useClientStore';
import { mergeFields, type SyncCollection } from '../collection';

export const CLIENT_CONTENT_FIELDS = [
  'name',
  'email',
  'address',
  'defaultCurrency',
  'defaultTaxRate',
  'paymentTermsDays',
  'notes',
  'archivedAt',
] as const;
export type ClientContentField = (typeof CLIENT_CONTENT_FIELDS)[number];

export interface ClientContent {
  name: string;
  email: string;
  address: string;
  defaultCurrency: string | null;
  defaultTaxRate: number | null;
  paymentTermsDays: number | null;
  notes: string;
  archivedAt: string | null;
}

const CLIENT_FIELD_LABELS: Record<ClientContentField, string> = {
  name: 'name',
  email: 'email',
  address: 'address',
  defaultCurrency: 'default currency',
  defaultTaxRate: 'default tax rate',
  paymentTermsDays: 'payment terms',
  notes: 'notes',
  archivedAt: 'archived state',
};

/** Normalised content (missing optional values become "" / null), so equality is structural. */
export function clientContentOf(c: Partial<Client>): ClientContent {
  return {
    name: c.name ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    defaultCurrency: c.defaultCurrency ?? null,
    defaultTaxRate: c.defaultTaxRate ?? null,
    paymentTermsDays: c.paymentTermsDays ?? null,
    notes: c.notes ?? '',
    // Compare instants, not spellings (the server canonicalises timestamps).
    archivedAt: c.archivedAt ? new Date(c.archivedAt).toISOString() : null,
  };
}

const fieldEquals = (field: ClientContentField, a: ClientContent, b: ClientContent) => a[field] === b[field];

export function toClientInput(c: Client): ClientInput {
  return { ...clientContentOf(c), createdAt: c.createdAt };
}

/** Local representation of a server client: drops computed fields and the tombstone marker. */
export function fromApiClient(api: ApiClientRecord): Client {
  const { deletedAt: _d, invoiceCount: _n, ...client } = api;
  return client;
}

function setLocal(id: string, next: Client, insertIfMissing: boolean): void {
  useClientStore.setState((state) => {
    const index = state.clients.findIndex((c) => c.id === id);
    if (index < 0) return insertIfMissing ? { clients: [next, ...state.clients] } : {};
    const clients = [...state.clients];
    clients[index] = next;
    return { clients };
  });
}

export const clientCollection: SyncCollection<Client, ApiClientRecord, ClientContent> = {
  name: 'clients',
  plural: 'clients',
  fallbackLabel: 'A client',
  label: (c) => `Client “${c.name || 'Unnamed'}”`,
  fieldLabel: (field) => CLIENT_FIELD_LABELS[field as ClientContentField] ?? field,

  all: () => useClientStore.getState().clients,
  getLocal: (id) => useClientStore.getState().clients.find((c) => c.id === id),
  setLocal,
  setAll: (clients) => useClientStore.setState({ clients }),
  removeLocal: (id) => useClientStore.setState((state) => ({ clients: state.clients.filter((c) => c.id !== id) })),

  listPage: async (p) => {
    const page = await api.listClients({ includeDeleted: true, updatedSince: p.updatedSince, afterId: p.afterId });
    return { items: page.clients, syncedAt: page.syncedAt, hasMore: page.hasMore, next: page.next };
  },
  fetchOne: async (id) => (await api.getClient(id)).client,
  put: async (local, pre) => (await api.putClient(local.id, toClientInput(local), pre)).client,
  remove: (id, pre) => api.deleteClient(id, pre),

  contentOf: clientContentOf,
  contentEquals: (a, b) => CLIENT_CONTENT_FIELDS.every((f) => fieldEquals(f, a, b)),
  merge: (base, local, server) => mergeFields(CLIENT_CONTENT_FIELDS, fieldEquals, base, local, server),
  fromServer: fromApiClient,
  withContent: (server, merged) => ({ ...fromApiClient(server), ...merged }),
  withoutServerState: (c) => {
    const { revision: _r, deletedAt: _d, ...rest } = c;
    return rest;
  },
  // Oldest first, like invoices.
  uploadOrder: (clients) => [...clients].reverse().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
};
