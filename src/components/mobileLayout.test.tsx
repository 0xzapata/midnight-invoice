/**
 * Small-screen layout contracts (320–390 px). jsdom does not apply CSS, so
 * these check the responsive classes that the Playwright pass verified.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import { TotalsStrip } from '@/components/invoice/status/StatusOverview';
import Index from '@/pages/Index';
import type { Invoice } from '@/types/invoice';
import { summarizeInvoices } from '../../shared/invoice-status';

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn(), registerHyphenationCallback: vi.fn() },
}));

const invoice: Invoice = {
  id: 'i1',
  invoiceNumber: 'INV-0001',
  invoiceName: 'Website maintenance retainer for October',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  fromName: 'Me',
  fromAddress: '',
  fromEmail: '',
  toName: 'Initech International Holdings',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: 'l', description: 'Work', quantity: 1, price: 100 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'EUR',
  createdAt: '2026-11-01T10:00:00.000Z',
  status: 'sent',
  sentAt: '2026-11-01',
  paidAt: null,
};

describe('mobile layouts', () => {
  it('invoice rows: details full width on phones, then amount and actions on one row; never breaks inside the number or date', () => {
    render(<InvoiceList invoices={[invoice]} onView={() => {}} onLoadSession={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    const row = screen.getByTestId('invoice-row');
    expect(row).toHaveClass('grid', 'grid-cols-[minmax(0,1fr)_auto]', 'sm:grid-cols-[auto_minmax(0,1fr)_auto]');
    // The file icon only from sm up.
    expect(row.firstElementChild).toHaveClass('hidden', 'sm:flex');
    expect(within(row).getByText('INV-0001')).toHaveClass('whitespace-nowrap');
    expect(within(row).getByText('Nov 01, 2026').closest('span')).toHaveClass('whitespace-nowrap');
    expect(within(row).getByText('Initech International Holdings').closest('span')).toHaveClass('truncate');
  });

  it('totals stack as rows on phones and become three columns from sm', () => {
    const { container } = render(<TotalsStrip summary={summarizeInvoices([invoice], '2026-11-17')} />);
    expect(container.querySelector('section')).toHaveClass('grid-cols-1', 'divide-y', 'sm:grid-cols-3', 'sm:divide-x');
  });

  it('line items put the description on its own row on phones, with labelled Qty and Price below', () => {
    render(<InvoiceForm invoiceNumber="INV-0001" onFormChange={() => {}} initialData={{ lineItems: [{ id: 'a', description: '', quantity: 1, price: 0 }, { id: 'b', description: '', quantity: 1, price: 0 }] }} />);
    const description = screen.getByLabelText('Line item 1 description').closest('.col-span-12');
    expect(description).toHaveClass('sm:col-span-6');
    expect(screen.getByLabelText('Line item 1 quantity').closest('.col-span-4')).toHaveClass('sm:col-span-2');
    // Item 2 repeats the labels on phones only.
    expect(screen.getAllByText('Qty')[1]).toHaveClass('sm:hidden');
  });

  it('dashboard header and tabs fit at 320 px', () => {
    render(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('truncate', 'max-[359px]:sr-only');
    expect(screen.getByRole('button', { name: /coming soon/i }).querySelector('span')).toHaveClass('sr-only', 'sm:not-sr-only');
  });
});
