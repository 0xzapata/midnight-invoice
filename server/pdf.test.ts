import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, buildApp, createWorkspace, readPublicAsset, sampleInvoice, startD1 } from './test/helpers';
import { extractPdfText, pdfBaseFonts, pdfStreams } from './test/pdf-text';
import { pdfFilename, renderInvoicePdf } from './pdf/render';
import { INVOICE_PALETTES, type InvoiceTheme } from '@/components/invoice/invoiceTheme';
import type { InvoiceFormData } from '../shared/types/invoice';

/** The `scn` fill operator react-pdf emits for a #rrggbb colour. */
function fillOperator(hex: string): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return `${channels.join(' ')} scn`;
}

function usesFill(bytes: Uint8Array, hex: string): boolean {
  return pdfStreams(bytes).some((s) => s.includes(fillOperator(hex)));
}

const formData = (overrides: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  invoiceNumber: 'INV-0042',
  issueDate: '2026-11-17',
  dueDate: '2026-12-17',
  fromName: 'Me & Co',
  fromAddress: '1 Main St\nSpringfield',
  fromEmail: 'me@example.com',
  toName: 'Client',
  toAddress: 'Elsewhere',
  toEmail: '',
  lineItems: [{ id: '1', description: 'Work', quantity: 1, price: 1234.5 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  ...overrides,
});

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

describe('GET /api/v1/invoices/:id/pdf', () => {
  it('renders the invoice with the app’s InvoicePDF component', async () => {
    const { app } = buildApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    const { invoice } = (
      await client.post(
        '/api/v1/invoices',
        sampleInvoice({ toName: 'Globex Corporation', currency: 'EUR', taxRate: 20, lineItems: [{ description: 'Hosting (annual)', quantity: 1, price: 1200 }] }),
        ws.token,
      )
    ).json;
    const res = await app.request(`http://app.test/api/v1/invoices/${invoice.id}/pdf`, { headers: { authorization: `Bearer ${ws.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="INV-0001.pdf"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const text = extractPdfText(bytes);
    for (const s of ['INV-0001', 'Globex Corporation', 'Midnight Studio', 'Hosting (annual)', '€1,200.00', '€240.00', '€1,440.00']) {
      expect(text).toContain(s);
    }
    // The embedded font is the app's Noto Sans Mono, loaded from static assets.
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/NotoSansMono/);
    // Without ?theme the PDF has the preview's default (dark) look.
    expect(usesFill(bytes, INVOICE_PALETTES.dark.background)).toBe(true);
    expect(usesFill(bytes, INVOICE_PALETTES.light.background)).toBe(false);
  });

  it('accepts ?theme=light|dark and rejects anything else', async () => {
    const { app } = buildApp(d1.db);
    const client = api(app);
    const ws = await createWorkspace(client);
    const { invoice } = (await client.post('/api/v1/invoices', sampleInvoice(), ws.token)).json;
    const get = (query: string) =>
      app.request(`http://app.test/api/v1/invoices/${invoice.id}/pdf${query}`, { headers: { authorization: `Bearer ${ws.token}` } });

    for (const theme of ['light', 'dark'] as InvoiceTheme[]) {
      const res = await get(`?theme=${theme}`);
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const palette = INVOICE_PALETTES[theme];
      expect(usesFill(bytes, palette.background)).toBe(true);
      expect(usesFill(bytes, palette.text)).toBe(true);
      expect(usesFill(bytes, palette.muted)).toBe(true);
      expect(usesFill(bytes, palette.accent)).toBe(true);
    }

    const bad = await get('?theme=sepia');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('prints text literally: no HTML entities for &, quotes or apostrophes', async () => {
    const bytes = await renderInvoicePdf(
      formData({ fromName: 'Me & Co', toName: 'Müller & Söhne', notes: `We're "happy" <b>to</b> help`, lineItems: [{ id: '1', description: 'R&D <i>phase</i>', quantity: 1, price: 1 }] }),
      readPublicAsset,
    );
    const text = extractPdfText(bytes);
    for (const s of ['Me & Co', 'Müller & Söhne', `We're "happy" to help`, 'R&D phase']) expect(text).toContain(s);
    expect(text).not.toMatch(/&(amp|quot|#0?39|lt|gt);/);
  });

  it('embeds only the Noto Sans Mono faces the preview uses (no unembedded Helvetica)', async () => {
    const bytes = await renderInvoicePdf(formData({ fromAddress: 'Line 1\nLine 2\n\nLine 4', paymentDetails: 'IBAN: X\nBIC: Y', notes: 'n' }), readPublicAsset, 'light');
    const fonts = new Set(pdfBaseFonts(bytes).map((name) => name.replace(/^[A-Z]{6}\+/, '')));
    expect([...fonts].sort()).toEqual(['NotoSansMono-Medium', 'NotoSansMono-Regular', 'NotoSansMono-SemiBold']);
  });

  it.each(['EUR', 'GBP', 'JPY', 'INR', 'ILS', 'KRW', 'VND', 'PHP', 'NGN', 'CNY', 'XOF'])(
    'renders every character of %s amounts with a real glyph',
    async (currency) => {
      const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(1234.5);
      const bytes = await renderInvoicePdf(formData({ currency }), readPublicAsset);
      // A character without a glyph maps to .notdef, which has no Unicode mapping and drops out of the text.
      expect(extractPdfText(bytes)).toContain(amount);
    },
  );

  it('builds safe filenames', () => {
    expect(pdfFilename('INV-0001')).toBe('INV-0001.pdf');
    expect(pdfFilename('a/b"c\r\nd')).toBe('a_b_c_d.pdf');
    expect(pdfFilename('***')).toBe('invoice.pdf');
  });
});
