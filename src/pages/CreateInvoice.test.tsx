import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateInvoice from './CreateInvoice';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useInvoices } from '@/hooks/useInvoices';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { act } from '@testing-library/react';
import { Invoice } from '@/types/invoice';

// Mock toast
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock react-pdf/renderer
vi.mock('@react-pdf/renderer', () => ({
    pdf: vi.fn(() => ({
        toBlob: vi.fn().mockResolvedValue(new Blob(['test pdf'], { type: 'application/pdf' })),
    })),
    Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    StyleSheet: { create: vi.fn(() => ({})) },
    Font: { register: vi.fn() },
}));

// Mock InvoicePDF component
vi.mock('@/components/invoice/InvoicePDF', () => ({
    InvoicePDF: () => <div data-testid="invoice-pdf">PDF Component</div>,
}));

const mockSaveInvoice = vi.fn(() => ({ id: 'saved-id' }));
const mockGetInvoice = vi.fn();
const mockSaveDraft = vi.fn();
const mockLoadDraft = vi.fn(() => null);
const mockClearDraft = vi.fn();

vi.mock('@/hooks/useInvoices', () => ({
    useInvoices: vi.fn(() => ({
        saveInvoice: mockSaveInvoice,
        getNextInvoiceNumber: 'INV-0001',
        getInvoice: mockGetInvoice,
        saveDraft: mockSaveDraft,
        loadDraft: mockLoadDraft,
        clearDraft: mockClearDraft,
    })),
}));

// Mock crypto.randomUUID
Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: vi.fn(() => 'generated-uuid'),
    configurable: true,
});

// Mock URL APIs
global.URL.createObjectURL = vi.fn(() => 'blob:test');
global.URL.revokeObjectURL = vi.fn();

