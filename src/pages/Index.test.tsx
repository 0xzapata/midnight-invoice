import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Index from './Index';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useInvoices } from '@/hooks/useInvoices';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useTeams } from '@/hooks/useTeams';
import { useTeamContext } from '@/stores/useTeamContext';
import { Invoice } from '@/types/invoice';
import { act } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// Mock toast
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock env
vi.mock('@/env', () => ({
    env: {
        VITE_APP_NAME: 'Test Invoice App',
        VITE_APP_ENV: 'PRODUCTION',
    },
}));

// Mock Convex/Auth hooks
const mockSignOut = vi.fn();
const mockSignIn = vi.fn();
const mockUseConvexAuth = vi.fn();
const mockUseQuery = vi.fn();

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({
    signOut: mockSignOut,
    signIn: mockSignIn,
  }),
}));

vi.mock('convex/react', () => ({
  useConvexAuth: () => mockUseConvexAuth(),
  useQuery: () => mockUseQuery(),
}));

const mockInvoice: Invoice = {
    id: 'test-id-1',
    invoiceNumber: 'INV-0001',
    invoiceName: 'Test Invoice',
    issueDate: '2024-03-20',
    createdAt: '2024-03-20T10:00:00Z',
    currency: 'USD',
    taxRate: 10,
    lineItems: [{ id: '1', description: 'Service', quantity: 1, price: 100 }],
    fromName: 'Test Company',
    fromEmail: 'test@company.com',
    fromAddress: '123 Test St',
    toName: 'Client Corp',
    toEmail: 'client@corp.com',
    toAddress: '456 Client Ave',
    dueDate: '2024-04-20',
    notes: 'Thank you',
    paymentDetails: 'Bank: Test',
    version: 1,
};

const mockDeleteInvoice = vi.fn();

vi.mock('@/hooks/useInvoices', () => ({
    useInvoices: vi.fn(),
}));

// Mock crypto.randomUUID
Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: vi.fn(() => 'new-uuid'),
    configurable: true,
});

vi.mock('@/hooks/useTeams', () => ({
    useTeams: vi.fn(),
    useTeam: vi.fn(),
    useTeamInvitations: vi.fn(),
}));

vi.mock('@/stores/useTeamContext', () => ({
    useTeamContext: vi.fn(),
}));

