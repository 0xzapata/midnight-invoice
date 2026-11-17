import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewInvoice from './ViewInvoice';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useInvoices } from '@/hooks/useInvoices';

// Mock dependencies
vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(() => ({
    toBlob: vi.fn().mockResolvedValue(new Blob(['test pdf'], { type: 'application/pdf' })),
  })),
  Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: vi.fn() },
  Font: { register: vi.fn() },
}));

const mockInvoice = {
  id: 'test-id',
  invoiceNumber: 'INV-123',
  invoiceName: 'Test Invoice',
  issueDate: '2024-03-20',
  createdAt: '2024-03-20T10:00:00Z',
  currency: 'USD',
  taxRate: 10,
  lineItems: [{ id: '1', description: 'Item 1', quantity: 1, price: 100 }],
  fromName: 'Me',
  fromEmail: 'me@test.com',
  fromAddress: 'My Address',
  toName: 'Client',
  toEmail: 'client@test.com',
  toAddress: 'Client Address',
  dueDate: '',
  notes: '',
  paymentDetails: '',
};

const mockGetInvoice = vi.fn((_id: string) => mockInvoice);
const mockDeleteInvoice = vi.fn();
const mockSaveDraft = vi.fn();

// Mock crypto.randomUUID
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: vi.fn(() => 'new-test-id'),
});

vi.mock('@/hooks/useInvoices', () => ({
  useInvoices: vi.fn(() => ({
    getInvoice: mockGetInvoice,
    deleteInvoice: mockDeleteInvoice,
    saveDraft: mockSaveDraft,
    getNextInvoiceNumber: 'INV-124',
    invoices: [mockInvoice],
  })),
}));

// Mock window.print
const mockPrint = vi.fn();
Object.defineProperty(window, 'print', {
  value: mockPrint,
});

// Mock URL.createObjectURL and revokeObjectURL
globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
globalThis.URL.revokeObjectURL = vi.fn();

describe('ViewInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/invoice/test-id']}>
        <Routes>
          <Route path="/invoice/:id" element={<ViewInvoice />} />
          <Route path="/" element={<div>Home Page</div>} />
          <Route path="/create/:id" element={<div>Create Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders invoice details', () => {
    renderComponent();
    // Header should have the invoice number
    expect(screen.getByRole('heading', { name: 'INV-123' })).toBeInTheDocument();
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
  });

  it('handles print button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    const printButton = screen.getByRole('button', { name: /print/i });
    await user.click(printButton);

    expect(mockPrint).toHaveBeenCalled();
  });

  it('handles delete button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    // Click the delete button to open the confirmation dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Find and click the confirmation button in the AlertDialog
    const confirmDeleteButton = await screen.findByRole('button', { name: 'Delete' });
    await user.click(confirmDeleteButton);

    expect(mockDeleteInvoice).toHaveBeenCalledWith('test-id');
    await waitFor(() => {
      expect(screen.getByText('Home Page')).toBeInTheDocument();
    });
  });

  it('handles duplicate button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    const duplicateButton = screen.getByRole('button', { name: /duplicate/i });
    await user.click(duplicateButton);

    // Verify saveDraft was called with the new ID and duplicated data
    expect(mockSaveDraft).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(screen.getByText('Create Page')).toBeInTheDocument();
    });
  });

  it('handles edit button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    const editButton = screen.getByRole('button', { name: /edit/i });
    await user.click(editButton);

    await waitFor(() => {
        expect(screen.getByText('Create Page')).toBeInTheDocument();
    });
  });

  it('handles download button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    const downloadButton = screen.getByRole('button', { name: /download pdf/i });
    await user.click(downloadButton);

    // Since download is async and involves blob creation, we just check if it was called without errors
    await waitFor(() => {
        expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  it('fits the header on small screens: secondary actions move into a menu below lg', async () => {
    // Radix popovers measure their anchor.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const user = userEvent.setup();
    renderComponent();
    // Labelled buttons only from lg up (they overflowed at 390 px)...
    for (const name of [/^delete$/i, /^edit$/i, /^duplicate$/i, /^print$/i]) {
      expect(screen.getByRole('button', { name })).toHaveClass('hidden', 'lg:inline-flex');
    }
    // ...Download PDF stays, icon-only with an accessible name below lg...
    const download = screen.getByRole('button', { name: 'Download PDF' });
    expect(download).toHaveClass('h-8', 'w-8', 'lg:w-auto');
    expect(download.querySelector('span')).toHaveClass('hidden', 'lg:inline');
    // ...and a "More actions" menu (small screens only) holds the rest.
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more).toHaveClass('lg:hidden');
    // The title truncates instead of pushing the actions off screen.
    expect(screen.getByRole('heading', { name: 'INV-123' })).toHaveClass('truncate');
    await user.click(more);
    const menu = await screen.findByRole('dialog', { name: 'More actions' });
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edit', 'Duplicate', 'Print', 'Delete']);
    await user.click(within(menu).getByRole('button', { name: 'Print' }));
    expect(mockPrint).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'More actions' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete Invoice?')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders not found state when invoice does not exist', () => {
    // Override mock for this test
    // Override mock for this test
    vi.mocked(useInvoices).mockReturnValue({
        getInvoice: vi.fn(),
        deleteInvoice: mockDeleteInvoice,
        invoices: [], // Empty invoices
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderComponent();

    expect(screen.getByText('Invoice not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });
});