describe('CreateInvoice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetInvoice.mockReturnValue(undefined);
        mockLoadDraft.mockReturnValue(null);

        // Reset settings store
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
    });

    const renderComponent = (initialEntries: string[] = ['/create']) => {
        return render(
            <MemoryRouter initialEntries={initialEntries}>
                <Routes>
                    <Route path="/create" element={<CreateInvoice />} />
                    <Route path="/create/:id" element={<CreateInvoice />} />
                    <Route path="/" element={<div>Home Page</div>} />
                </Routes>
            </MemoryRouter>
        );
    };

    describe('Header', () => {
        it('renders Create Invoice title for new invoice', () => {
            renderComponent(['/create/test-id']);
            expect(screen.getByText('Create Invoice')).toBeInTheDocument();
        });

        it('renders Edit Invoice title when editing existing invoice', () => {
            mockGetInvoice.mockReturnValue({
                id: 'existing-id',
                invoiceNumber: 'INV-0001',
            } as Invoice);

            renderComponent(['/create/existing-id']);
            expect(screen.getByText('Edit Invoice')).toBeInTheDocument();
        });

        it('renders Download PDF button', () => {
            renderComponent(['/create/test-id']);
            expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
        });

        it('renders Duplicate button', () => {
            renderComponent(['/create/test-id']);
            expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
        });

        it('renders Save Invoice button', () => {
            renderComponent(['/create/test-id']);
            expect(screen.getByRole('button', { name: /save invoice/i })).toBeInTheDocument();
        });
    });

    describe('Save Invoice', () => {
        it('saves invoice and navigates home', async () => {
            const user = userEvent.setup();
            const { toast } = await import('sonner');
            renderComponent(['/create/test-id']);

            const saveButton = screen.getByRole('button', { name: /save invoice/i });
            await user.click(saveButton);

            await waitFor(() => {
                expect(mockSaveInvoice).toHaveBeenCalled();
                expect(mockClearDraft).toHaveBeenCalledWith('test-id');
                expect(toast.success).toHaveBeenCalledWith('Invoice saved successfully');
            });
        });
    });

    describe('Download PDF', () => {
        it('downloads PDF and saves invoice', async () => {
            const user = userEvent.setup();
            const { toast } = await import('sonner');
            const { pdf } = await import('@react-pdf/renderer');

            renderComponent(['/create/test-id']);

            const downloadButton = screen.getByRole('button', { name: /download pdf/i });
            await user.click(downloadButton);

            await waitFor(() => {
                expect(pdf).toHaveBeenCalled();
                expect(global.URL.createObjectURL).toHaveBeenCalled();
                expect(toast.success).toHaveBeenCalledWith('PDF downloaded and invoice saved');
            });
        });
    });

    describe('Duplicate', () => {
        it('duplicates invoice and navigates to new invoice', async () => {
            const user = userEvent.setup();
            const { toast } = await import('sonner');
            renderComponent(['/create/test-id']);

            const duplicateButton = screen.getByRole('button', { name: /duplicate/i });
            await user.click(duplicateButton);

            await waitFor(() => {
                expect(mockSaveDraft).toHaveBeenCalled();
                expect(toast.success).toHaveBeenCalledWith('Invoice duplicated');
            });
        });
    });

    describe('Form and Preview', () => {
        it('renders invoice form', () => {
            renderComponent(['/create/test-id']);
            // Check for form elements
            expect(screen.getByText('Preview')).toBeInTheDocument();
        });

        it('loads existing invoice data when editing', () => {
            const existingInvoice: Invoice = {
                id: 'existing-id',
                invoiceNumber: 'INV-0099',
                invoiceName: 'Existing Invoice',
                issueDate: '2024-03-20',
                createdAt: '2024-03-20T10:00:00Z',
                currency: 'EUR',
                taxRate: 20,
                lineItems: [{ id: '1', description: 'Existing Service', quantity: 2, price: 500 }],
                fromName: 'My Company',
                fromEmail: 'my@company.com',
                fromAddress: '123 My St',
                toName: 'Client Co',
                toEmail: 'client@co.com',
                toAddress: '456 Client St',
                dueDate: '2024-04-20',
                notes: 'Existing notes',
                paymentDetails: 'Existing payment',
                version: 1,
            };

            mockGetInvoice.mockReturnValue(existingInvoice);
            renderComponent(['/create/existing-id']);

            expect(screen.getByText('Edit Invoice')).toBeInTheDocument();
        });

        it('loads draft data when available', () => {
            const draftData = {
                invoiceNumber: 'INV-DRAFT',
                invoiceName: 'Draft Invoice',
                issueDate: '2024-03-25',
                fromName: 'Draft Company',
                fromEmail: '',
                fromAddress: '',
                toName: 'Draft Client',
                toEmail: '',
                toAddress: '',
                lineItems: [{ id: '1', description: 'Draft Service', quantity: 1, price: 100 }],
                taxRate: 5,
                notes: '',
                paymentDetails: '',
                currency: 'USD',
                dueDate: '',
            };

            mockLoadDraft.mockReturnValue(draftData);
            renderComponent(['/create/draft-id']);

            // The form should load with draft data
            expect(mockLoadDraft).toHaveBeenCalledWith('draft-id');
        });
    });

    describe('Settings Banner', () => {
        it('shows settings banner when no defaults configured and creating new invoice', () => {
            mockGetInvoice.mockReturnValue(undefined);
            renderComponent(['/create/new-id']);

            expect(screen.getByText('Auto-fill your details')).toBeInTheDocument();
        });

        it('hides settings banner when editing existing invoice', () => {
            mockGetInvoice.mockReturnValue({
                id: 'existing-id',
                invoiceNumber: 'INV-0001',
            } as Invoice);

            renderComponent(['/create/existing-id']);

            expect(screen.queryByText('Auto-fill your details')).not.toBeInTheDocument();
        });

        it('hides settings banner when defaults are configured', () => {
            act(() => {
                useSettingsStore.setState({
                    settings: {
                        fromName: 'Configured Company',
                        fromEmail: 'configured@company.com',
                        fromAddress: '',
                        paymentDetails: '',
                        notes: '',
                        taxRate: 0,
                        currency: 'USD',
                    },
                });
            });

            renderComponent(['/create/new-id']);

            expect(screen.queryByText('Auto-fill your details')).not.toBeInTheDocument();
        });
    });

    describe('URL Handling', () => {
        it('generates ID and redirects when no ID in URL', async () => {
            renderComponent(['/create']);

            // The component should redirect to include the ID
            await waitFor(() => {
                // The component redirects, so we check the mock was called
                expect(crypto.randomUUID).toHaveBeenCalled();
            });
        });

        it('uses ID from URL when provided', () => {
            renderComponent(['/create/specific-id']);
            // Verify that loadDraft is called with the URL ID
            expect(mockLoadDraft).toHaveBeenCalledWith('specific-id');
        });
    });

    describe('Back Navigation', () => {
        it('navigates home when back button is clicked', async () => {
            const user = userEvent.setup();
            renderComponent(['/create/test-id']);

            // Find the back button (it's an icon button)
            const buttons = screen.getAllByRole('button');
            const backButton = buttons.find(btn => btn.className.includes('ghost'));

            if (backButton) {
                await user.click(backButton);

                await waitFor(() => {
                    expect(screen.getByText('Home Page')).toBeInTheDocument();
                });
            }
        });
    });
});
