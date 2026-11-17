/**
 * Page breaks of the invoice PDF (InvoicePDF.tsx) on A4: line items flow row
 * by row, the table header repeats on continuation pages, the totals stay
 * together and move only when they do not fit, footer labels are never left
 * alone at a page bottom, and every page gets the full background.
 */
import { describe, expect, it } from 'vitest';
import { readPublicAsset } from './test/helpers';
import { extractPdfPages, pdfPageContents } from './test/pdf-text';
import { renderInvoicePdf } from './pdf/render';
import { INVOICE_PALETTES, type InvoiceTheme } from '@/components/invoice/invoiceTheme';
import type { InvoiceFormData } from '../shared/types/invoice';

const LONG = 'Discovery workshop, stakeholder interviews and a written summary of findings with prioritised recommendations for the next quarter';

function invoice(items: number, long = false, overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0001',
    invoiceName: 'Brand refresh — Q4',
    issueDate: '2026-11-17',
    dueDate: '2026-12-17',
    fromName: 'Midnight Studio',
    fromAddress: '1 Main Street\nSpringfield\nUSA',
    fromEmail: 'hello@midnight.example',
    toName: 'Globex Corporation',
    toAddress: '42 Elsewhere Road\nShelbyville',
    toEmail: 'ap@globex.example',
    lineItems: Array.from({ length: items }, (_, i) => ({
      id: String(i),
      description: long && i % 3 === 0 ? `Item ${i + 1}: ${LONG}` : `Item ${i + 1}: design work`,
      quantity: (i % 4) + 1,
      price: 100 + i,
    })),
    taxRate: 10,
    notes: long ? Array.from({ length: 8 }, (_, i) => `Note line ${i + 1}: payment within 30 days please, thanks.`).join('\n') : 'Thank you!',
    paymentDetails: long ? 'Bank: Example Bank\nIBAN: DE00 0000 0000 0000 0000 00\nBIC: EXAMPLEXXX\nReference: INV number\nAccount holder: Midnight Studio' : 'IBAN: DE00 0000 0000',
    currency: 'USD',
    ...overrides,
  };
}

async function pages(data: InvoiceFormData, theme: InvoiceTheme = 'dark') {
  const bytes = await renderInvoicePdf(data, readPublicAsset, theme);
  return { text: extractPdfPages(bytes), contents: pdfPageContents(bytes) };
}

const LABEL = /^(description|payment details|notes)$/i;
/** Index of the page on which a line matching `test` is drawn (first match). */
const pageOf = (text: string[][], test: (line: string) => boolean) => text.findIndex((lines) => lines.some(test));
const isItem = (n: number) => (line: string) => line.startsWith(`Item ${n}:`);

describe('PDF page breaks', () => {
  it.each([
    [1, false, 1], [5, false, 1], [12, false, 2], [30, false, 3], [80, false, 6],
    [1, true, 2], [5, true, 2], [12, true, 3], [30, true, 5], [80, true, 10],
  ])('%i line items (long text: %s) → %i page(s), laid out cleanly', async (items, long, expected) => {
    const { text, contents } = await pages(invoice(items, long));
    expect(text).toHaveLength(expected);

    // Every line item is printed exactly once, in order, and never split across pages.
    let previousPage = 0;
    for (let n = 1; n <= items; n++) {
      const where = text.map((lines) => lines.filter(isItem(n)).length);
      expect(where.reduce((a, b) => a + b), `item ${n} printed once`).toBe(1);
      const page = where.findIndex((count) => count > 0);
      expect(page).toBeGreaterThanOrEqual(previousPage);
      previousPage = page;
      if (long && (n - 1) % 3 === 0) {
        // The rest of a long description is on the same page as its first line.
        expect(text[page].some((line) => line.includes('recommendations for the next'))).toBe(true);
      }
    }

    const lastItemPage = pageOf(text, isItem(items));
    for (let p = 1; p <= lastItemPage; p++) {
      // The table header repeats at the top of every continuation page of the table.
      expect(text[p][0], `page ${p + 1} starts with the table header`).toMatch(/^description$/i);
    }
    for (let p = lastItemPage + 1; p < text.length; p++) {
      expect(text[p], `no table header after the table ended (page ${p + 1})`).not.toContainEqual(expect.stringMatching(/^description$/i));
    }

    // The totals block is never split.
    const subtotal = pageOf(text, (l) => l === 'Subtotal');
    expect(pageOf(text, (l) => l === 'Total')).toBe(subtotal);
    expect(subtotal).toBeGreaterThanOrEqual(lastItemPage);

    for (const [p, lines] of text.entries()) {
      // No section label as the last thing on a page.
      expect(lines.at(-1), `page ${p + 1} ends with a lone label`).not.toMatch(LABEL);
      // The full-page background is painted on every page.
      expect(contents[p]).toContain('595.280029 841.890015 l');
      expect(contents[p]).toContain(fillOf(INVOICE_PALETTES.dark.background));
    }
  });

  it('keeps the totals on the page of the last row when they fit (no jump caused by the bottom margin)', async () => {
    // With 8 short rows the totals fit on page 1 with < 32 pt (their mb-8) to spare.
    const { text } = await pages(invoice(8));
    expect(pageOf(text, (l) => l === 'Total')).toBe(0);
    expect(pageOf(text, isItem(8))).toBe(0);
    // With 10 rows the table used to jump to page 2 as a whole; now rows flow and only what does not fit moves.
    const ten = (await pages(invoice(10))).text;
    expect(pageOf(ten, isItem(1))).toBe(0);
    expect(pageOf(ten, isItem(10))).toBe(0);
  });

  it('fills continuation pages with the light background in light mode too', async () => {
    const { contents } = await pages(invoice(30), 'light');
    expect(contents).toHaveLength(3);
    for (const page of contents) expect(page).toContain(fillOf(INVOICE_PALETTES.light.background));
  });
});

/** The `scn` fill operator react-pdf emits for a #rrggbb colour. */
function fillOf(hex: string): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return `${channels.join(' ')} scn`;
}
