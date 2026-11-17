/** Sync descriptor for invoice templates (useTemplateStore ↔ /api/v1/templates). */
import type { ApiTemplate, TemplateInput } from '../../../../shared/api';
import type { InvoiceTemplate, TemplateLineItem } from '../../../../shared/types/template';
import { api } from '@/lib/api';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { mergeFields, type SyncCollection } from '../collection';
import { syncKey } from '../collectionNames';

export const TEMPLATE_CONTENT_FIELDS = [
  'name',
  'description',
  'clientId',
  'lineItems',
  'taxRate',
  'currency',
  'notes',
  'paymentDetails',
  'paymentTermsDays',
  'invoiceNamePattern',
  'archivedAt',
] as const;
export type TemplateContentField = (typeof TEMPLATE_CONTENT_FIELDS)[number];

export interface TemplateContent {
  name: string;
  description: string;
  clientId: string | null;
  lineItems: TemplateLineItem[];
  taxRate: number | null;
  currency: string | null;
  notes: string;
  paymentDetails: string;
  paymentTermsDays: number | null;
  invoiceNamePattern: string;
  archivedAt: string | null;
}

const TEMPLATE_FIELD_LABELS: Record<TemplateContentField, string> = {
  name: 'name',
  description: 'description',
  clientId: 'default client',
  lineItems: 'line items',
  taxRate: 'tax rate',
  currency: 'currency',
  notes: 'notes',
  paymentDetails: 'payment details',
  paymentTermsDays: 'payment terms',
  invoiceNamePattern: 'invoice name',
  archivedAt: 'archived state',
};

/** Normalised content (missing optional values become "" / null / []), so equality is structural. */
export function templateContentOf(t: Partial<InvoiceTemplate>): TemplateContent {
  return {
    name: t.name ?? '',
    description: t.description ?? '',
    clientId: t.clientId || null,
    lineItems: (t.lineItems ?? []).map(({ id, description, quantity, price }) => ({ id, description, quantity, price })),
    taxRate: t.taxRate ?? null,
    currency: t.currency || null,
    notes: t.notes ?? '',
    paymentDetails: t.paymentDetails ?? '',
    paymentTermsDays: t.paymentTermsDays ?? null,
    invoiceNamePattern: t.invoiceNamePattern ?? '',
    // Compare instants, not spellings (the server canonicalises timestamps).
    archivedAt: t.archivedAt ? new Date(t.archivedAt).toISOString() : null,
  };
}

const fieldEquals = (field: TemplateContentField, a: TemplateContent, b: TemplateContent) =>
  field === 'lineItems' ? JSON.stringify(a.lineItems) === JSON.stringify(b.lineItems) : a[field] === b[field];

/**
 * Like invoices (collections/invoices.ts): the default-client reference is
 * uploaded only while the client can exist on the server, so a template
 * never fails to sync because its client was deleted.
 */
function uploadableClientId(clientId: string | null): string | null {
  if (!clientId) return null;
  const client = useClientStore.getState().clients.find((c) => c.id === clientId);
  if (!client) return null;
  const refused = syncKey('clients', clientId) in useCloudStore.getState().syncErrors;
  return refused && client.revision === undefined ? null : clientId;
}

export function toTemplateInput(t: InvoiceTemplate): TemplateInput {
  return { ...templateContentOf(t), clientId: uploadableClientId(t.clientId), createdAt: t.createdAt };
}

/** Local representation of a server template: drops the tombstone marker. */
export function fromApiTemplate(api: ApiTemplate): InvoiceTemplate {
  const { deletedAt: _d, ...template } = api;
  return template;
}

function setLocal(id: string, next: InvoiceTemplate, insertIfMissing: boolean): void {
  useTemplateStore.setState((state) => {
    const index = state.templates.findIndex((t) => t.id === id);
    if (index < 0) return insertIfMissing ? { templates: [next, ...state.templates] } : {};
    const templates = [...state.templates];
    templates[index] = next;
    return { templates };
  });
}

export const templateCollection: SyncCollection<InvoiceTemplate, ApiTemplate, TemplateContent> = {
  name: 'templates',
  plural: 'templates',
  fallbackLabel: 'A template',
  label: (t) => `Template “${t.name || 'Untitled'}”`,
  fieldLabel: (field) => TEMPLATE_FIELD_LABELS[field as TemplateContentField] ?? field,

  all: () => useTemplateStore.getState().templates,
  getLocal: (id) => useTemplateStore.getState().templates.find((t) => t.id === id),
  setLocal,
  setAll: (templates) => useTemplateStore.setState({ templates }),
  removeLocal: (id) => useTemplateStore.setState((state) => ({ templates: state.templates.filter((t) => t.id !== id) })),

  listPage: async (p) => {
    const page = await api.listTemplates({ includeDeleted: true, updatedSince: p.updatedSince, afterId: p.afterId });
    return { items: page.templates, syncedAt: page.syncedAt, hasMore: page.hasMore, next: page.next };
  },
  fetchOne: async (id) => (await api.getTemplate(id)).template,
  put: async (local, pre) => (await api.putTemplate(local.id, toTemplateInput(local), pre)).template,
  remove: (id, pre) => api.deleteTemplate(id, pre),

  contentOf: templateContentOf,
  contentEquals: (a, b) => TEMPLATE_CONTENT_FIELDS.every((f) => fieldEquals(f, a, b)),
  merge: (base, local, server) => mergeFields(TEMPLATE_CONTENT_FIELDS, fieldEquals, base, local, server),
  fromServer: fromApiTemplate,
  withContent: (server, merged) => ({ ...fromApiTemplate(server), ...merged }),
  withoutServerState: (t) => {
    const { revision: _r, deletedAt: _d, ...rest } = t;
    return rest;
  },
  dependencies: (t) => (t.clientId ? [{ collection: 'clients', id: t.clientId }] : []),
  // Oldest first, like clients and invoices.
  uploadOrder: (templates) => [...templates].reverse().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
};
