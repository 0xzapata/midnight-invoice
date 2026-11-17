import { describe, expect, it } from 'vitest';
import { duplicateInvoiceData } from './duplicateInvoice';
import type { Invoice } from '@/types/invoice';

const synced: Invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-0009',
  invoiceName: 'Retainer November 2026',
  issueDate: '2026-11-01',
  dueDate: '2026-11-15',
  fromName: 'Midnight Studio',
  fromAddress: '12 Night Street',
  fromEmail: 'studio@midnight-studio.io',
  toName: 'Globex',
  toAddress: '5 Globex Way',
  toEmail: 'ap@globex-corp.io',
  lineItems: [{ id: 'li-1', description: 'Design retainer', quantity: 1, price: 2500 }],
  taxRate: 19,
  notes: 'Thanks',
  paymentDetails: 'IBAN DE00',
  currency: 'EUR',
  createdAt: '2026-11-01T08:00:00.000Z',
  version: 2,
  clientId: 'client-1',
  templateId: 'tpl-1',
  recurringId: 'rec-1',
  status: 'paid',
  sentAt: '2026-11-01',
  paidAt: '2026-11-10',
  revision: 4,
  updatedAt: '2026-11-10T08:00:00.000Z',
  deletedAt: null,
  createdBy: { type: 'system', recurringId: 'rec-1', recurringName: 'Globex retainer' },
  updatedBy: { type: 'user' },
};

describe('duplicateInvoiceData', () => {
  it('copies parties, lines and terms with a new number, today as issue date and no due date', () => {
    const copy = duplicateInvoiceData(synced, 'INV-0012', '2026-11-17');
    expect(copy).toMatchObject({
      invoiceNumber: 'INV-0012',
      invoiceName: 'Retainer November 2026',
      issueDate: '2026-11-17',
      dueDate: '',
      fromName: 'Midnight Studio',
      toName: 'Globex',
      toEmail: 'ap@globex-corp.io',
      clientId: 'client-1',
      taxRate: 19,
      currency: 'EUR',
      notes: 'Thanks',
      paymentDetails: 'IBAN DE00',
    });
    expect(copy.lineItems).toEqual([{ id: expect.any(String), description: 'Design retainer', quantity: 1, price: 2500 }]);
    expect(copy.lineItems[0].id).not.toBe('li-1');
  });

  it('leaves out identity, status, sync metadata and template/schedule provenance', () => {
    const copy = duplicateInvoiceData(synced, 'INV-0012', '2026-11-17') as unknown as Record<string, unknown>;
    for (const key of ['id', 'createdAt', 'status', 'sentAt', 'paidAt', 'revision', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy', 'version', 'templateId', 'recurringId']) {
      expect(copy, key).not.toHaveProperty(key);
    }
  });
});
