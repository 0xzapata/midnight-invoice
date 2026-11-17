/**
 * Tiny event hook between the local stores (which must not depend on the
 * sync engine) and the engine: stores report changes the *user* made;
 * changes applied from the server bypass it, so they are never echoed back.
 */
import type { Invoice } from '@/types/invoice';
import type { CollectionName } from './collectionNames';

/** A local entity as the engine sees it: an id plus optional sync metadata. */
export interface LocalEntityLike {
  id: string;
  revision?: number;
}

export type LocalChange =
  | { collection: CollectionName; type: 'upsert'; id: string }
  | { collection: CollectionName; type: 'delete'; id: string; entity: LocalEntityLike };

type Listener = (change: LocalChange) => void;

let listener: Listener | null = null;

export function setLocalChangeListener(next: Listener | null): void {
  listener = next;
}

export function emitLocalChange(change: LocalChange): void {
  listener?.(change);
}

/** Invoice changes (emitted by useInvoiceStore). */
export type LocalInvoiceChange =
  | { type: 'upsert'; id: string }
  | { type: 'delete'; id: string; invoice: Invoice };

export function emitLocalInvoiceChange(change: LocalInvoiceChange): void {
  emitLocalChange(
    change.type === 'upsert'
      ? { collection: 'invoices', type: 'upsert', id: change.id }
      : { collection: 'invoices', type: 'delete', id: change.id, entity: change.invoice },
  );
}
