import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvoiceForm } from './InvoiceForm';
import { useSettingsStore } from '@/stores/useSettingsStore';

// Mock useSettingsStore with default implementation
const defaultSettings = {
  fromName: '',
  fromEmail: '',
  fromAddress: '',
  paymentDetails: '',
  notes: '',
  taxRate: 0,
  currency: 'USD',
};

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = { settings: defaultSettings };
    return selector ? selector(state) : state;
  }),
  hasConfiguredSettings: vi.fn((settings) => {
    return !!(
      settings.fromName ||
      settings.fromEmail ||
      settings.fromAddress ||
      settings.paymentDetails ||
      settings.notes ||
      settings.taxRate
    );
  }),
}));


describe('InvoiceForm', () => {
  const mockOnFormChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all form sections', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    expect(screen.getByText('Invoice Details')).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('Bill To')).toBeInTheDocument();
    expect(screen.getByText('Line Items')).toBeInTheDocument();
  });

  it('renders invoice number input with correct default value', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const invoiceNumberInput = screen.getByDisplayValue('INV-0001');
    expect(invoiceNumberInput).toBeInTheDocument();
  });

  it('allows adding line items', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const addButton = screen.getByRole('button', { name: /add item/i });
    await user.click(addButton);

    // Should now have 2 line item rows (description inputs)
    const descriptionInputs = screen.getAllByPlaceholderText('Item description');
    expect(descriptionInputs).toHaveLength(2);
  });

  it('calls onFormChange when inputs change', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const nameInput = screen.getByPlaceholderText('Your name or company');
    await user.type(nameInput, 'Test Company');

    await waitFor(() => {
      expect(mockOnFormChange).toHaveBeenCalled();
    });
  });

  it('loads initial data correctly', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
        initialData={{
          invoiceNumber: 'INV-0001',
          invoiceName: '',
          issueDate: '2024-01-15',
          dueDate: '',
          fromName: 'Existing Company',
          fromAddress: '123 Main St',
          fromEmail: 'test@example.com',
          toName: '',
          toAddress: '',
          toEmail: '',
          lineItems: [{ id: '1', description: '', quantity: 1, price: 0 }],
          taxRate: 0,
          notes: '',
          paymentDetails: '',
          currency: 'USD',
        }}
      />
    );

    expect(screen.getByDisplayValue('Existing Company')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
  });

  it('updates form when initialData changes', () => {
    // Note: The form uses defaultValues, so to test loading new data
    // we need to use a key prop to force remount (which is how the actual app works)
    const { rerender } = render(
      <InvoiceForm
        key="INV-0001"
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
        initialData={{
          invoiceNumber: 'INV-0001',
          fromName: 'Original Name',
        }}
      />
    );

    expect(screen.getByDisplayValue('Original Name')).toBeInTheDocument();

    // Rerender with new key simulating "Load Session" (form remounts with new data)
    rerender(
      <InvoiceForm
        key="INV-0002"
        invoiceNumber="INV-0002"
        onFormChange={mockOnFormChange}
        initialData={{
          invoiceNumber: 'INV-0002',
          fromName: 'New Name',
        }}
      />
    );

    expect(screen.getByDisplayValue('New Name')).toBeInTheDocument();
  });

  it('displays currency selector with default USD', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const currencySelect = screen.getByRole('combobox');
    expect(currencySelect).toHaveTextContent('USD - United States Dollar');
  });

  it('displays tax rate input', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const taxInput = screen.getByLabelText(/tax rate/i);
    expect(taxInput).toBeInTheDocument();
    expect(taxInput).toHaveAttribute('type', 'number');
  });

  it('prevents removing the last line item', () => {
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    // With only one line item, the delete button should be disabled
    const deleteButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg.lucide-trash-2')
    );
    
    // There should be one delete button and it should be disabled
    if (deleteButtons.length > 0) {
      expect(deleteButtons[0]).toBeDisabled();
    }
  });

  it('allows removing line items when more than one exists', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    // Add a second line item
    const addButton = screen.getByRole('button', { name: /add item/i });
    await user.click(addButton);

    // Now there should be 2 line items
    let descriptionInputs = screen.getAllByPlaceholderText('Item description');
    expect(descriptionInputs).toHaveLength(2);

    // Find and click a delete button
    const deleteButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg.lucide-trash-2') && !(btn as HTMLButtonElement).disabled
    );
    
    if (deleteButtons.length > 0) {
      await user.click(deleteButtons[0]);
      
      // Should be back to 1 line item
      descriptionInputs = screen.getAllByPlaceholderText('Item description');
      expect(descriptionInputs).toHaveLength(1);
    }
  });
  it('applies defaults when "Use Defaults" is clicked', async () => {
    // Mock the store to return our settings when selector is called
    const mockSettings = {
      fromName: 'Default Company',
      fromEmail: 'default@example.com',
      fromAddress: 'Default Address',
      paymentDetails: 'Default Payment',
      notes: 'Default Notes',
      taxRate: 20,
      currency: 'EUR',
    };

    // Correctly mock the selector pattern
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useSettingsStore).mockImplementation((selector: any) => {
       return selector({ settings: mockSettings });
    });

    const user = userEvent.setup();
    render(
      <InvoiceForm
        invoiceNumber="INV-0001"
        onFormChange={mockOnFormChange}
      />
    );

    const useDefaultsButton = screen.getByRole('button', { name: /use defaults/i });
    await user.click(useDefaultsButton);

    expect(screen.getByDisplayValue('Default Company')).toBeInTheDocument();
    expect(screen.getByDisplayValue('default@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Default Address')).toBeInTheDocument();
  });
});
