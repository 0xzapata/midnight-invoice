import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import Index from '@/pages/Index';
import CreateInvoice from '@/pages/CreateInvoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import type { Invoice } from '@/types/invoice';

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

const paid: Invoice = {
  version: 2,
  id: '00000000-0000-4000-8000-000000000001',
  invoiceNumber: 'INV-0001',
  invoiceName: 'Autumn rebrand',
  issueDate: '2026-11-01',
  dueDate: '2026-11-15',
  fromName: 'Midnight Studio',
  fromAddress: '',
  fromEmail: '',
  toName: 'Acme Corp',
  toAddress: '1 Market Street',
  toEmail: 'billing@acme-client.io',
  lineItems: [{ id: 'l1', description: 'Brand identity design', quantity: 1, price: 2400 }],
  taxRate: 19,
  notes: '',
  paymentDetails: '',
  currency: 'EUR',
  createdAt: '2026-11-01T10:00:00.000Z',
  status: 'paid',
  sentAt: '2026-11-01',
  paidAt: '2026-11-10',
  revision: 3,
};

beforeEach(() => {
  localStorage.clear();
  useInvoiceStore.setState({ invoices: [paid], drafts: {} });
});

describe('dashboard "Duplicate"', () => {
  it('opens the editor with a copy of the invoice (new number, no status), not an empty form', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/create/:id" element={<CreateInvoice />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    await user.click(screen.getByTitle('Duplicate Invoice'));

    expect(await screen.findByLabelText('Client Name / Company')).toHaveValue('Acme Corp');
    expect(screen.getByLabelText('Line item 1 description')).toHaveValue('Brand identity design');
    expect(screen.getByLabelText('Invoice Number')).toHaveValue('INV-0002');
    const drafts = Object.values(useInvoiceStore.getState().drafts);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).not.toHaveProperty('status');
    expect(drafts[0]).not.toHaveProperty('revision');
    // The original is untouched.
    expect(useInvoiceStore.getState().invoices).toEqual([paid]);
  });
});
