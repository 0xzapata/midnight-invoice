import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceFormData } from '@/types/invoice';
import { useInvoiceStore } from './useInvoiceStore';
import { localToday } from '../../shared/invoice-status';
import { setLocalInvoiceChangeListener } from '@/lib/sync/localChanges';

const form = (o: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  invoiceNumber: 'INV-0001',
  invoiceName: 'Website',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  fromName: 'Ada',
  fromAddress: '',
  fromEmail: '',
  toName: 'Globex',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: 'l1', description: 'Design', quantity: 1, price: 100 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'EUR',
  ...o,
});

const store = () => useInvoiceStore.getState();

describe('invoice status in the local store', () => {
  const changes: unknown[] = [];
  beforeEach(() => {
    useInvoiceStore.setState({ invoices: [], drafts: {} });
    changes.length = 0;
    setLocalInvoiceChangeListener((c) => changes.push(c));
  });

  it('saves new invoices as drafts, or as sent when asked', () => {
    expect(store().saveInvoice(form(), 'a')).toMatchObject({ status: 'draft', sentAt: null, paidAt: null });
    expect(store().saveInvoice(form(), 'b', { status: 'sent' })).toMatchObject({ status: 'sent', sentAt: localToday() });
  });

  it('keeps the status when the form saves an edit (even with a stale status in the form data)', () => {
    store().saveInvoice(form(), 'a', { status: 'sent' });
    store().setInvoiceStatus('a', 'mark_paid');
    const edited = store().saveInvoice({ ...form({ notes: 'edited' }), status: 'draft' } as InvoiceFormData, 'a');
    expect(edited).toMatchObject({ status: 'paid', notes: 'edited', paidAt: localToday() });
  });

  it('applies the shared transition rules and emits a local change', () => {
    store().saveInvoice(form(), 'a');
    changes.length = 0;
    expect(store().setInvoiceStatus('a', 'mark_paid')).toMatchObject({ ok: false });
    expect(store().getInvoice('a')!.status).toBe('draft');
    expect(changes).toEqual([]);

    expect(store().setInvoiceStatus('a', 'mark_sent')).toMatchObject({ ok: true, changed: true });
    expect(store().setInvoiceStatus('a', { status: 'paid', paidAt: '2026-11-16' })).toMatchObject({ ok: true });
    expect(store().getInvoice('a')).toMatchObject({ status: 'paid', paidAt: '2026-11-16' });
    expect(store().setInvoiceStatus('a', 'reopen')).toMatchObject({ ok: true, fields: { status: 'sent', paidAt: null } });
    expect(store().setInvoiceStatus('a', 'void')).toMatchObject({ ok: true, fields: { status: 'void' } });
    expect(changes).toEqual(Array(4).fill({ type: 'upsert', id: 'a' }));

    // No-op: nothing emitted.
    changes.length = 0;
    expect(store().setInvoiceStatus('a', { status: 'void' })).toMatchObject({ ok: true, changed: false });
    expect(changes).toEqual([]);
    expect(store().setInvoiceStatus('missing', 'void')).toEqual({ ok: false, message: 'Invoice not found' });
  });

  it('does not touch drafts (autosaved form data)', () => {
    const spy = vi.fn();
    setLocalInvoiceChangeListener(spy);
    store().saveDraft('x', form());
    expect(store().loadDraft('x')).not.toHaveProperty('status');
    expect(spy).not.toHaveBeenCalled();
  });
});
