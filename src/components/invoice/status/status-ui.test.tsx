import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import Index from '@/pages/Index';
import ViewInvoice from '@/pages/ViewInvoice';
import CreateInvoice from '@/pages/CreateInvoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import type { Invoice } from '@/types/invoice';
import { StatusBadge } from './StatusBadge';
import { TotalsStrip } from './StatusOverview';
import { summarizeInvoices } from '../../../../shared/invoice-status';

// Radix popovers measure with ResizeObserver; jsdom has none (same local stub as CurrencySelector.test).
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserver);

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

let n = 0;
function invoice(o: Partial<Invoice>): Invoice {
  n += 1;
  return {
    version: 2,
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    invoiceNumber: `INV-${String(n).padStart(4, '0')}`,
    invoiceName: `Invoice ${n}`,
    issueDate: '2026-11-01',
    dueDate: '',
    fromName: 'Ada',
    fromAddress: '',
    fromEmail: '',
    toName: 'Globex',
    toAddress: '',
    toEmail: '',
    lineItems: [{ id: 'l1', description: 'Work', quantity: 1, price: 100 }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'EUR',
    createdAt: '2026-11-01T10:00:00.000Z',
    status: 'draft',
    sentAt: null,
    paidAt: null,
    ...o,
  };
}

const TODAY = '2026-11-17';

beforeEach(() => {
  n = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 17, 12, 0, 0)); // local noon, Nov 17
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Index />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('div.group') as HTMLElement;

describe('StatusBadge', () => {
  it('shows the status, and "N days overdue" for sent invoices past due', () => {
    const { rerender } = render(<StatusBadge invoice={{ status: 'sent', dueDate: '2026-11-14' }} today={TODAY} />);
    expect(screen.getByText('3 days overdue')).toBeInTheDocument();
    expect(screen.getByText('3 days overdue').closest('[data-status]')).toHaveAttribute('data-status', 'overdue');
    rerender(<StatusBadge invoice={{ status: 'sent', dueDate: '2026-11-16' }} today={TODAY} />);
    expect(screen.getByText('1 day overdue')).toBeInTheDocument();
    rerender(<StatusBadge invoice={{ status: 'sent', dueDate: TODAY }} today={TODAY} />);
    expect(screen.getByText('Sent')).toBeInTheDocument();
    rerender(<StatusBadge invoice={{ dueDate: '2020-01-01' }} today={TODAY} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    rerender(<StatusBadge invoice={{ status: 'void' }} today={TODAY} />);
    expect(screen.getByText('Void')).toBeInTheDocument();
  });
});

describe('TotalsStrip', () => {
  it('shows one line per currency and never adds currencies together', () => {
    const summary = summarizeInvoices(
      [
        invoice({ status: 'sent', dueDate: '2026-12-01' }),
        invoice({ status: 'sent', dueDate: '2026-12-01', currency: 'USD', lineItems: [{ id: 'l', description: 'x', quantity: 2, price: 30 }] }),
        invoice({ status: 'sent', dueDate: '2026-11-01', currency: 'USD' }),
        invoice({ status: 'paid', paidAt: '2026-11-02', lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 75 }] }),
      ],
      TODAY,
    );
    render(<TotalsStrip summary={summary} />);
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('€100.00')).toBeInTheDocument();
    expect(within(totals).getByText('€75.00')).toBeInTheDocument();
    expect(within(totals).getByText('$60.00')).toBeInTheDocument();
    expect(within(totals).getByText('$100.00')).toBeInTheDocument();
    expect(within(totals).queryByText('$160.00')).not.toBeInTheDocument();
    expect(within(totals).queryByText('€175.00')).not.toBeInTheDocument();
  });

  it('renders nothing without invoices', () => {
    const { container } = render(<TotalsStrip summary={summarizeInvoices([], TODAY)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('dashboard', () => {
  beforeEach(() => {
    useInvoiceStore.setState({
      _hasHydrated: true,
      drafts: {},
      invoices: [
        invoice({ invoiceName: 'Draft one' }),
        invoice({ invoiceName: 'Due soon', status: 'sent', sentAt: '2026-11-10', dueDate: '2026-11-30', lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 250 }] }),
        invoice({ invoiceName: 'Late one', status: 'sent', sentAt: '2026-10-01', dueDate: '2026-11-07', lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 400 }] }),
        invoice({ invoiceName: 'Paid one', status: 'paid', sentAt: '2026-11-01', paidAt: '2026-11-05', lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 75 }] }),
        invoice({ invoiceName: 'Voided one', status: 'void' }),
      ],
    });
  });

  it('shows badges, the totals strip and filter chips with counts', async () => {
    const user = userEvent.setup();
    renderDashboard();
    expect(within(rowOf('Late one')).getByText('10 days overdue')).toBeInTheDocument();
    expect(within(rowOf('Due soon')).getByText('Sent')).toBeInTheDocument();
    expect(within(rowOf('Paid one')).getByText('Paid')).toBeInTheDocument();
    expect(within(rowOf('Draft one')).getByText('Draft')).toBeInTheDocument();

    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('€250.00')).toBeInTheDocument();
    expect(within(totals).getByText('€400.00')).toBeInTheDocument();
    expect(within(totals).getByText('€75.00')).toBeInTheDocument();

    const chips = screen.getByRole('group', { name: 'Filter invoices by status' });
    const chip = (name: RegExp) => within(chips).getByRole('button', { name });
    expect(chip(/^All 5/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Draft 1/)).toBeInTheDocument();
    expect(chip(/^Outstanding 1/)).toBeInTheDocument();
    expect(chip(/^Overdue 1/)).toBeInTheDocument();
    expect(chip(/^Paid 1/)).toBeInTheDocument();

    await user.click(chip(/^Overdue/));
    expect(chip(/^Overdue/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Late one')).toBeInTheDocument();
    expect(screen.queryByText('Due soon')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft one')).not.toBeInTheDocument();

    // Clicking a totals tile filters too.
    await user.click(within(totals).getByRole('button', { name: /Outstanding/ }));
    expect(screen.getByText('Due soon')).toBeInTheDocument();
    expect(screen.queryByText('Late one')).not.toBeInTheDocument();
  });

  it('quick actions on a row change the status, totals and counts', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(within(rowOf('Late one')).getByRole('button', { name: 'Change status of INV-0003' }));
    const actions = screen.getByRole('group', { name: 'Status actions for INV-0003' });
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark as paid', 'Void']);
    await user.click(within(actions).getByRole('button', { name: 'Mark as paid' }));

    expect(useInvoiceStore.getState().invoices[2]).toMatchObject({ status: 'paid', paidAt: TODAY });
    expect(within(rowOf('Late one')).getByText('Paid')).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Filter invoices by status' });
    expect(within(chips).getByRole('button', { name: /^Overdue 0/ })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: /^Paid 2/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Totals' })).getByText('€475.00')).toBeInTheDocument();

    // Draft → sent from the menu; the row does not navigate.
    await user.click(within(rowOf('Draft one')).getByRole('button', { name: 'Change status of INV-0001' }));
    await user.click(within(screen.getByRole('group', { name: 'Status actions for INV-0001' })).getByRole('button', { name: 'Mark as sent' }));
    expect(useInvoiceStore.getState().invoices[0]).toMatchObject({ status: 'sent', sentAt: TODAY });
  });

  it('shows an empty state for a filter without matches', async () => {
    useInvoiceStore.setState({ invoices: [invoice({ invoiceName: 'Only draft' })] });
    const user = userEvent.setup();
    renderDashboard();
    const chips = screen.getByRole('group', { name: 'Filter invoices by status' });
    await user.click(within(chips).getByRole('button', { name: /^Overdue 0/ }));
    expect(screen.getByText(/No overdue invoices/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Only draft')).toBeInTheDocument();
  });
});

describe('invoice view', () => {
  it('shows the status bar with dates and the actions that apply', async () => {
    const paid = invoice({ invoiceName: 'Paid one', status: 'paid', sentAt: '2026-11-01', paidAt: '2026-11-05', dueDate: '2026-11-30' });
    useInvoiceStore.setState({ _hasHydrated: true, drafts: {}, invoices: [paid] });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/invoice/${paid.id}`]}>
        <TooltipProvider>
          <Routes>
            <Route path="/invoice/:id" element={<ViewInvoice />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );
    const bar = screen.getByRole('region', { name: 'Invoice status' });
    expect(within(bar).getByText('Paid')).toBeInTheDocument();
    expect(within(bar).getByText('Due Nov 30, 2026 · Sent Nov 1, 2026 · Paid Nov 5, 2026')).toBeInTheDocument();
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Void', 'Reopen']);
    await user.click(within(bar).getByRole('button', { name: 'Reopen' }));
    expect(useInvoiceStore.getState().invoices[0]).toMatchObject({ status: 'sent', paidAt: null });
    expect(within(bar).getByText('Sent')).toBeInTheDocument();
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark as paid', 'Void']);
  });
});

describe('create / edit invoice save flow', () => {
  function renderCreate(id: string) {
    return render(
      <MemoryRouter initialEntries={[`/create/${id}`]}>
        <TooltipProvider>
          <Routes>
            <Route path="/create/:id" element={<CreateInvoice />} />
            <Route path="/" element={<p>dashboard</p>} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  it('saves a new invoice as a draft by default, or as sent with "Save & mark sent"', async () => {
    // Saving validates like the API, so start from a filled-in (unsaved) draft.
    const draft = (id: string) => {
      const { id: _id, createdAt: _c, version: _v, status: _s, sentAt: _sa, paidAt: _p, ...form } = invoice({ id });
      return form;
    };
    const f1 = '00000000-0000-4000-8000-0000000000f1';
    const f2 = '00000000-0000-4000-8000-0000000000f2';
    useInvoiceStore.setState({ _hasHydrated: true, drafts: { [f1]: draft(f1), [f2]: draft(f2) }, invoices: [] });
    const user = userEvent.setup();
    const first = renderCreate('00000000-0000-4000-8000-0000000000f1');
    await user.click(screen.getByRole('button', { name: 'Save Invoice' }));
    expect(useInvoiceStore.getState().invoices[0]).toMatchObject({ id: '00000000-0000-4000-8000-0000000000f1', status: 'draft' });
    first.unmount();

    renderCreate('00000000-0000-4000-8000-0000000000f2');
    await user.click(screen.getByRole('button', { name: 'Save & mark sent' }));
    expect(useInvoiceStore.getState().invoices[0]).toMatchObject({ id: '00000000-0000-4000-8000-0000000000f2', status: 'sent', sentAt: TODAY });
  });

  it('neither saves nor marks sent when the invoice is invalid', async () => {
    useInvoiceStore.setState({ _hasHydrated: true, drafts: {}, invoices: [] });
    const user = userEvent.setup();
    renderCreate('00000000-0000-4000-8000-0000000000f3');
    await user.click(screen.getByRole('button', { name: 'Save & mark sent' }));
    expect(await screen.findByText('Your name/company is required')).toBeInTheDocument();
    expect(useInvoiceStore.getState().invoices).toEqual([]);
  });

  it('keeps the status of a sent invoice when it is edited and offers no "mark sent"', async () => {
    const sent = invoice({ invoiceName: 'Sent one', status: 'sent', sentAt: '2026-11-10' });
    useInvoiceStore.setState({ _hasHydrated: true, drafts: {}, invoices: [sent] });
    const user = userEvent.setup();
    renderCreate(sent.id);
    expect(screen.queryByRole('button', { name: 'Save & mark sent' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Invoice' }));
    expect(useInvoiceStore.getState().invoices[0]).toMatchObject({ status: 'sent', sentAt: '2026-11-10' });
  });
});
