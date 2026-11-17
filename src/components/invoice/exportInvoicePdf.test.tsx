import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InvoiceFormData } from '@/types/invoice';
import coverage from '../../../public/fonts/fallback/coverage.json?raw';

const register = vi.fn();
const toBlob = vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' }));
const pdf = vi.fn((_element: unknown) => ({ toBlob }));
vi.mock('@react-pdf/renderer', () => ({
  pdf: (element: unknown) => pdf(element),
  Font: { register: (...args: unknown[]) => register(...args), registerHyphenationCallback: vi.fn() },
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
}));

const { exportInvoicePdf, unsupportedCharactersWarning } = await import('./exportInvoicePdf');

const data = (overrides: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  invoiceNumber: 'INV-0001',
  issueDate: '2026-11-17',
  fromName: 'Me',
  fromAddress: '',
  fromEmail: '',
  toName: 'Client',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: '1', description: 'Work', quantity: 1, price: 1 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'EUR',
  ...overrides,
});

describe('exportInvoicePdf (browser)', () => {
  const fetchMock = vi.fn(async (_url: string) => new Response(coverage, { status: 200 }));
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    register.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches no font data for invoices Noto Sans Mono covers', async () => {
    const result = await exportInvoicePdf(data({ toName: 'Müller & Söhne', notes: 'Спасибо!' }));
    expect(result.unsupported).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalledWith(expect.objectContaining({ src: expect.stringContaining('/fonts/fallback/') }));
  });

  it('loads the coverage table and registers only the faces the text needs, by URL', async () => {
    const result = await exportInvoicePdf(data({ toName: '株式会社テスト', notes: 'תודה' }));
    expect(fetchMock).toHaveBeenCalledWith('/fonts/fallback/coverage.json');
    const fallbackSrcs = register.mock.calls.map(([options]) => (options as { src: string }).src).filter((src) => src.includes('/fallback/'));
    expect(fallbackSrcs).toEqual(['/fonts/fallback/NotoSansSC-Regular.woff', '/fonts/fallback/NotoSansHebrew-Regular.woff']);
    const element = pdf.mock.calls[pdf.mock.calls.length - 1][0] as { props: { fallbackFamilies: string[] } };
    expect(element.props.fallbackFamilies).toEqual(['Noto Sans SC', 'Noto Sans Hebrew']);
    expect(result.unsupported).toEqual([]);
  });

  it('reports characters no font covers so the user is warned before exporting', async () => {
    const result = await exportInvoicePdf(data({ notes: 'ধন্যবাদ' }));
    expect(result.unsupported.length).toBeGreaterThan(0);
    expect(unsupportedCharactersWarning(result.unsupported)).toMatch(/cannot be printed in the PDF/);
    expect(unsupportedCharactersWarning([])).toBeNull();
  });
});
