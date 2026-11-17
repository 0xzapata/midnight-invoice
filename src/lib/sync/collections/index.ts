/**
 * Registry of synced collections, keyed by name. Adding a collection: write
 * its descriptor (see collection.ts), add its name to SYNCED_COLLECTIONS in
 * dependency order, and register it here. AGENTS.md has the full checklist.
 */
import type { SyncCollection } from '../collection';
import { SYNCED_COLLECTIONS, type CollectionName } from '../collectionNames';
import { clientCollection } from './clients';
import { invoiceCollection } from './invoices';

export const COLLECTIONS: Record<CollectionName, SyncCollection> = {
  clients: clientCollection as unknown as SyncCollection,
  invoices: invoiceCollection as unknown as SyncCollection,
};

/** Descriptors in dependency order (referenced collections first). */
export const orderedCollections = (): SyncCollection[] => SYNCED_COLLECTIONS.map((name) => COLLECTIONS[name]);
