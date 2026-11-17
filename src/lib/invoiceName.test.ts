import { describe, it, expect, beforeEach } from 'vitest';
import { generatedInvoiceLabel, invoiceListLabel, isGeneratedInvoiceName, printableInvoiceName } from './invoiceName';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import type { InvoiceFormData } from '@/types/invoice';

describe('generated invoice names', () => {
  it('recognises every label earlier versions generated, and nothing else', () => {
    for (const name of ['Cosmic Phoenix 42', 'Epic Spark 0', 'Royal Wave 99', 'Swift Dragon 7', '  Prime Pulse 5 ']) {
      expect(isGeneratedInvoiceName(name), name).toBe(true);
    }
    for (const name of ['Brand refresh — Q4', 'Cosmic Phoenix', 'Cosmic Phoenix 100', 'Cosmic Phoenix 07', 'cosmic phoenix 42', 'Cosmic Unicorn 4', 'Cosmic Phoenix 42 (final)', '', undefined, null]) {
      expect(isGeneratedInvoiceName(name), String(name)).toBe(false);
    }
  });

  it('prints only names a person typed', () => {
    expect(printableInvoiceName('  Brand refresh — Q4 ')).toBe('Brand refresh — Q4');
    expect(printableInvoiceName('Golden Nexus 12')).toBe('');
    expect(printableInvoiceName(undefined)).toBe('');
  });

  it('derives a stable label in the same style from the invoice id', () => {
    const label = generatedInvoiceLabel('3f2b8c1e-0000-4000-8000-000000000001');
    expect(isGeneratedInvoiceName(label)).toBe(true);
    expect(generatedInvoiceLabel('3f2b8c1e-0000-4000-8000-000000000001')).toBe(label);
    const labels = new Set(Array.from({ length: 50 }, (_, i) => generatedInvoiceLabel(`id-${i}`)));
    expect(labels.size).toBeGreaterThan(40);
  });

  it('labels the dashboard with the name, a label stored by an earlier version, or the derived label', () => {
    expect(invoiceListLabel({ id: 'a', invoiceName: 'Website' })).toBe('Website');
    expect(invoiceListLabel({ id: 'a', invoiceName: 'Cosmic Phoenix 42' })).toBe('Cosmic Phoenix 42');
    expect(invoiceListLabel({ id: 'a' })).toBe(generatedInvoiceLabel('a'));
    expect(invoiceListLabel({ id: 'a', invoiceName: '  ' })).toBe(generatedInvoiceLabel('a'));
  });
});

const form = (overrides: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  invoiceNumber: 'INV-0001',
  invoiceName: '',
  issueDate: '2026-11-17',
  dueDate: '',
  fromName: 'Me',
  fromAddress: '',
  fromEmail: '',
  toName: 'Client',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: '1', description: 'Work', quantity: 1, price: 1 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  ...overrides,
});

describe('saving invoice names', () => {
  beforeEach(() => useInvoiceStore.setState({ invoices: [], drafts: {} }));

  it('stores no name when the user leaves it empty (the dashboard label is derived instead)', () => {
    const saved = useInvoiceStore.getState().saveInvoice(form(), 'new-id');
    expect(saved.invoiceName).toBeUndefined();
    expect(invoiceListLabel(saved)).toBe(generatedInvoiceLabel('new-id'));
  });

  it('stores the name the user typed, trimmed', () => {
    expect(useInvoiceStore.getState().saveInvoice(form({ invoiceName: ' Brand refresh ' }), 'x').invoiceName).toBe('Brand refresh');
  });

  it('keeps a label an earlier version stored, so the dashboard label does not change', () => {
    useInvoiceStore.setState({ invoices: [{ ...form({ invoiceName: 'Noble Aurora 3' }), id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }] });
    // The editor shows the name field empty for such invoices.
    const saved = useInvoiceStore.getState().saveInvoice(form({ invoiceName: '', notes: 'edited' }), 'old');
    expect(saved.invoiceName).toBe('Noble Aurora 3');
    expect(printableInvoiceName(saved.invoiceName)).toBe('');
    // A typed name replaces it.
    expect(useInvoiceStore.getState().saveInvoice(form({ invoiceName: 'Retainer' }), 'old').invoiceName).toBe('Retainer');
  });
});
