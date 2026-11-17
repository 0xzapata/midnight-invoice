import { describe, expect, it } from 'vitest';
import { sanitizeInvoiceData, sanitizeText } from './sanitize';
import type { InvoiceFormData } from '@/types/invoice';

describe('sanitizeText', () => {
  it('keeps &, quotes and apostrophes literal (React and react-pdf render text, not HTML)', () => {
    expect(sanitizeText('Me & Co')).toBe('Me & Co');
    expect(sanitizeText(`"Quoted" & it's fine`)).toBe(`"Quoted" & it's fine`);
  });

  it('is idempotent: running it twice never double-encodes', () => {
    const once = sanitizeText('R&D <b>dept</b> &amp; more');
    expect(sanitizeText(once)).toBe(once);
    // A literal "&amp;" typed by the user stays as typed; it is not decoded or re-encoded.
    expect(once).toBe('R&D dept &amp; more');
  });

  it('still strips tags and normalizes whitespace, keeping line breaks', () => {
    expect(sanitizeText('<script>x</script>Evil   Corp')).toBe('xEvil Corp');
    expect(sanitizeText('  Line 1\n\tLine  2 ')).toBe('Line 1\n Line 2');
  });
});

describe('sanitizeInvoiceData', () => {
  it('passes ampersands through to every text field', () => {
    const data = sanitizeInvoiceData({
      invoiceNumber: 'A&B-1',
      issueDate: '2026-01-01',
      fromName: 'Me & Co',
      fromAddress: '1 A & B St',
      fromEmail: 'a&b@example.com',
      toName: 'You & Partners',
      toAddress: 'X',
      toEmail: 'y@example.com',
      lineItems: [{ id: '1', description: 'R&D', quantity: 1, price: 1 }],
      taxRate: 0,
      notes: 'Q&A',
      paymentDetails: 'IBAN & BIC',
      currency: 'EUR',
    } satisfies InvoiceFormData);
    expect(JSON.stringify(data)).not.toContain('&amp;');
    expect(data.fromName).toBe('Me & Co');
    expect(data.lineItems[0].description).toBe('R&D');
  });
});
