import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SyncIssueNotice } from './SyncIssueNotice';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useCloudStore } from '@/stores/useCloudStore';
import { invoiceIssues } from '@/lib/validation';
import type { Invoice } from '@/types/invoice';

const invalid: Invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-0007',
  issueDate: '2026-11-01',
  fromName: '',
  fromAddress: '',
  fromEmail: 'not-an-email',
  toName: 'Globex',
  toAddress: '',
  toEmail: '',
  lineItems: [
    { id: 'a', description: 'Design', quantity: 1, price: 10 },
    { id: 'b', description: '', quantity: 1, price: 10 },
  ],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  createdAt: '2026-11-01T10:00:00.000Z',
};

describe('invoiceIssues', () => {
  it('names every field the API would reject, in plain language', () => {
    expect(invoiceIssues(invalid)).toEqual([
      { field: 'fromName', message: 'Your name/company is required' },
      { field: 'fromEmail', message: 'Your email: Invalid email format' },
      { field: 'lineItems[1].description', message: 'Line item 2: Description is required' },
    ]);
    expect(invoiceIssues({ ...invalid, fromName: 'Me', fromEmail: '', lineItems: [invalid.lineItems[0]] })).toEqual([]);
  });
});

describe('"Not synced" is actionable', () => {
  beforeEach(() => {
    useCloudStore.setState({ syncErrors: { 'inv-1': 'Validation failed' } });
  });

  it('lists exactly what to fix and links to the editor', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/invoice/inv-1']}>
        <Routes>
          <Route path="/invoice/:id" element={<SyncIssueNotice invoice={invalid} />} />
          <Route path="/create/:id" element={<p>Editor</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not synced/)).toBeInTheDocument();
    expect(screen.getByText('Your name/company is required')).toBeInTheDocument();
    expect(screen.getByText('Line item 2: Description is required')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /edit to fix/i }));
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('falls back to the server message when the local schema finds nothing', () => {
    useCloudStore.setState({ syncErrors: { 'inv-1': 'Invoice number must be at most 64 characters' } });
    const valid = { ...invalid, fromName: 'Me', fromEmail: '', lineItems: [invalid.lineItems[0]] };
    render(<MemoryRouter><SyncIssueNotice invoice={valid} /></MemoryRouter>);
    expect(screen.getByText('Invoice number must be at most 64 characters')).toBeInTheDocument();
  });

  it('renders nothing for an invoice that synced fine', () => {
    useCloudStore.setState({ syncErrors: {} });
    const { container } = render(<MemoryRouter><SyncIssueNotice invoice={invalid} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('the dashboard badge names the fields and opens the editor', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <InvoiceList invoices={[invalid]} onView={() => {}} onLoadSession={(inv) => opened.push(inv.id)} onDuplicate={() => {}} onDelete={() => {}} />,
    );
    const badge = screen.getByRole('button', { name: /not synced/i });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Line item 2: Description is required'));
    await user.click(badge);
    expect(opened).toEqual(['inv-1']);
  });
});
