import { describe, expect, it } from 'vitest';
import {
  actionTarget,
  availableActions,
  bucketOf,
  canTransition,
  daysOverdue,
  INVOICE_STATUSES,
  isOverdue,
  localToday,
  normalizeStatusFields,
  statusOf,
  summarizeInvoices,
  transitionStatus,
  utcToday,
  type InvoiceStatus,
} from './invoice-status';

const TODAY = '2026-11-17';

describe('status defaults and normalisation', () => {
  it('reads a missing or unknown status as draft', () => {
    expect(statusOf({})).toBe('draft');
    expect(statusOf(undefined)).toBe('draft');
    expect(statusOf({ status: 'archived' })).toBe('draft');
    expect(statusOf({ status: 'paid' })).toBe('paid');
  });

  it('keeps the date invariants of each status', () => {
    expect(normalizeStatusFields({ status: 'draft', sentAt: '2026-01-01', paidAt: '2026-01-02' }, TODAY)).toEqual({ status: 'draft', sentAt: null, paidAt: null });
    expect(normalizeStatusFields({ status: 'sent' }, TODAY)).toEqual({ status: 'sent', sentAt: TODAY, paidAt: null });
    expect(normalizeStatusFields({ status: 'sent', sentAt: '2026-11-01', paidAt: '2026-11-02' }, TODAY)).toEqual({ status: 'sent', sentAt: '2026-11-01', paidAt: null });
    expect(normalizeStatusFields({ status: 'paid' }, TODAY)).toEqual({ status: 'paid', sentAt: TODAY, paidAt: TODAY });
    expect(normalizeStatusFields({ status: 'paid', paidAt: '2026-11-03' }, TODAY)).toEqual({ status: 'paid', sentAt: '2026-11-03', paidAt: '2026-11-03' });
    expect(normalizeStatusFields({ status: 'void', sentAt: '2026-11-01', paidAt: '2026-11-03' }, TODAY)).toEqual({ status: 'void', sentAt: '2026-11-01', paidAt: null });
    expect(normalizeStatusFields({ status: 'sent', sentAt: 'yesterday' }, TODAY).sentAt).toBe(TODAY);
  });
});

