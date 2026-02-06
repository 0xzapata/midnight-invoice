import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock convex/react BEFORE any imports that use it
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
  }),
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { useInvoices } from './useInvoices';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { InvoiceFormData } from '@/types/invoice';

// Sample form data for testing
const createMockFormData = (overrides: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
    invoiceNumber: 'INV-0001',
    invoiceName: 'Test Invoice',
    issueDate: '2024-01-15',
    dueDate: '2024-02-15',
    fromName: 'Test Company',
    fromAddress: '123 Test St',
    fromEmail: 'test@example.com',
    toName: 'Client Company',
    toAddress: '456 Client Ave',
    toEmail: 'client@example.com',
    lineItems: [
        { id: '1', description: 'Service', quantity: 1, price: 100 }
    ],
    taxRate: 10,
    notes: 'Thank you!',
    paymentDetails: 'Bank: Test Bank',
    currency: 'USD',
    ...overrides,
});

describe('useInvoices', () => {
    beforeEach(() => {
        // Reset the store before each test
        act(() => {
            useInvoiceStore.setState({
                invoices: [],
                drafts: {},
                _hasHydrated: true, // Start hydrated for most tests
            });
        });
    });

    describe('isLoading', () => {
        it('returns true when store has not hydrated', () => {
            act(() => {
                useInvoiceStore.setState({ _hasHydrated: false });
            });

            const { result } = renderHook(() => useInvoices());
            expect(result.current.isLoading).toBe(true);
        });

        it('returns false when store has hydrated', () => {
            act(() => {
                useInvoiceStore.setState({ _hasHydrated: true });
            });

            const { result } = renderHook(() => useInvoices());
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe('invoices', () => {
        it('returns empty array initially', () => {
            const { result } = renderHook(() => useInvoices());
            expect(result.current.invoices).toEqual([]);
        });

        it('returns invoices from store', () => {
            const formData = createMockFormData();

            act(() => {
                useInvoiceStore.getState().saveInvoice(formData, 'test-id');
            });

            const { result } = renderHook(() => useInvoices());
            expect(result.current.invoices.length).toBe(1);
            expect(result.current.invoices[0].invoiceNumber).toBe('INV-0001');
        });
    });

    describe('saveInvoice', () => {
        it('saves an invoice to the store', () => {
            const { result } = renderHook(() => useInvoices());
            const formData = createMockFormData();

            act(() => {
                result.current.saveInvoice(formData, 'new-id');
            });

            expect(result.current.invoices.length).toBe(1);
            expect(result.current.invoices[0].id).toBe('new-id');
        });

        it('returns the saved invoice', async () => {
            const { result } = renderHook(() => useInvoices());
            const formData = createMockFormData({ invoiceNumber: 'INV-9999' });

            let savedInvoice: any;
            await act(async () => {
                savedInvoice = await result.current.saveInvoice(formData, 'test-id');
            });

            expect(savedInvoice.invoiceNumber).toBe('INV-9999');
            expect(savedInvoice.id).toBe('test-id');
        });
    });

    describe('deleteInvoice', () => {
        it('removes invoice from store', () => {
            const formData = createMockFormData();

            act(() => {
                useInvoiceStore.getState().saveInvoice(formData, 'to-delete');
            });

            const { result } = renderHook(() => useInvoices());
            expect(result.current.invoices.length).toBe(1);

            act(() => {
                result.current.deleteInvoice('to-delete');
            });

            expect(result.current.invoices.length).toBe(0);
        });
    });

    describe('getInvoice', () => {
        it('returns invoice by id', () => {
            const formData = createMockFormData({ fromName: 'Specific Company' });

            act(() => {
                useInvoiceStore.getState().saveInvoice(formData, 'find-me');
            });

            const { result } = renderHook(() => useInvoices());
            const invoice = result.current.getInvoice('find-me');

            expect(invoice).toBeDefined();
            expect(invoice!.fromName).toBe('Specific Company');
        });

        it('returns undefined for non-existent id', () => {
            const { result } = renderHook(() => useInvoices());
            const invoice = result.current.getInvoice('does-not-exist');
            expect(invoice).toBeUndefined();
        });
    });

    describe('getNextInvoiceNumber', () => {
        it('returns INV-0001 when no invoices exist', () => {
            const { result } = renderHook(() => useInvoices());
            expect(result.current.getNextInvoiceNumber).toBe('INV-0001');
        });

        it('returns incremented number based on existing invoices', () => {
            const formData = createMockFormData({ invoiceNumber: 'INV-0042' });

            act(() => {
                useInvoiceStore.getState().saveInvoice(formData, 'existing');
            });

            const { result } = renderHook(() => useInvoices());
            expect(result.current.getNextInvoiceNumber).toBe('INV-0043');
        });
    });

    describe('draft management', () => {
        describe('saveDraft', () => {
            it('saves draft to store', () => {
                const { result } = renderHook(() => useInvoices());
                const formData = createMockFormData();

                act(() => {
                    result.current.saveDraft('draft-123', formData);
                });

                const loaded = result.current.loadDraft('draft-123');
                expect(loaded).toEqual(formData);
            });
        });

        describe('loadDraft', () => {
            it('returns draft when it exists', () => {
                const formData = createMockFormData({ fromName: 'Draft Company' });

                act(() => {
                    useInvoiceStore.getState().saveDraft('my-draft', formData);
                });

                const { result } = renderHook(() => useInvoices());
                const draft = result.current.loadDraft('my-draft');

                expect(draft).toBeDefined();
                expect(draft!.fromName).toBe('Draft Company');
            });

            it('returns null when draft does not exist', () => {
                const { result } = renderHook(() => useInvoices());
                const draft = result.current.loadDraft('no-such-draft');
                expect(draft).toBeNull();
            });
        });

        describe('clearDraft', () => {
            it('removes draft from store', () => {
                const formData = createMockFormData();

                act(() => {
                    useInvoiceStore.getState().saveDraft('temp-draft', formData);
                });

                const { result } = renderHook(() => useInvoices());
                expect(result.current.loadDraft('temp-draft')).not.toBeNull();

                act(() => {
                    result.current.clearDraft('temp-draft');
                });

                expect(result.current.loadDraft('temp-draft')).toBeNull();
            });
        });
    });

    describe('refreshInvoices', () => {
        it('exists for API compatibility but does nothing', () => {
            const { result } = renderHook(() => useInvoices());

            // Should not throw
            expect(() => {
                result.current.refreshInvoices();
            }).not.toThrow();
        });
    });
});
