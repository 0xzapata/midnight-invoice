import { describe, expect, it } from 'vitest';
import type { Client } from '../../../shared/types/client';
import type { InvoiceTemplate } from '../../../shared/types/template';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { InvoiceFormData } from '@/types/invoice';
import { describePlaceholderReport, isPristineForTemplate, newInvoiceDraftFromTemplate, templateFormPatch } from './templateApply';

const GLOBEX: Client = {
  id: 'c-globex',
  name: 'Globex',
  email: 'ap@globex.example',
  address: '1 Globex Way',
  defaultCurrency: 'EUR',
  defaultTaxRate: 7,
  paymentTermsDays: 30,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TEMPLATE: InvoiceTemplate = {
  id: 't-1',
  name: 'Retainer',
  description: '',
  clientId: GLOBEX.id,
  lineItems: [{ id: 'tl', description: 'Retainer {{prev_month_name}} for {{client_name}}', quantity: 1, price: 2000 }],
  taxRate: null,
  currency: null,
  notes: 'Ref {{invoice_number}}',
  paymentDetails: '',
  paymentTermsDays: null,
  invoiceNamePattern: 'Retainer {{month_name}} {{year}}',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

const SETTINGS = { ...DEFAULT_SETTINGS, fromName: 'Ada Ltd', paymentDetails: 'IBAN', taxRate: 19, currency: 'USD' };

function form(overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0007',
    invoiceName: '',
    issueDate: '2026-03-05',
    dueDate: '',
    fromName: '',
    fromAddress: '',
    fromEmail: '',
    toName: '',
    toAddress: '',
    toEmail: '',
    lineItems: [{ id: 'l1', description: '', quantity: 1, price: 0 }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'USD',
    ...overrides,
  };
}

describe('newInvoiceDraftFromTemplate', () => {
  it('template > client defaults > settings, placeholders resolved for today', () => {
    const { draft, report } = newInvoiceDraftFromTemplate(TEMPLATE, { clients: [GLOBEX], settings: SETTINGS, invoiceNumber: 'INV-0007', today: '2026-03-05' });
    expect(draft).toMatchObject({
      invoiceNumber: 'INV-0007',
      invoiceName: 'Retainer March 2026',
      issueDate: '2026-03-05',
      dueDate: '2026-04-04', // client terms (template has none)
      fromName: 'Ada Ltd', // settings
      paymentDetails: 'IBAN', // settings
      clientId: GLOBEX.id,
      toName: 'Globex',
      toAddress: '1 Globex Way',
      currency: 'EUR', // client
      taxRate: 7, // client
      notes: 'Ref INV-0007',
      templateId: TEMPLATE.id,
    });
    expect(draft.lineItems).toEqual([{ id: expect.any(String), description: 'Retainer February for Globex', quantity: 1, price: 2000 }]);
    expect(report).toEqual({ unknown: [], unresolved: [] });

    const own = newInvoiceDraftFromTemplate({ ...TEMPLATE, taxRate: 0, currency: 'GBP', paymentTermsDays: 7 }, { clients: [GLOBEX], settings: SETTINGS, invoiceNumber: 'X', today: '2026-03-05' });
    expect(own.draft).toMatchObject({ taxRate: 0, currency: 'GBP', dueDate: '2026-03-12' });
  });

  it('without the client (deleted) settings fill in and {{client_name}} is reported', () => {
    const { draft, report } = newInvoiceDraftFromTemplate(TEMPLATE, { clients: [], settings: SETTINGS, invoiceNumber: 'INV-0001', today: '2026-03-05' });
    expect(draft).toMatchObject({ toName: '', currency: 'USD', taxRate: 19, dueDate: '' });
    expect(draft).not.toHaveProperty('clientId');
    expect(draft.lineItems[0].description).toBe('Retainer February for {{client_name}}');
    expect(report.unresolved).toEqual(['client_name']);
    expect(describePlaceholderReport(report)).toBe('Left as typed: no value for {{client_name}}.');
  });
});

describe('templateFormPatch', () => {
  const touched = { currency: false, taxRate: false };

  it('a fresh form is pristine; typed content is not', () => {
    expect(isPristineForTemplate(form())).toBe(true);
    expect(isPristineForTemplate(form({ notes: 'x' }))).toBe(false);
    expect(isPristineForTemplate(form({ toName: 'Initech' }))).toBe(false);
    expect(isPristineForTemplate(form({ lineItems: [{ id: 'a', description: 'Typed', quantity: 1, price: 0 }] }))).toBe(false);
  });

  it('replace: the template’s lines, name, notes and client replace the form’s', () => {
    const { patch } = templateFormPatch(TEMPLATE, form({ notes: 'old', lineItems: [{ id: 'a', description: 'Typed', quantity: 1, price: 5 }] }), {
      clients: [GLOBEX],
      mode: 'replace',
      touched,
      today: '2026-03-05',
    });
    expect(patch).toMatchObject({
      templateId: TEMPLATE.id,
      invoiceName: 'Retainer March 2026',
      notes: 'Ref INV-0007',
      clientId: GLOBEX.id,
      toName: 'Globex',
      currency: 'EUR',
      taxRate: 7,
      dueDate: '2026-04-04',
    });
    expect(patch.lineItems!.map((l) => l.description)).toEqual(['Retainer February for Globex']);
  });

  it('merge: never overwrites anything typed', () => {
    const typed = form({
      invoiceName: 'My name',
      notes: 'My notes',
      toName: 'Initech',
      dueDate: '2026-03-20',
      lineItems: [
        { id: 'a', description: 'Typed', quantity: 1, price: 5 },
        { id: 'b', description: '', quantity: 1, price: 0 },
      ],
    });
    const { patch } = templateFormPatch(TEMPLATE, typed, { clients: [GLOBEX], mode: 'merge', touched: { currency: true, taxRate: true }, today: '2026-03-05' });
    expect(patch).toEqual({
      templateId: TEMPLATE.id,
      // Typed line kept, blank line dropped, template line appended (for the Bill To that was typed).
      lineItems: [
        { id: 'a', description: 'Typed', quantity: 1, price: 5 },
        { id: expect.any(String), description: 'Retainer February for Initech', quantity: 1, price: 2000 },
      ],
    });
  });

  it('merge fills empty fields and untouched terms from the template and its client', () => {
    const { patch } = templateFormPatch({ ...TEMPLATE, paymentTermsDays: 10 }, form({ lineItems: [{ id: 'a', description: 'Typed', quantity: 1, price: 5 }] }), {
      clients: [GLOBEX],
      mode: 'merge',
      touched,
      today: '2026-03-05',
    });
    expect(patch).toMatchObject({ invoiceName: 'Retainer March 2026', notes: 'Ref INV-0007', clientId: GLOBEX.id, currency: 'EUR', taxRate: 7, dueDate: '2026-03-15' });
  });
});
