import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useInvoiceStore } from './useInvoiceStore';
import { InvoiceFormData, Invoice } from '@/types/invoice';
import { act } from '@testing-library/react';

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

describe('useInvoiceStore', () => {
    beforeEach(() => {
        // Reset the store before each test
        const store = useInvoiceStore.getState();
        act(() => {
            useInvoiceStore.setState({
                invoices: [],
                drafts: {},
                _hasHydrated: false,
            });
        });
    });

    describe('initial state', () => {
        it('starts with empty invoices array', () => {
            const { invoices } = useInvoiceStore.getState();
            expect(invoices).toEqual([]);
        });

        it('starts with empty drafts object', () => {
            const { drafts } = useInvoiceStore.getState();
            expect(drafts).toEqual({});
        });

        it('starts with _hasHydrated as false', () => {
            const { _hasHydrated } = useInvoiceStore.getState();
            expect(_hasHydrated).toBe(false);
        });
    });

    describe('setHasHydrated', () => {
        it('sets hydration status to true', () => {
            const { setHasHydrated } = useInvoiceStore.getState();
            act(() => {
                setHasHydrated(true);
            });
            expect(useInvoiceStore.getState()._hasHydrated).toBe(true);
        });

        it('sets hydration status to false', () => {
            act(() => {
                useInvoiceStore.setState({ _hasHydrated: true });
            });
            const { setHasHydrated } = useInvoiceStore.getState();
            act(() => {
                setHasHydrated(false);
            });
            expect(useInvoiceStore.getState()._hasHydrated).toBe(false);
        });
    });

    describe('saveInvoice', () => {
        it('creates a new invoice with provided form data', () => {
            const formData = createMockFormData();
            const { saveInvoice } = useInvoiceStore.getState();

            let result: Invoice;
            act(() => {
                result = saveInvoice(formData);
            });

            expect(result!.invoiceNumber).toBe('INV-0001');
            expect(result!.fromName).toBe('Test Company');
            expect(result!.id).toBeDefined();
            expect(result!.createdAt).toBeDefined();
        });

        it('uses provided id when given', () => {
            const formData = createMockFormData();
            const { saveInvoice } = useInvoiceStore.getState();
            const customId = 'custom-id-123';

            let result: Invoice;
            act(() => {
                result = saveInvoice(formData, customId);
            });

            expect(result!.id).toBe(customId);
        });

        it('generates creative name when invoiceName is empty', () => {
            const formData = createMockFormData({ invoiceName: '' });
            const { saveInvoice } = useInvoiceStore.getState();

            let result: Invoice;
            act(() => {
                result = saveInvoice(formData);
            });

            // Should match pattern like "Cosmic Phoenix 42"
            expect(result!.invoiceName).toMatch(/^\w+ \w+ \d+$/);
        });

        it('adds invoice to the beginning of the invoices array', () => {
            const formData1 = createMockFormData({ invoiceNumber: 'INV-0001' });
            const formData2 = createMockFormData({ invoiceNumber: 'INV-0002' });
            const { saveInvoice } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData1);
                saveInvoice(formData2);
            });

            const { invoices } = useInvoiceStore.getState();
            expect(invoices[0].invoiceNumber).toBe('INV-0002');
            expect(invoices[1].invoiceNumber).toBe('INV-0001');
        });

        it('updates existing invoice when id matches', () => {
            const formData = createMockFormData();
            const { saveInvoice } = useInvoiceStore.getState();
            const invoiceId = 'existing-id';

            act(() => {
                saveInvoice(formData, invoiceId);
            });

            const updatedData = createMockFormData({ fromName: 'Updated Company' });
            act(() => {
                saveInvoice(updatedData, invoiceId);
            });

            const { invoices } = useInvoiceStore.getState();
            expect(invoices.length).toBe(1);
            expect(invoices[0].fromName).toBe('Updated Company');
        });
    });

    describe('deleteInvoice', () => {
        it('removes invoice with matching id', () => {
            const formData = createMockFormData();
            const { saveInvoice, deleteInvoice } = useInvoiceStore.getState();
            const invoiceId = 'to-delete';

            act(() => {
                saveInvoice(formData, invoiceId);
            });

            expect(useInvoiceStore.getState().invoices.length).toBe(1);

            act(() => {
                deleteInvoice(invoiceId);
            });

            expect(useInvoiceStore.getState().invoices.length).toBe(0);
        });

        it('does not affect other invoices when deleting', () => {
            const formData1 = createMockFormData({ invoiceNumber: 'INV-0001' });
            const formData2 = createMockFormData({ invoiceNumber: 'INV-0002' });
            const { saveInvoice, deleteInvoice } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData1, 'id-1');
                saveInvoice(formData2, 'id-2');
            });

            act(() => {
                deleteInvoice('id-1');
            });

            const { invoices } = useInvoiceStore.getState();
            expect(invoices.length).toBe(1);
            expect(invoices[0].invoiceNumber).toBe('INV-0002');
        });

        it('does nothing when id does not match any invoice', () => {
            const formData = createMockFormData();
            const { saveInvoice, deleteInvoice } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData, 'existing-id');
            });

            act(() => {
                deleteInvoice('non-existent-id');
            });

            expect(useInvoiceStore.getState().invoices.length).toBe(1);
        });
    });

    describe('getInvoice', () => {
        it('returns invoice when id matches', () => {
            const formData = createMockFormData({ invoiceNumber: 'INV-0001' });
            const { saveInvoice, getInvoice } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData, 'test-id');
            });

            const result = getInvoice('test-id');
            expect(result).toBeDefined();
            expect(result!.invoiceNumber).toBe('INV-0001');
        });

        it('returns undefined when id does not match', () => {
            const { getInvoice } = useInvoiceStore.getState();
            const result = getInvoice('non-existent-id');
            expect(result).toBeUndefined();
        });
    });

    describe('getNextInvoiceNumber', () => {
        it('returns INV-0001 when no invoices exist', () => {
            const { getNextInvoiceNumber } = useInvoiceStore.getState();
            const result = getNextInvoiceNumber();
            expect(result).toBe('INV-0001');
        });

        it('increments from highest existing invoice number', () => {
            const formData1 = createMockFormData({ invoiceNumber: 'INV-0005' });
            const formData2 = createMockFormData({ invoiceNumber: 'INV-0003' });
            const { saveInvoice, getNextInvoiceNumber } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData1, 'id-1');
                saveInvoice(formData2, 'id-2');
            });

            const result = getNextInvoiceNumber();
            expect(result).toBe('INV-0006');
        });

        it('handles invoice numbers without INV prefix', () => {
            const formData = createMockFormData({ invoiceNumber: '0010' });
            const { saveInvoice, getNextInvoiceNumber } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData, 'id-1');
            });

            const result = getNextInvoiceNumber();
            expect(result).toBe('INV-0011');
        });

        it('handles non-numeric invoice numbers gracefully', () => {
            const formData = createMockFormData({ invoiceNumber: 'CUSTOM-ABC' });
            const { saveInvoice, getNextInvoiceNumber } = useInvoiceStore.getState();

            act(() => {
                saveInvoice(formData, 'id-1');
            });

            const result = getNextInvoiceNumber();
            expect(result).toBe('INV-0001');
        });
    });

    describe('saveDraft', () => {
        it('saves draft with given id', () => {
            const formData = createMockFormData();
            const { saveDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-id', formData);
            });

            const { drafts } = useInvoiceStore.getState();
            expect(drafts['draft-id']).toEqual(formData);
        });

        it('overwrites existing draft with same id', () => {
            const formData1 = createMockFormData({ fromName: 'Original' });
            const formData2 = createMockFormData({ fromName: 'Updated' });
            const { saveDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-id', formData1);
                saveDraft('draft-id', formData2);
            });

            const { drafts } = useInvoiceStore.getState();
            expect(drafts['draft-id'].fromName).toBe('Updated');
        });

        it('can store multiple drafts with different ids', () => {
            const formData1 = createMockFormData({ invoiceNumber: 'INV-0001' });
            const formData2 = createMockFormData({ invoiceNumber: 'INV-0002' });
            const { saveDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-1', formData1);
                saveDraft('draft-2', formData2);
            });

            const { drafts } = useInvoiceStore.getState();
            expect(Object.keys(drafts).length).toBe(2);
            expect(drafts['draft-1'].invoiceNumber).toBe('INV-0001');
            expect(drafts['draft-2'].invoiceNumber).toBe('INV-0002');
        });
    });

    describe('loadDraft', () => {
        it('returns draft when id exists', () => {
            const formData = createMockFormData();
            const { saveDraft, loadDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-id', formData);
            });

            const result = loadDraft('draft-id');
            expect(result).toEqual(formData);
        });

        it('returns null when id does not exist', () => {
            const { loadDraft } = useInvoiceStore.getState();
            const result = loadDraft('non-existent-id');
            expect(result).toBeNull();
        });
    });

    describe('clearDraft', () => {
        it('removes draft with matching id', () => {
            const formData = createMockFormData();
            const { saveDraft, clearDraft, loadDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-id', formData);
            });

            expect(loadDraft('draft-id')).not.toBeNull();

            act(() => {
                clearDraft('draft-id');
            });

            expect(loadDraft('draft-id')).toBeNull();
        });

        it('does not affect other drafts', () => {
            const formData1 = createMockFormData({ invoiceNumber: 'INV-0001' });
            const formData2 = createMockFormData({ invoiceNumber: 'INV-0002' });
            const { saveDraft, clearDraft, loadDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-1', formData1);
                saveDraft('draft-2', formData2);
            });

            act(() => {
                clearDraft('draft-1');
            });

            expect(loadDraft('draft-1')).toBeNull();
            expect(loadDraft('draft-2')).not.toBeNull();
        });

        it('does nothing when id does not exist', () => {
            const formData = createMockFormData();
            const { saveDraft, clearDraft } = useInvoiceStore.getState();

            act(() => {
                saveDraft('draft-id', formData);
            });

            // Should not throw
            act(() => {
                clearDraft('non-existent-id');
            });

            const { drafts } = useInvoiceStore.getState();
            expect(Object.keys(drafts).length).toBe(1);
        });
    });
});