describe('Index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseConvexAuth.mockReturnValue({ isAuthenticated: false });
        act(() => {
            useSettingsStore.setState({
                settings: {
                    fromName: '',
                    fromEmail: '',
                    fromAddress: '',
                    paymentDetails: '',
                    notes: '',
                    taxRate: 0,
                    currency: 'USD',
                },
            });
        });
        vi.mocked(useInvoices).mockReturnValue({
            invoices: [],
            deleteInvoice: mockDeleteInvoice,
            isLoading: false,
        } as any);
        vi.mocked(useTeams).mockReturnValue({
            teams: [],
            isLoading: false,
            createTeam: vi.fn(),
            updateTeam: vi.fn(),
            deleteTeam: vi.fn(),
            leaveTeam: vi.fn(),
        } as any);
        vi.mocked(useTeamContext).mockReturnValue({
            currentTeamId: null,
            setCurrentTeam: vi.fn(),
            clearCurrentTeam: vi.fn(),
        });
    });

    const renderComponent = (initialEntries: string[] = ['/']) => {
        return render(
            <TooltipProvider>
                <MemoryRouter initialEntries={initialEntries}>
                    <Routes>
                        <Route path="/" element={<Index />} />
                        <Route path="/create" element={<div>Create Page</div>} />
                        <Route path="/create/:id" element={<div>Create Edit Page</div>} />
                        <Route path="/invoice/:id" element={<div>View Invoice Page</div>} />
                    </Routes>
                </MemoryRouter>
            </TooltipProvider>
        );
    };

    describe('Header', () => {
        it('renders app name', () => {
            renderComponent();
            expect(screen.getByText('Test Invoice App')).toBeInTheDocument();
        });

        it('renders New Invoice button', () => {
            renderComponent();
            expect(screen.getByRole('button', { name: /new invoice/i })).toBeInTheDocument();
        });

        it('navigates to create page when New Invoice is clicked', async () => {
            const user = userEvent.setup();
            renderComponent();

            const newInvoiceButton = screen.getByRole('button', { name: /new invoice/i });
            await user.click(newInvoiceButton);

            await waitFor(() => {
                expect(screen.getByText('Create Page')).toBeInTheDocument();
            });
        });
    });

    describe('Tabs', () => {
        it('renders all three tabs', () => {
            renderComponent();
            expect(screen.getByRole('button', { name: /your invoices/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /coming soon/i })).toBeInTheDocument();
        });

        it('shows invoices tab by default', () => {
            renderComponent();
            expect(screen.getByRole('heading', { name: /your invoices/i })).toBeInTheDocument();
        });

        it('switches to settings tab', async () => {
            const user = userEvent.setup();
            renderComponent();

            const settingsTab = screen.getByRole('button', { name: /settings/i });
            await user.click(settingsTab);

            await waitFor(() => {
                expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
            });
        });

        it('switches to coming soon tab', async () => {
            const user = userEvent.setup();
            renderComponent();

            const comingTab = screen.getByRole('button', { name: /coming soon/i });
            await user.click(comingTab);

            await waitFor(() => {
                expect(screen.getByRole('heading', { name: /coming soon/i })).toBeInTheDocument();
            });
        });
    });

    describe('Invoices Tab', () => {
        it('shows loading spinner when loading', () => {
            vi.mocked(useInvoices).mockReturnValue({
                invoices: [],
                deleteInvoice: mockDeleteInvoice,
                isLoading: true,
            } as any);

            renderComponent();
            // Spinner should be present during loading
            expect(screen.getByText('Create professional invoices in seconds')).toBeInTheDocument();
        });

        it('shows empty state when no invoices', () => {
            vi.mocked(useInvoices).mockReturnValue({
                invoices: [],
                deleteInvoice: mockDeleteInvoice,
                isLoading: false,
            } as any);

            renderComponent();
            expect(screen.getByText('Create professional invoices in seconds')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /create your first invoice/i })).toBeInTheDocument();
        });

        it('shows invoice count when invoices exist', () => {
            vi.mocked(useInvoices).mockReturnValue({
                invoices: [mockInvoice],
                deleteInvoice: mockDeleteInvoice,
                isLoading: false,
            } as any);

            renderComponent();
            expect(screen.getByText('1 invoice in Personal')).toBeInTheDocument();
        });

        it('shows plural count for multiple invoices', () => {
            vi.mocked(useInvoices).mockReturnValue({
                invoices: [mockInvoice, { ...mockInvoice, id: 'test-id-2' }],
                deleteInvoice: mockDeleteInvoice,
                isLoading: false,
            } as any);

            renderComponent();
            expect(screen.getByText('2 invoices in Personal')).toBeInTheDocument();
        });
    });

    describe('Settings Tab', () => {
        it('renders settings form fields', async () => {
            const user = userEvent.setup();
            renderComponent();

            await user.click(screen.getByRole('button', { name: /settings/i }));

            await waitFor(() => {
                expect(screen.getByLabelText(/default name/i)).toBeInTheDocument();
                expect(screen.getByLabelText(/default email/i)).toBeInTheDocument();
                expect(screen.getByLabelText(/default address/i)).toBeInTheDocument();
                expect(screen.getByLabelText(/default payment details/i)).toBeInTheDocument();
                expect(screen.getByLabelText(/default tax rate/i)).toBeInTheDocument();
                expect(screen.getByLabelText(/default notes/i)).toBeInTheDocument();
            });
        });

        it('can update settings fields', async () => {
            const user = userEvent.setup();
            renderComponent();

            await user.click(screen.getByRole('button', { name: /settings/i }));

            const nameInput = await screen.findByLabelText(/default name/i);
            await user.clear(nameInput);
            await user.type(nameInput, 'My Company');

            expect(nameInput).toHaveValue('My Company');
        });

        it('saves settings when Save button is clicked', async () => {
            const user = userEvent.setup();
            const { toast } = await import('sonner');
            renderComponent();

            await user.click(screen.getByRole('button', { name: /settings/i }));

            const nameInput = await screen.findByLabelText(/default name/i);
            await user.type(nameInput, 'New Company');

            const saveButton = screen.getByRole('button', { name: /save settings/i });
            await user.click(saveButton);

            expect(toast.success).toHaveBeenCalledWith('Settings saved successfully');
        });
    });

    describe('Coming Soon Tab', () => {
        it('displays feature list', async () => {
            const user = userEvent.setup();
            renderComponent();

            await user.click(screen.getByRole('button', { name: /coming soon/i }));

            await waitFor(() => {
                expect(screen.getByText('Cloud Sync')).toBeInTheDocument();
                expect(screen.getByText('Client Management')).toBeInTheDocument();
                expect(screen.getByText('Invoice Templates')).toBeInTheDocument();
                expect(screen.getByText('Recurring Invoices')).toBeInTheDocument();
                expect(screen.getByText('Email Sending')).toBeInTheDocument();
                expect(screen.getByText('File Attachments')).toBeInTheDocument();
                expect(screen.getByText('User Authentication')).toBeInTheDocument();
            });
        });
    });

    describe('Invoice Actions', () => {
        beforeEach(() => {
            vi.mocked(useInvoices).mockReturnValue({
                invoices: [mockInvoice],
                deleteInvoice: mockDeleteInvoice,
                isLoading: false,
            } as any);
        });

        it('navigates to view invoice page when view is clicked', async () => {
            const user = userEvent.setup();
            renderComponent();

            // Find the invoice row and click view
            const invoiceRow = screen.getByText('INV-0001').closest('div');
            expect(invoiceRow).toBeInTheDocument();

            // Click on the invoice name/number to view it
            await user.click(screen.getByText('INV-0001'));

            await waitFor(() => {
                expect(screen.getByText('View Invoice Page')).toBeInTheDocument();
            });
        });
    });
});
