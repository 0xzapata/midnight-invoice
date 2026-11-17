import { localToday } from '../../shared/invoice-status';
import type { Invoice, InvoiceFormData } from '@/types/invoice';

/**
 * Form data for a copy of an invoice (dashboard row, invoice page and editor
 * "Duplicate"): the same parties, lines and terms with the next invoice number,
 * today's issue date and no due date. Identity, status, sync metadata and the
 * template / recurring-schedule provenance belong to the original and are left
 * out, so the copy starts as a new, unsynced draft.
 */
export function duplicateInvoiceData(source: InvoiceFormData | Invoice, nextInvoiceNumber: string, today: string = localToday()): InvoiceFormData {
  const {
    id: _id,
    createdAt: _createdAt,
    status: _status,
    sentAt: _sentAt,
    paidAt: _paidAt,
    revision: _revision,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    version: _version,
    templateId: _templateId,
    recurringId: _recurringId,
    ...fields
  } = source as Partial<Invoice> & InvoiceFormData;
  return {
    ...fields,
    lineItems: fields.lineItems.map((li) => ({ ...li, id: crypto.randomUUID() })),
    invoiceNumber: nextInvoiceNumber,
    issueDate: today,
    dueDate: '',
  };
}
