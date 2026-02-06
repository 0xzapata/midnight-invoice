import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatCurrency, formatDate, generateInvoiceNumber } from './invoice-utils';

describe('formatCurrency', () => {
    it('formats USD amounts correctly', () => {
        expect(formatCurrency(1234.5, 'USD')).toBe('$1,234.50');
    });

    it('formats EUR amounts correctly', () => {
        expect(formatCurrency(1000, 'EUR')).toBe('€1,000.00');
    });

    it('formats GBP amounts correctly', () => {
        expect(formatCurrency(500, 'GBP')).toBe('£500.00');
    });

    it('formats JPY amounts correctly', () => {
        // JPY typically doesn't show decimal places
        expect(formatCurrency(1000, 'JPY')).toBe('¥1,000.00');
    });

    it('formats zero amounts correctly', () => {
        expect(formatCurrency(0, 'USD')).toBe('$0.00');
    });

    it('formats negative amounts correctly', () => {
        expect(formatCurrency(-500, 'USD')).toBe('-$500.00');
    });

    it('handles large amounts correctly', () => {
        expect(formatCurrency(1000000.99, 'USD')).toBe('$1,000,000.99');
    });

    it('handles small decimal amounts correctly', () => {
        expect(formatCurrency(0.01, 'USD')).toBe('$0.01');
    });

    it('defaults to USD when no currency is provided', () => {
        expect(formatCurrency(100)).toBe('$100.00');
    });

    it('falls back to USD for invalid currency codes', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = formatCurrency(1000, 'INVALID');
        expect(result).toBe('$1,000.00');
        expect(consoleSpy).toHaveBeenCalledWith('Invalid currency code: INVALID, falling back to USD');
        consoleSpy.mockRestore();
    });

    it('handles empty string currency by falling back to USD', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Empty string should trigger the catch block
        const result = formatCurrency(100, '');
        expect(result).toBe('$100.00');
        consoleSpy.mockRestore();
    });
});

describe('formatDate', () => {
    it('formats ISO date strings correctly', () => {
        expect(formatDate('2024-01-15')).toBe('Jan 15, 2024');
    });

    it('formats different months correctly', () => {
        expect(formatDate('2024-12-25')).toBe('Dec 25, 2024');
        expect(formatDate('2024-06-01')).toBe('Jun 01, 2024');
    });

    it('returns dash for empty string', () => {
        expect(formatDate('')).toBe('-');
    });

    it('returns original string for invalid date format', () => {
        expect(formatDate('not-a-date')).toBe('not-a-date');
    });

    it('handles full ISO datetime strings', () => {
        expect(formatDate('2024-03-20T10:30:00Z')).toBe('Mar 20, 2024');
    });

    it('handles edge case dates', () => {
        expect(formatDate('2024-02-29')).toBe('Feb 29, 2024'); // Leap year
        expect(formatDate('2024-01-01')).toBe('Jan 01, 2024');
        expect(formatDate('2024-12-31')).toBe('Dec 31, 2024');
    });
});

describe('generateInvoiceNumber', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns invoice number in correct format', () => {
        const result = generateInvoiceNumber();
        expect(result).toMatch(/^INV-\d{4}$/);
    });

    it('pads numbers with leading zeros', () => {
        vi.mocked(Math.random).mockReturnValue(0.001); // Will give ~10
        const result = generateInvoiceNumber();
        expect(result).toBe('INV-0010');
    });

    it('handles maximum random value', () => {
        vi.mocked(Math.random).mockReturnValue(0.9999);
        const result = generateInvoiceNumber();
        expect(result).toMatch(/^INV-\d{4}$/);
    });

    it('handles minimum random value', () => {
        vi.mocked(Math.random).mockReturnValue(0);
        const result = generateInvoiceNumber();
        expect(result).toBe('INV-0000');
    });

    it('generates different numbers on subsequent calls', () => {
        vi.mocked(Math.random)
            .mockReturnValueOnce(0.1234)
            .mockReturnValueOnce(0.5678);

        const result1 = generateInvoiceNumber();
        const result2 = generateInvoiceNumber();

        expect(result1).not.toBe(result2);
    });
});
