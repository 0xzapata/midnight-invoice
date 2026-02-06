
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MigrationModal } from './MigrationModal';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useInvoiceStore } from '@/stores/useInvoiceStore';

// Mock dependencies
const mockBatchCreate = vi.fn();
const mockUseConvexAuth = vi.fn();

vi.mock('convex/react', () => ({
  useMutation: () => mockBatchCreate,
  useConvexAuth: () => mockUseConvexAuth(),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('MigrationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInvoiceStore.setState({ invoices: [], drafts: {} });
  });

  it('does not show when unauthenticated', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: false });
    useInvoiceStore.setState({ 
      invoices: [{ id: '1', invoiceNumber: 'INV-1' } as any] 
    });

    render(<MigrationModal />);
    expect(screen.queryByText(/Sync Invoices to Cloud/i)).not.toBeInTheDocument();
  });

  it('does not show when no local invoices', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    useInvoiceStore.setState({ invoices: [] });

    render(<MigrationModal />);
    expect(screen.queryByText(/Sync Invoices to Cloud/i)).not.toBeInTheDocument();
  });

  it('shows when authenticated and has local invoices', () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    useInvoiceStore.setState({ 
      invoices: [{ id: '1', invoiceNumber: 'INV-1' } as any] 
    });

    render(<MigrationModal />);
    expect(screen.getByText(/Sync Invoices to Cloud/i)).toBeInTheDocument();
    expect(screen.getByText(/found 1 invoice/i)).toBeInTheDocument();
  });

  it('calls batchCreate and clears store on sync', async () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    useInvoiceStore.setState({ 
      invoices: [{ id: '1', invoiceNumber: 'INV-1', clientSnapshot: {} } as any] 
    });

    render(<MigrationModal />);
    
    const syncBtn = screen.getByText('Sync Invoices');
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(mockBatchCreate).toHaveBeenCalled();
    });

    expect(useInvoiceStore.getState().invoices).toHaveLength(0);
  });

  it('clears store on skip', async () => {
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    useInvoiceStore.setState({ 
      invoices: [{ id: '1', invoiceNumber: 'INV-1' } as any] 
    });

    render(<MigrationModal />);
    
    const skipBtn = screen.getByText('Skip & Clear Local');
    fireEvent.click(skipBtn);

    await waitFor(() => {
        expect(useInvoiceStore.getState().invoices).toHaveLength(0);
    });
    
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });
});
