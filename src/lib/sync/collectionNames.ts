/**
 * Names of the synced collections, in dependency order: a collection may
 * only reference collections listed before it (templates reference clients;
 * invoices reference clients and, as a plain record, templates).
 * Pulls and "upload everything" run in this order. See AGENTS.md "Adding a
 * synced collection".
 *
 * Kept free of imports so storage migrations can use it.
 */
export const SYNCED_COLLECTIONS = ['clients', 'templates', 'invoices'] as const;
export type CollectionName = (typeof SYNCED_COLLECTIONS)[number];

export const isCollectionName = (v: unknown): v is CollectionName =>
  typeof v === 'string' && (SYNCED_COLLECTIONS as readonly string[]).includes(v);

/**
 * Key of an entity in the cloud store's per-entity maps (`bases`,
 * `syncErrors`). Invoices use their bare id (the format of version 1 of the
 * store, read by the invoice list); other collections are prefixed.
 */
export function syncKey(collection: CollectionName, id: string): string {
  return collection === 'invoices' ? id : `${collection}:${id}`;
}
