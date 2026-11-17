import { describe, expect, it } from 'vitest';
import { contentOf, fromApiInvoice, mergeContent, toInvoiceInput } from './fields';
import type { ApiInvoice } from '../../../shared/api';

const base = contentOf({
  invoiceNumber: 'INV-0001',
  invoiceName: 'Website',
  issueDate: '2026-11-01',
  fromName: 'Ada',
  toName: 'Globex',
  lineItems: [{ id: 'l1', description: 'Design', quantity: 1, price: 100 }],
  taxRate: 0,
  currency: 'EUR',
});

describe('mergeContent (three-way, server wins on same-field conflicts)', () => {
  it('combines edits of different fields', () => {
    const local = { ...base, toName: 'Globex GmbH' };
    const server = { ...base, notes: 'Thanks!' };
    const result = mergeContent(base, local, server);
    expect(result.merged).toMatchObject({ toName: 'Globex GmbH', notes: 'Thanks!' });
    expect(result.localFields).toEqual(['toName']);
    expect(result.conflicts).toEqual([]);
  });

  it('keeps the server value when both sides changed the same field', () => {
    const local = { ...base, toName: 'Mine', notes: 'local note' };
    const server = { ...base, toName: 'Theirs' };
    const result = mergeContent(base, local, server);
    expect(result.merged.toName).toBe('Theirs');
    expect(result.merged.notes).toBe('local note');
    expect(result.conflicts).toEqual(['toName']);
  });

  it('treats line items as one field', () => {
    const local = { ...base, lineItems: [{ id: 'l1', description: 'Design', quantity: 2, price: 100 }] };
    const server = { ...base, lineItems: [{ id: 'l1', description: 'Design', quantity: 1, price: 120 }] };
    expect(mergeContent(base, local, server).conflicts).toEqual(['lineItems']);
  });

  it('is a no-op when both made the same change', () => {
    const changed = { ...base, toName: 'Same' };
    expect(mergeContent(base, changed, { ...changed })).toMatchObject({ conflicts: [], localFields: [] });
  });

  it('without a base, every difference is a conflict (server wins)', () => {
    const result = mergeContent(null, { ...base, toName: 'Mine' }, base);
    expect(result.conflicts).toEqual(['toName']);
    expect(result.merged.toName).toBe('Globex');
  });
});

describe('conversions', () => {
  it('normalises missing optional fields so equality is structural', () => {
    expect(contentOf({ invoiceName: undefined, dueDate: undefined })).toMatchObject({ invoiceName: '', dueDate: '' });
  });

  it('builds a PUT body without server-only fields', () => {
    const input = toInvoiceInput({ ...base, id: 'x', createdAt: '2026-11-01T00:00:00.000Z', revision: 4, updatedAt: 'u' } as never);
    expect(input).toMatchObject({ toName: 'Globex', createdAt: '2026-11-01T00:00:00.000Z' });
    expect(input).not.toHaveProperty('revision');
    expect(input).not.toHaveProperty('id');
  });

  it('drops totals and the tombstone marker from server invoices', () => {
    const local = fromApiInvoice({ id: 'x', subtotal: 1, taxAmount: 0, total: 1, deletedAt: null, revision: 2 } as unknown as ApiInvoice);
    expect(local).toEqual({ id: 'x', revision: 2 });
  });
});
