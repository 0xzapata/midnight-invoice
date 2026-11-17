import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, buildApp, createWorkspace, sampleInvoice, startD1 } from './test/helpers';
import { extractPdfText } from './test/pdf-text';
import { pdfFilename } from './pdf/render';

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
  });

  it('builds safe filenames', () => {
    expect(pdfFilename('INV-0001')).toBe('INV-0001.pdf');
    expect(pdfFilename('a/b"c\r\nd')).toBe('a_b_c_d.pdf');
    expect(pdfFilename('***')).toBe('invoice.pdf');
  });
});