describe('transition rules', () => {
  const allowed: [InvoiceStatus, InvoiceStatus][] = [
    ['draft', 'sent'],
    ['draft', 'void'],
    ['sent', 'paid'],
    ['sent', 'void'],
    ['sent', 'draft'],
    ['paid', 'sent'],
    ['paid', 'void'],
    ['void', 'draft'],
    ['void', 'sent'],
  ];

  it('allows exactly the documented transitions (plus same → same)', () => {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        const expected = from === to || allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
    expect(canTransition('draft', 'paid')).toBe(false);
    expect(canTransition('void', 'paid')).toBe(false);
    expect(canTransition('paid', 'draft')).toBe(false);
  });

  it('rejects a disallowed transition with the allowed targets', () => {
    const result = transitionStatus({ status: 'draft' }, 'paid', { today: TODAY });
    expect(result).toMatchObject({ ok: false, from: 'draft', to: 'paid', allowed: ['sent', 'void'] });
    if (!result.ok) expect(result.message).toMatch(/draft to paid/);
  });

  it('sets and clears dates along draft → sent → paid → sent → void → sent', () => {
    let state: { status?: InvoiceStatus; sentAt?: string | null; paidAt?: string | null } = {};
    const step = (to: InvoiceStatus, opts: { paidAt?: string; sentAt?: string } = {}, today = TODAY) => {
      const r = transitionStatus(state, to, { today, ...opts });
      if (!r.ok) throw new Error(r.message);
      state = r.fields;
      return r;
    };
    expect(step('sent', {}, '2026-11-01').fields).toEqual({ status: 'sent', sentAt: '2026-11-01', paidAt: null });
    expect(step('paid', { paidAt: '2026-11-10' }).fields).toEqual({ status: 'paid', sentAt: '2026-11-01', paidAt: '2026-11-10' });
    expect(step('sent').fields).toEqual({ status: 'sent', sentAt: '2026-11-01', paidAt: null });
    expect(step('void').fields).toEqual({ status: 'void', sentAt: '2026-11-01', paidAt: null });
    expect(step('sent').fields).toEqual({ status: 'sent', sentAt: '2026-11-01', paidAt: null });
    expect(step('draft').fields).toEqual({ status: 'draft', sentAt: null, paidAt: null });
  });

  it('treats repeating the current status as a no-op unless a new date is given', () => {
    const paid = { status: 'paid' as const, sentAt: '2026-11-01', paidAt: '2026-11-10' };
    expect(transitionStatus(paid, 'paid', { today: TODAY })).toMatchObject({ ok: true, changed: false });
    expect(transitionStatus(paid, 'paid', { today: TODAY, paidAt: '2026-11-12' })).toMatchObject({ ok: true, changed: true, fields: { paidAt: '2026-11-12' } });
  });

  it('maps actions to targets; reopen undoes a payment or a void', () => {
    expect(actionTarget('mark_sent', { status: 'draft' })).toBe('sent');
    expect(actionTarget('mark_paid', { status: 'sent' })).toBe('paid');
    expect(actionTarget('mark_paid', { status: 'draft' })).toBeNull();
    expect(actionTarget('mark_sent', { status: 'sent' })).toBeNull();
    expect(actionTarget('reopen', { status: 'paid' })).toBe('sent');
    expect(actionTarget('reopen', { status: 'void', sentAt: '2026-11-01' })).toBe('sent');
    expect(actionTarget('reopen', { status: 'void', sentAt: null })).toBe('draft');
    expect(actionTarget('reopen', { status: 'sent' })).toBeNull();
    expect(availableActions({})).toEqual(['mark_sent', 'void']);
    expect(availableActions({ status: 'sent' })).toEqual(['mark_paid', 'void']);
    expect(availableActions({ status: 'paid' })).toEqual(['void', 'reopen']);
    expect(availableActions({ status: 'void' })).toEqual(['reopen']);
    expect(actionTarget('mark_sent', { status: 'paid' })).toBeNull();
  });
});

describe('overdue (derived)', () => {
  it('is sent with a due date strictly before today', () => {
    expect(isOverdue({ status: 'sent', dueDate: '2026-11-16' }, TODAY)).toBe(true);
    expect(isOverdue({ status: 'sent', dueDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ status: 'sent', dueDate: '2026-11-18' }, TODAY)).toBe(false);
    expect(isOverdue({ status: 'sent', dueDate: '' }, TODAY)).toBe(false);
    expect(isOverdue({ status: 'sent' }, TODAY)).toBe(false);
    for (const status of ['draft', 'paid', 'void'] as const) expect(isOverdue({ status, dueDate: '2020-01-01' }, TODAY)).toBe(false);
    expect(isOverdue({ dueDate: '2020-01-01' }, TODAY)).toBe(false); // legacy = draft
  });

  it('counts whole calendar days, across month and year ends', () => {
    expect(daysOverdue({ status: 'sent', dueDate: '2026-11-16' }, TODAY)).toBe(1);
    expect(daysOverdue({ status: 'sent', dueDate: '2026-10-31' }, TODAY)).toBe(17);
    expect(daysOverdue({ status: 'sent', dueDate: '2025-12-31' }, '2026-01-01')).toBe(1);
    expect(daysOverdue({ status: 'sent', dueDate: '2024-02-28' }, '2024-03-01')).toBe(2);
    expect(daysOverdue({ status: 'sent', dueDate: TODAY }, TODAY)).toBe(0);
  });

  it('defines "today" as the local date in the browser and the UTC date on the server', () => {
    // 23:30 at UTC-5 on Nov 16 is already Nov 17 in UTC.
    const instant = new Date('2026-11-17T04:30:00.000Z');
    expect(utcToday(instant)).toBe('2026-11-17');
    const local = new Date(2026, 10, 16, 23, 30);
    expect(localToday(local)).toBe('2026-11-16');
  });

  it('buckets invoices for the dashboard', () => {
    expect(bucketOf({}, TODAY)).toBe('draft');
    expect(bucketOf({ status: 'sent', dueDate: '2026-12-01' }, TODAY)).toBe('outstanding');
    expect(bucketOf({ status: 'sent', dueDate: '2026-11-01' }, TODAY)).toBe('overdue');
    expect(bucketOf({ status: 'paid' }, TODAY)).toBe('paid');
    expect(bucketOf({ status: 'void' }, TODAY)).toBe('void');
  });
});

