/**
 * Tiny event hook between useInvoiceStore (which must not depend on the sync
 * engine) and the engine: the store reports changes the *user* made; changes
 * applied from the server bypass it, so they are never echoed back.
 */
import type { Invoice } from '@/types/invoice';

export type LocalInvoiceChange =
  | { type: 'upsert'; id: string }
  | { type: 'delete'; id: string; invoice: Invoice };

type Listener = (change: LocalInvoiceChange) => void;

let listener: Listener | null = null;

export function setLocalInvoiceChangeListener(next: Listener | null): void {
  listener = next;
}

export function emitLocalInvoiceChange(change: LocalInvoiceChange): void {
  listener?.(change);
}
