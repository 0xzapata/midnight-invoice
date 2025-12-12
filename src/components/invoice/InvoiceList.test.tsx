import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvoiceList } from './InvoiceList';
import { Invoice } from '@/types/invoice';

const mockInvoices: Invoice[] = [
  {
    id: '1',
    invoiceNumber: 'INV-001',
    invoiceName: 'Test Invoice 1',
    toName: 'Client A',
    issueDate: '2024-03-20',
    createdAt: '2024-03-20T10:00:00Z',
    currency: 'USD',
    taxRate: 10,
    lineItems: [{ id: '1', description: 'Item 1', quantity: 1, price: 100 }],
    fromName: 'Me',
    fromEmail: 'me@test.com',
    fromAddress: '',
    toEmail: '',
    toAddress: '',
    dueDate: '',
    notes: '',
    paymentDetails: '',
  },
  {
    id: '2',
    invoiceNumber: 'INV-002',
    invoiceName: 'Test Invoice 2',
    toName: 'Client B',
    issueDate: '2024-03-21',
    createdAt: '2024-03-21T10:00:00Z',
    currency: 'EUR',
    taxRate: 0,
    lineItems: [{ id: '2', description: 'Item 2', quantity: 2, price: 50 }],
    fromName: 'Me',
    fromEmail: 'me@test.com',
    fromAddress: '',
    toEmail: '',
    toAddress: '',
    dueDate: '',
    notes: '',
    paymentDetails: '',
  },
];

describe('InvoiceList', () => {
  const mockHandlers = {
    onView: vi.fn(),
    onLoadSession: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders empty state when no invoices provided', () => {
    render(
      <InvoiceList
        invoices={[]}
        {...mockHandlers}
      />
    );
    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
  });

  it('renders list of invoices', () => {
    render(
      <InvoiceList
        invoices={mockInvoices}
        {...mockHandlers}
      />
    );

    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('Test Invoice 1')).toBeInTheDocument();
    expect(screen.getByText('INV-002')).toBeInTheDocument();
    expect(screen.getByText('Test Invoice 2')).toBeInTheDocument();
  });


  it('calls onView when clicking invoice row', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceList
        invoices={mockInvoices}
        {...mockHandlers}
      />
    );

    // Use a more specific selector if needed, or just text
    await user.click(screen.getByText('Test Invoice 1'));
    expect(mockHandlers.onView).toHaveBeenCalledWith(mockInvoices[0]);
  });

  it('calls onLoadSession when clicking edit button', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceList
        invoices={mockInvoices}
        {...mockHandlers}
      />
    );

    const editButtons = screen.getAllByTitle('Load Session');
    await user.click(editButtons[0]);
    
    expect(mockHandlers.onLoadSession).toHaveBeenCalledWith(mockInvoices[0]);
  });

  it('calls onDuplicate when clicking duplicate button', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceList
        invoices={mockInvoices}
        {...mockHandlers}
      />
    );

    const duplicateButtons = screen.getAllByTitle('Duplicate Invoice');
    await user.click(duplicateButtons[0]);

    expect(mockHandlers.onDuplicate).toHaveBeenCalledWith(mockInvoices[0]);
  });

  it('calls onDelete when clicking delete button', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceList
        invoices={mockInvoices}
        {...mockHandlers}
      />
    );

    const deleteButtons = screen.getAllByTitle('Delete Invoice');
    await user.click(deleteButtons[0]);

    expect(mockHandlers.onDelete).toHaveBeenCalledWith('1');
  });
});
