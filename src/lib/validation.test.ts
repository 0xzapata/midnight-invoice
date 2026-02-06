import { describe, it, expect } from 'vitest';
import { lineItemSchema, invoiceFormSchema } from './validation';

describe('lineItemSchema', () => {
    it('validates a valid line item', () => {
        const validItem = {
            id: 'item-1',
            description: 'Consulting services',
            quantity: 10,
            price: 150,
        };

        const result = lineItemSchema.safeParse(validItem);
        expect(result.success).toBe(true);
    });

    it('requires id to be a string', () => {
        const invalidItem = {
            id: 123, // should be string
            description: 'Service',
            quantity: 1,
            price: 100,
        };

        const result = lineItemSchema.safeParse(invalidItem);
        expect(result.success).toBe(false);
    });

    it('requires description to be non-empty', () => {
        const invalidItem = {
            id: 'item-1',
            description: '',
            quantity: 1,
            price: 100,
        };

        const result = lineItemSchema.safeParse(invalidItem);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Description is required');
        }
    });

    it('allows quantity of 0', () => {
        const validItem = {
            id: 'item-1',
            description: 'Free item',
            quantity: 0,
            price: 100,
        };

        const result = lineItemSchema.safeParse(validItem);
        expect(result.success).toBe(true);
    });

    it('rejects negative quantity', () => {
        const invalidItem = {
            id: 'item-1',
            description: 'Service',
            quantity: -1,
            price: 100,
        };

        const result = lineItemSchema.safeParse(invalidItem);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Quantity must be 0 or greater');
        }
    });

    it('allows price of 0', () => {
        const validItem = {
            id: 'item-1',
            description: 'Complimentary',
            quantity: 1,
            price: 0,
        };

        const result = lineItemSchema.safeParse(validItem);
        expect(result.success).toBe(true);
    });

    it('rejects negative price', () => {
        const invalidItem = {
            id: 'item-1',
            description: 'Service',
            quantity: 1,
            price: -50,
        };

        const result = lineItemSchema.safeParse(invalidItem);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Price must be 0 or greater');
        }
    });

    it('accepts decimal quantities and prices', () => {
        const validItem = {
            id: 'item-1',
            description: 'Hourly rate',
            quantity: 2.5,
            price: 75.50,
        };

        const result = lineItemSchema.safeParse(validItem);
        expect(result.success).toBe(true);
    });
});

describe('invoiceFormSchema', () => {
    const createValidInvoice = (overrides = {}) => ({
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

    describe('required fields', () => {
        it('validates a complete valid invoice', () => {
            const validInvoice = createValidInvoice();
            const result = invoiceFormSchema.safeParse(validInvoice);
            expect(result.success).toBe(true);
        });

        it('requires invoiceNumber', () => {
            const invalidInvoice = createValidInvoice({ invoiceNumber: '' });
            const result = invoiceFormSchema.safeParse(invalidInvoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('invoiceNumber'));
                expect(issue?.message).toBe('Invoice number is required');
            }
        });

        it('requires issueDate', () => {
            const invalidInvoice = createValidInvoice({ issueDate: '' });
            const result = invoiceFormSchema.safeParse(invalidInvoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('issueDate'));
                expect(issue?.message).toBe('Issue date is required');
            }
        });

        it('requires fromName', () => {
            const invalidInvoice = createValidInvoice({ fromName: '' });
            const result = invoiceFormSchema.safeParse(invalidInvoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('fromName'));
                expect(issue?.message).toBe('Your name/company is required');
            }
        });

        it('requires toName', () => {
            const invalidInvoice = createValidInvoice({ toName: '' });
            const result = invoiceFormSchema.safeParse(invalidInvoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('toName'));
                expect(issue?.message).toBe('Client name/company is required');
            }
        });

        it('requires currency', () => {
            const invalidInvoice = createValidInvoice({ currency: '' });
            const result = invoiceFormSchema.safeParse(invalidInvoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('currency'));
                expect(issue?.message).toBe('Currency is required');
            }
        });
    });

    describe('optional fields', () => {
        it('allows invoiceName to be omitted', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).invoiceName;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('allows dueDate to be omitted', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).dueDate;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('allows fromAddress to be omitted and defaults to empty string', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).fromAddress;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.fromAddress).toBe('');
            }
        });

        it('allows fromEmail to be omitted and defaults to empty string', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).fromEmail;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.fromEmail).toBe('');
            }
        });

        it('allows notes to be omitted and defaults to empty string', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).notes;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.notes).toBe('');
            }
        });

        it('allows paymentDetails to be omitted and defaults to empty string', () => {
            const invoice = createValidInvoice();
            delete (invoice as any).paymentDetails;
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.paymentDetails).toBe('');
            }
        });
    });

    describe('email validation', () => {
        it('accepts valid fromEmail', () => {
            const invoice = createValidInvoice({ fromEmail: 'valid@email.com' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('accepts empty fromEmail', () => {
            const invoice = createValidInvoice({ fromEmail: '' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('rejects invalid fromEmail format', () => {
            const invoice = createValidInvoice({ fromEmail: 'not-an-email' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('fromEmail'));
                expect(issue?.message).toBe('Invalid email format');
            }
        });

        it('accepts valid toEmail', () => {
            const invoice = createValidInvoice({ toEmail: 'client@company.org' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('accepts empty toEmail', () => {
            const invoice = createValidInvoice({ toEmail: '' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('rejects invalid toEmail format', () => {
            const invoice = createValidInvoice({ toEmail: 'invalid-email' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('toEmail'));
                expect(issue?.message).toBe('Invalid email format');
            }
        });

        it('accepts email with subdomain', () => {
            const invoice = createValidInvoice({ fromEmail: 'user@mail.example.com' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('accepts email with plus sign', () => {
            const invoice = createValidInvoice({ fromEmail: 'user+tag@example.com' });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });
    });

    describe('lineItems validation', () => {
        it('requires at least one line item', () => {
            const invoice = createValidInvoice({ lineItems: [] });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('lineItems'));
                expect(issue?.message).toBe('At least one line item is required');
            }
        });

        it('accepts multiple line items', () => {
            const invoice = createValidInvoice({
                lineItems: [
                    { id: '1', description: 'Service A', quantity: 1, price: 100 },
                    { id: '2', description: 'Service B', quantity: 2, price: 200 },
                    { id: '3', description: 'Service C', quantity: 3, price: 300 },
                ]
            });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('validates each line item individually', () => {
            const invoice = createValidInvoice({
                lineItems: [
                    { id: '1', description: '', quantity: 1, price: 100 }, // Invalid description
                ]
            });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
        });
    });

    describe('taxRate validation', () => {
        it('accepts 0% tax rate', () => {
            const invoice = createValidInvoice({ taxRate: 0 });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('accepts 100% tax rate', () => {
            const invoice = createValidInvoice({ taxRate: 100 });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('accepts decimal tax rates', () => {
            const invoice = createValidInvoice({ taxRate: 7.25 });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(true);
        });

        it('rejects negative tax rate', () => {
            const invoice = createValidInvoice({ taxRate: -5 });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('taxRate'));
                expect(issue?.message).toBe('Tax rate must be 0 or greater');
            }
        });

        it('rejects tax rate over 100%', () => {
            const invoice = createValidInvoice({ taxRate: 101 });
            const result = invoiceFormSchema.safeParse(invoice);
            expect(result.success).toBe(false);
            if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('taxRate'));
                expect(issue?.message).toBe('Tax rate cannot exceed 100%');
            }
        });
    });
});
