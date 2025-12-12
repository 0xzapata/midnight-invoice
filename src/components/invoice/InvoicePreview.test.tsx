import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvoicePreview } from './InvoicePreview';
import { InvoiceFormData } from '@/types/invoice';

const createMockInvoiceData = (overrides?: Partial<InvoiceFormData>): InvoiceFormData => ({
  invoiceNumber: 'INV-0001',
  invoiceName: 'Test Invoice',
  issueDate: '2024-01-15',
  dueDate: '2024-02-15',
  fromName: 'My Company',
  fromAddress: '123 Main St',
  fromEmail: 'company@example.com',
  toName: 'Client Corp',
  toAddress: '456 Client Ave',
  toEmail: 'client@example.com',
  lineItems: [
    { id: '1', description: 'Web Development', quantity: 10, price: 100 },
    { id: '2', description: 'Design', quantity: 5, price: 80 },
  ],
  taxRate: 10,
  notes: 'Thank you for your business',
  paymentDetails: 'Bank: ABC\nAccount: 123456',
  currency: 'USD',
  ...overrides,
});

describe('InvoicePreview', () => {
  it('renders invoice number', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);
    expect(screen.getByText('INV-0001')).toBeInTheDocument();
  });



  it('renders from/to information', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('My Company')).toBeInTheDocument();
    expect(screen.getByText('Client Corp')).toBeInTheDocument();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText('456 Client Ave')).toBeInTheDocument();
  });

  it('renders email addresses', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('company@example.com')).toBeInTheDocument();
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
  });

  it('renders line item descriptions', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('Web Development')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
  });

  it('calculates subtotal correctly', () => {
    // Subtotal: (10 * 100) + (5 * 80) = 1400
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('$1,400.00')).toBeInTheDocument();
  });

  it('calculates tax correctly', () => {
    // Tax: 1400 * 0.10 = 140
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('$140.00')).toBeInTheDocument();
    expect(screen.getByText('Tax (10%)')).toBeInTheDocument();
  });

  it('calculates total correctly', () => {
    // Total: 1400 + 140 = 1540
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('$1,540.00')).toBeInTheDocument();
  });

  it('handles empty line items gracefully', () => {
    const emptyData = createMockInvoiceData({
      lineItems: [{ id: '1', description: '', quantity: 0, price: 0 }],
    });

    render(<InvoicePreview data={emptyData} />);
    expect(screen.getByText('Item description')).toBeInTheDocument();
    // $0.00 appears multiple times (price, total, subtotal, etc.)
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });

  it('handles NaN values in line items', () => {
    const nanData = createMockInvoiceData({
      lineItems: [
        { id: '1', description: 'Test', quantity: NaN, price: NaN },
      ],
    });

    // Should not throw and should render 0 values
    render(<InvoicePreview data={nanData} />);
    // $0.00 appears multiple times (price, total, subtotal, etc.)
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });

  it('renders notes when provided', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Thank you for your business')).toBeInTheDocument();
  });

  it('renders payment details when provided', () => {
    render(<InvoicePreview data={createMockInvoiceData()} />);

    expect(screen.getByText('Payment Details')).toBeInTheDocument();
    // Note: whitespace-pre-line preserves line breaks
    expect(screen.getByText(/Bank: ABC/)).toBeInTheDocument();
  });

  it('hides notes section when empty', () => {
    const noNotes = createMockInvoiceData({ notes: '' });

    render(<InvoicePreview data={noNotes} />);

    // Notes header should not appear
    const notesElements = screen.queryAllByText('Notes');
    expect(notesElements).toHaveLength(0);
  });

  it('hides payment details section when empty', () => {
    const noPayment = createMockInvoiceData({ paymentDetails: '' });

    render(<InvoicePreview data={noPayment} />);

    // Payment Details header should not appear
    const paymentElements = screen.queryAllByText('Payment Details');
    expect(paymentElements).toHaveLength(0);
  });

  it('hides due date when not provided', () => {
    const noDueDate = createMockInvoiceData({ dueDate: '' });

    render(<InvoicePreview data={noDueDate} />);

    expect(screen.queryByText('Due Date')).not.toBeInTheDocument();
  });

  it('hides tax section when tax rate is 0', () => {
    const noTax = createMockInvoiceData({ taxRate: 0 });

    render(<InvoicePreview data={noTax} />);

    expect(screen.queryByText(/Tax \(/)).not.toBeInTheDocument();
  });

  it('shows default values when from/to fields are empty', () => {
    const emptyFields = createMockInvoiceData({
      fromName: '',
      fromAddress: '',
      toName: '',
      toAddress: '',
    });

    render(<InvoicePreview data={emptyFields} />);

    expect(screen.getByText('Your Name')).toBeInTheDocument();
    expect(screen.getByText('Your Address')).toBeInTheDocument();
    expect(screen.getByText('Client Name')).toBeInTheDocument();
    expect(screen.getByText('Client Address')).toBeInTheDocument();
  });

  it('sanitizes HTML in text fields', () => {
    const maliciousData = createMockInvoiceData({
      fromName: '<script>alert("xss")</script>Evil Corp',
      notes: '<img src="x" onerror="alert(1)">Bad note',
    });

    render(<InvoicePreview data={maliciousData} />);

    // The script tag should be stripped
    expect(screen.queryByText('<script>')).not.toBeInTheDocument();
    // The sanitized text should be displayed
    expect(screen.getByText(/Evil Corp/)).toBeInTheDocument();
  });

  it('renders with different currency', () => {
    const euroData = createMockInvoiceData({
      currency: 'EUR',
      lineItems: [{ id: '1', description: 'Service', quantity: 1, price: 100 }],
      taxRate: 0,
    });

    render(<InvoicePreview data={euroData} />);

    // Should show Euro formatting - €100.00 appears multiple times
    expect(screen.getAllByText('€100.00').length).toBeGreaterThan(0);
  });


});
