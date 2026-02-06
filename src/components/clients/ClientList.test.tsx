
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientList } from './ClientList';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// Mocks
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockRemove = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: () => mockUseQuery(),
  useMutation: () => mockRemove,
}));

vi.mock('../../../convex/_generated/api', () => ({
  api: {
    clients: {
      list: 'list',
      remove: 'remove',
    }
  }
}));

// Mock toaster
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ClientList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading spinner when undefined', () => {
        mockUseQuery.mockReturnValue(undefined);
        render(<ClientList />);
        // Spinner usually has role="status" or we can look for "Loading..." text if available, 
        // or just check if content is missing.
        // Based on code: <Spinner size="lg" />
        // Assuming Spinner renders something identifiable.
        // Let's just check that "Clients" header is NOT there yet? No, header is there? 
        // Wait, the Spinner is returned BEFORE the header in the component.
        expect(screen.queryByText(/Manage your client details/i)).not.toBeInTheDocument();
    });

    it('shows empty state when no clients', () => {
        mockUseQuery.mockReturnValue([]);
        render(<ClientList />);
        expect(screen.getByText('No clients found.')).toBeInTheDocument();
        expect(screen.getByText('Create your first client')).toBeInTheDocument();
    });

    it('renders client list', () => {
        mockUseQuery.mockReturnValue([
            { _id: '1', name: 'Acme Corp', email: 'a@b.com' },
            { _id: '2', name: 'Globex', address: '123 Fake St' }
        ]);
        render(<ClientList />);
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('Globex')).toBeInTheDocument();
        expect(screen.getByText('a@b.com')).toBeInTheDocument();
    });

    it('opens modal on add click', () => {
        mockUseQuery.mockReturnValue([]);
        render(<ClientList />);
        
        const addBtn = screen.getByText('Add Client');
        fireEvent.click(addBtn);
        
        expect(screen.getByText('Add New Client')).toBeInTheDocument();
    });
});
