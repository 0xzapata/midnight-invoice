/**
 * Invoice content as far as sync is concerned: the fields a person edits in
 * the invoice form. Server metadata (revision, updatedAt, createdBy…) and
 * computed totals are not content.
 */
import type { ApiInvoice, InvoiceInput } from '../../../shared/api';
import type { Invoice, LineItem } from '@/types/invoice';
import { statusOf, type InvoiceStatus } from '../../../shared/invoice-status';

export const CONTENT_FIELDS = [
  'invoiceNumber',
  'invoiceName',
  'issueDate',
  'dueDate',
  'fromName',
  'fromAddress',
  'fromEmail',
  'toName',
  'toAddress',
  'toEmail',
  'lineItems',
  'taxRate',
  'notes',
  'paymentDetails',
  'currency',
  // One merge unit: status together with its dates (sentAt, paidAt), so a
  // merge never pairs one side's status with the other side's dates.
  'status',
] as const;

export type ContentField = (typeof CONTENT_FIELDS)[number];

export interface InvoiceContent {
  invoiceNumber: string;
  invoiceName: string;
  issueDate: string;
  dueDate: string;
  fromName: string;
  fromAddress: string;
  fromEmail: string;
  toName: string;
  toAddress: string;
  toEmail: string;
  lineItems: LineItem[];
  taxRate: number;
  notes: string;
  paymentDetails: string;
  currency: string;
  status: InvoiceStatus;
  sentAt: string | null;
  paidAt: string | null;
}

/** Human labels for conflict messages. */
export const FIELD_LABELS: Record<ContentField, string> = {
  invoiceNumber: 'invoice number',
  invoiceName: 'name',
  issueDate: 'issue date',
  dueDate: 'due date',
  fromName: 'your name',
  fromAddress: 'your address',
  fromEmail: 'your email',
  toName: 'client name',
  toAddress: 'client address',
  toEmail: 'client email',
  lineItems: 'line items',
  taxRate: 'tax rate',
  notes: 'notes',
  paymentDetails: 'payment details',
  currency: 'currency',
  status: 'status',
};

/** Normalised content (missing optional strings become ""), so equality is structural. */
export function contentOf(invoice: Partial<Invoice>): InvoiceContent {
  return {
    invoiceNumber: invoice.invoiceNumber ?? '',
    invoiceName: invoice.invoiceName ?? '',
    issueDate: invoice.issueDate ?? '',
    dueDate: invoice.dueDate ?? '',
    fromName: invoice.fromName ?? '',
    fromAddress: invoice.fromAddress ?? '',
    fromEmail: invoice.fromEmail ?? '',
    toName: invoice.toName ?? '',
    toAddress: invoice.toAddress ?? '',
    toEmail: invoice.toEmail ?? '',
    lineItems: (invoice.lineItems ?? []).map(({ id, description, quantity, price }) => ({ id, description, quantity, price })),
    taxRate: invoice.taxRate ?? 0,
    notes: invoice.notes ?? '',
    paymentDetails: invoice.paymentDetails ?? '',
    currency: invoice.currency ?? 'USD',
    status: statusOf(invoice),
    sentAt: invoice.sentAt || null,
    paidAt: invoice.paidAt || null,
  };
}

export function fieldEquals(field: ContentField, a: InvoiceContent, b: InvoiceContent): boolean {
  if (field === 'lineItems') return JSON.stringify(a.lineItems) === JSON.stringify(b.lineItems);
  // Merge bases persisted before statuses existed have no status fields: they mean draft.
  if (field === 'status') {
    return statusOf(a) === statusOf(b) && (a.sentAt || null) === (b.sentAt || null) && (a.paidAt || null) === (b.paidAt || null);
  }
  return a[field] === b[field];
}

export function contentEquals(a: InvoiceContent, b: InvoiceContent): boolean {
  return CONTENT_FIELDS.every((f) => fieldEquals(f, a, b));
}

export interface MergeResult {
  merged: InvoiceContent;
  /** Fields only this browser changed (kept). */
  localFields: ContentField[];
  /** Fields both sides changed to different values: the server's value was kept. */
  conflicts: ContentField[];
}

/**
 * Three-way merge of a local edit with a newer server version, relative to
 * the last version both sides agreed on (`base`).
 *
 * Rule: a field changed only here keeps the local value; a field changed only
 * on the server takes the server value; a field changed on both sides to
 * different values keeps the **server** value (the local edit of that field
 * is discarded and reported). Line items count as one field. Without a base
 * (never synced from this browser) every differing field is a conflict.
 */
export function mergeContent(base: InvoiceContent | null, local: InvoiceContent, server: InvoiceContent): MergeResult {
  const merged = { ...server, lineItems: server.lineItems.map((li) => ({ ...li })) };
  const localFields: ContentField[] = [];
  const conflicts: ContentField[] = [];
  for (const field of CONTENT_FIELDS) {
    if (fieldEquals(field, local, server)) continue;
    const localChanged = base === null || !fieldEquals(field, local, base);
    const serverChanged = base === null || !fieldEquals(field, server, base);
    if (localChanged && !serverChanged) {
      (merged as Record<ContentField, unknown>)[field] = field === 'lineItems' ? local.lineItems.map((li) => ({ ...li })) : local[field];
      if (field === 'status') {
        merged.sentAt = local.sentAt;
        merged.paidAt = local.paidAt;
      }
      localFields.push(field);
    } else if (localChanged && serverChanged) {
      conflicts.push(field);
    }
  }
  return { merged, localFields, conflicts };
}

/** PUT body for an invoice (createdAt is honoured only when the PUT creates it). */
export function toInvoiceInput(invoice: Invoice): InvoiceInput {
  const c = contentOf(invoice);
  const input: InvoiceInput = { ...c, createdAt: invoice.createdAt };
  if (!c.invoiceName) delete input.invoiceName;
  return input;
}

/** Local representation of a server invoice: drops computed totals and the tombstone marker. */
export function fromApiInvoice(api: ApiInvoice): Invoice {
  const { subtotal: _s, taxAmount: _t, total: _total, deletedAt: _d, isOverdue: _o, daysOverdue: _do, ...invoice } = api;
  return invoice;
}

/** Strips the sync bookkeeping that ties an invoice to a particular workspace (keeps attribution). */
export function withoutServerState(invoice: Invoice): Invoice {
  const { revision: _r, updatedAt: _u, deletedAt: _d, ...rest } = invoice;
  return rest;
}
