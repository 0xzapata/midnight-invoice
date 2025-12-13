import { describe, it, expect } from 'vitest';
import {
    CURRENT_INVOICE_VERSION,
    CURRENT_SETTINGS_VERSION,
    migrateInvoiceStore,
    migrateSettingsStore,
    InvoicePersistedState,
    SettingsPersistedState,
} from './storageMigrations';

describe('storageMigrations', () => {
    describe('version constants', () => {
        it('exports current invoice version', () => {
            expect(CURRENT_INVOICE_VERSION).toBe(1);
        });

        it('exports current settings version', () => {
            expect(CURRENT_SETTINGS_VERSION).toBe(1);
        });
    });

    describe('migrateInvoiceStore', () => {
        it('migrates from version 0 (unversioned) to version 1', () => {
            const oldState: InvoicePersistedState = {
                invoices: [
                    {
                        id: 'test-1',
                        invoiceNumber: 'INV-0001',
                        invoiceName: 'Test Invoice',
                        issueDate: '2024-01-01',
                        fromName: 'John Doe',
                        fromAddress: '123 Main St',
                        fromEmail: 'john@example.com',
                        toName: 'Jane Smith',
                        toAddress: '456 Oak Ave',
                        toEmail: 'jane@example.com',
                        lineItems: [{ id: '1', description: 'Service', quantity: 1, price: 100 }],
                        taxRate: 10,
                        notes: 'Test notes',
                        paymentDetails: 'Bank transfer',
                        currency: 'USD',
                        createdAt: '2024-01-01T00:00:00.000Z',
                    },
                ],
                drafts: {},
            };

            const result = migrateInvoiceStore(oldState, 0);

            expect(result.invoices).toHaveLength(1);
            expect(result.invoices[0].version).toBe(1);
            expect(result.invoices[0].id).toBe('test-1');
            expect(result.invoices[0].invoiceNumber).toBe('INV-0001');
        });

        it('handles empty invoices array', () => {
            const oldState: InvoicePersistedState = {
                invoices: [],
                drafts: {},
            };

            const result = migrateInvoiceStore(oldState, 0);

            expect(result.invoices).toEqual([]);
            expect(result.drafts).toEqual({});
        });

        it('preserves drafts during migration', () => {
            const oldState: InvoicePersistedState = {
                invoices: [],
                drafts: {
                    'draft-1': { invoiceNumber: 'INV-0002' },
                },
            };

            const result = migrateInvoiceStore(oldState, 0);

            expect(result.drafts).toEqual({ 'draft-1': { invoiceNumber: 'INV-0002' } });
        });

        it('returns state unchanged for current version', () => {
            const currentState: InvoicePersistedState = {
                invoices: [
                    {
                        version: 1,
                        id: 'test-1',
                        invoiceNumber: 'INV-0001',
                        invoiceName: 'Test',
                        issueDate: '2024-01-01',
                        fromName: '',
                        fromAddress: '',
                        fromEmail: '',
                        toName: '',
                        toAddress: '',
                        toEmail: '',
                        lineItems: [],
                        taxRate: 0,
                        notes: '',
                        paymentDetails: '',
                        currency: 'USD',
                        createdAt: '2024-01-01T00:00:00.000Z',
                    },
                ],
                drafts: {},
            };

            const result = migrateInvoiceStore(currentState, 1);

            expect(result).toEqual(currentState);
        });

        it('migrates multiple invoices', () => {
            const oldState: InvoicePersistedState = {
                invoices: [
                    {
                        id: 'inv-1',
                        invoiceNumber: 'INV-0001',
                        issueDate: '2024-01-01',
                        fromName: '',
                        fromAddress: '',
                        fromEmail: '',
                        toName: '',
                        toAddress: '',
                        toEmail: '',
                        lineItems: [],
                        taxRate: 0,
                        notes: '',
                        paymentDetails: '',
                        currency: 'USD',
                        createdAt: '2024-01-01T00:00:00.000Z',
                    },
                    {
                        id: 'inv-2',
                        invoiceNumber: 'INV-0002',
                        issueDate: '2024-01-02',
                        fromName: '',
                        fromAddress: '',
                        fromEmail: '',
                        toName: '',
                        toAddress: '',
                        toEmail: '',
                        lineItems: [],
                        taxRate: 0,
                        notes: '',
                        paymentDetails: '',
                        currency: 'EUR',
                        createdAt: '2024-01-02T00:00:00.000Z',
                    },
                ],
                drafts: {},
            };

            const result = migrateInvoiceStore(oldState, 0);

            expect(result.invoices).toHaveLength(2);
            expect(result.invoices[0].version).toBe(1);
            expect(result.invoices[1].version).toBe(1);
        });
    });

    describe('migrateSettingsStore', () => {
        it('migrates from version 0 with all fields present', () => {
            const oldState: SettingsPersistedState = {
                settings: {
                    fromName: 'Test User',
                    fromEmail: 'test@example.com',
                    fromAddress: '123 Test St',
                    paymentDetails: 'Bank Account',
                    notes: 'Thank you',
                    taxRate: 15,
                    currency: 'EUR',
                },
            };

            const result = migrateSettingsStore(oldState, 0);

            expect(result.settings.fromName).toBe('Test User');
            expect(result.settings.fromEmail).toBe('test@example.com');
            expect(result.settings.currency).toBe('EUR');
            expect(result.settings.taxRate).toBe(15);
        });

        it('provides defaults for missing fields in version 0', () => {
            const incompleteState = {
                settings: {
                    fromName: 'Partial User',
                },
            } as unknown as SettingsPersistedState;

            const result = migrateSettingsStore(incompleteState, 0);

            expect(result.settings.fromName).toBe('Partial User');
            expect(result.settings.fromEmail).toBe('');
            expect(result.settings.fromAddress).toBe('');
            expect(result.settings.paymentDetails).toBe('');
            expect(result.settings.notes).toBe('');
            expect(result.settings.taxRate).toBe(0);
            expect(result.settings.currency).toBe('USD');
        });

        it('handles completely empty settings object', () => {
            const emptyState = {
                settings: {},
            } as unknown as SettingsPersistedState;

            const result = migrateSettingsStore(emptyState, 0);

            expect(result.settings.fromName).toBe('');
            expect(result.settings.currency).toBe('USD');
            expect(result.settings.taxRate).toBe(0);
        });

        it('returns state unchanged for current version', () => {
            const currentState: SettingsPersistedState = {
                settings: {
                    fromName: 'Current User',
                    fromEmail: 'current@example.com',
                    fromAddress: '456 Current Ave',
                    paymentDetails: 'Current Bank',
                    notes: 'Current Notes',
                    taxRate: 20,
                    currency: 'GBP',
                },
            };

            const result = migrateSettingsStore(currentState, 1);

            expect(result).toEqual(currentState);
        });

        it('handles taxRate of 0 correctly (not treating as falsy)', () => {
            const stateWithZeroTax = {
                settings: {
                    fromName: 'Test',
                    fromEmail: '',
                    fromAddress: '',
                    paymentDetails: '',
                    notes: '',
                    taxRate: 0,
                    currency: 'USD',
                },
            } as SettingsPersistedState;

            const result = migrateSettingsStore(stateWithZeroTax, 0);

            expect(result.settings.taxRate).toBe(0);
        });
    });
});