describe('summarizeInvoices', () => {
  let n = 0;
  const inv = (o: Record<string, unknown>) => ({
    id: `id-${++n}`,
    invoiceNumber: `INV-${String(n).padStart(4, '0')}`,
    toName: 'Globex',
    currency: 'EUR',
    taxRate: 0,
    lineItems: [{ quantity: 1, price: 100 }],
    ...o,
  });

  it('groups by currency, never summing across currencies', () => {
    const summary = summarizeInvoices(
      [
        inv({ status: 'draft', lineItems: [{ quantity: 1, price: 10.1 }] }),
        inv({ status: 'draft', lineItems: [{ quantity: 1, price: 0.2 }] }),
        inv({ status: 'sent', dueDate: '2026-12-01' }),
        inv({ status: 'sent', dueDate: '2026-11-01', taxRate: 10 }),
        inv({ status: 'sent', dueDate: '2026-11-17' }),
        inv({ status: 'paid', paidAt: '2026-11-02' }),
        inv({ status: 'paid', paidAt: '2026-03-02' }),
        inv({ status: 'paid', paidAt: '2025-12-31' }),
        inv({ status: 'void', dueDate: '2026-01-01' }),
        inv({ status: 'sent', dueDate: '2026-10-01', currency: 'USD', lineItems: [{ quantity: 3, price: 50 }] }),
        inv({ currency: 'JPY', lineItems: [{ quantity: 1, price: 5000 }] }),
      ],
      TODAY,
    );
    expect(summary.asOf).toBe(TODAY);
    expect(summary.currencies.map((c) => c.currency)).toEqual(['EUR', 'JPY', 'USD']);
    expect(summary.currencies[0]).toEqual({
      currency: 'EUR',
      draft: { count: 2, total: 10.3 },
      outstanding: { count: 2, total: 200 },
      overdue: { count: 1, total: 110 },
      paidThisMonth: { count: 1, total: 100 },
      paidThisYear: { count: 2, total: 200 },
    });
    expect(summary.currencies[2]).toMatchObject({ currency: 'USD', overdue: { count: 1, total: 150 }, outstanding: { count: 0, total: 0 } });
    expect(summary.currencies[1]).toMatchObject({ currency: 'JPY', draft: { count: 1, total: 5000 } });
    // Oldest overdue first, with days overdue.
    expect(summary.oldestOverdue.map((o) => [o.currency, o.dueDate, o.daysOverdue, o.total])).toEqual([
      ['USD', '2026-10-01', 47, 150],
      ['EUR', '2026-11-01', 16, 110],
    ]);
  });

  it('omits currencies used only by void invoices and limits the overdue list', () => {
    const items = [inv({ status: 'void', currency: 'GBP' }), ...[1, 2, 3].map((d) => inv({ status: 'sent', dueDate: `2026-11-0${d}` }))];
    const summary = summarizeInvoices(items, TODAY, { oldestOverdueLimit: 2 });
    expect(summary.currencies.map((c) => c.currency)).toEqual(['EUR']);
    expect(summary.oldestOverdue.map((o) => o.dueDate)).toEqual(['2026-11-01', '2026-11-02']);
  });
});
