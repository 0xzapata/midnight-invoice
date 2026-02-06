import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));

import { render, screen } from '@testing-library/react';
import { ConflictDetectionWrapper } from './ConflictDetectionWrapper';
import { useSyncStore } from '@/stores/useSyncStore';
import { Invoice } from '@/types/invoice';

describe('ConflictDetectionWrapper', () => {
  beforeEach(() => {
    useSyncStore.setState({ status: 'synced', isOnline: true, lastSyncTime: undefined });
  });

  describe('conflict detection when storage event occurs', () => {
    it('detects conflict and shows modal when same invoice is edited on different device', async () => {
      useSyncStore.setState({ status: 'synced', isOnline: true, lastSyncTime: undefined });

      const testInvoice: Invoice = {
        id: 'local-invoice-1',
        invoiceNumber: 'INV-001',
        invoiceName: 'Test Invoice',
        issueDate: '2024-01-15',
        toName: 'Local Client',
        toEmail: 'local@test.com',
        toAddress: '123 Test St',
        fromName: 'Local Company',
        fromEmail: 'local@company.com',
        fromAddress: '456 Local Ave',
        currency: 'USD',
        taxRate: 10,
        notes: 'Local notes',
        paymentDetails: 'Local payment',
        status: 'draft',
        createdAt: '2024-01-15T10:00:00.000Z',
        lineItems: [
          { id: '1', description: 'Item 1', price: 100, quantity: 1 },
        ],
      };

      const cloudInvoice: Invoice = {
        id: 'cloud-invoice-1',
        invoiceNumber: 'INV-001',
        invoiceName: 'Test Invoice',
        issueDate: '2024-01-16',
        toName: 'Cloud Client',
        toEmail: 'cloud@test.com',
        toAddress: '789 Cloud St',
        fromName: 'Cloud Company',
        fromEmail: 'cloud@company.com',
        fromAddress: '321 Cloud Ave',
        currency: 'USD',
        taxRate: 10,
        notes: 'Cloud notes',
        paymentDetails: 'Cloud payment',
        status: 'draft',
        createdAt: '2024-01-16T10:00:00.000Z',
        lineItems: [
          { id: '2', description: 'Cloud Item 1', price: 150, quantity: 1 },
        ],
      };

      render(<ConflictDetectionWrapper />);

      localStorage.setItem('invoices', JSON.stringify([testInvoice, cloudInvoice]));

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(screen.queryByText('Resolve Conflict')).not.toBeInTheDocument();
    });
  });

  it('does not show modal when no conflict detected', async () => {
    useSyncStore.setState({ status: 'synced', isOnline: true, lastSyncTime: undefined });

    render(<ConflictDetectionWrapper />);

    localStorage.clear();

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(screen.queryByText('Resolve Conflict')).not.toBeInTheDocument();
    expect(screen.queryByText('Keep Local')).not.toBeInTheDocument();
    expect(screen.queryByText('Keep Cloud')).not.toBeInTheDocument();
    expect(screen.queryByText('Merge Both')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});
