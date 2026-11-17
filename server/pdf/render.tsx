/**
 * Server-side PDF rendering with the app's own InvoicePDF component.
 *
 * Works inside workerd: yoga's wasm is provided as a precompiled module by
 * vite-plugin-yoga-workerd.ts, and fonts are read from static assets (the
 * ASSETS binding in the Worker, the public/ folder in Node tests) and
 * registered as data URLs, because the Worker has no relative-URL fetch.
 */
import { pdf } from '@react-pdf/renderer';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { PDF_FONT_FILES, arePdfFontsRegistered, registerPdfFonts } from '@/components/invoice/pdfFonts';
import {
  PDF_FALLBACK_COVERAGE_PATH,
  type PdfFallbackCoverage,
  type PdfFallbackFonts,
  invoicePdfText,
  preparePdfFallbackFonts,
} from '@/components/invoice/pdfFallbackFonts';
import { DEFAULT_INVOICE_THEME, INVOICE_THEMES, type InvoiceTheme, isInvoiceTheme } from '@/components/invoice/invoiceTheme';
import { errors } from '../errors';
import type { InvoiceFormData } from '../../shared/types/invoice';
import type { AssetReader } from '../deps';

let fontsReady: Promise<void> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeFor(src: string): string {
  if (src.endsWith('.woff2')) return 'font/woff2';
  if (src.endsWith('.woff')) return 'font/woff';
  if (src.endsWith('.otf')) return 'font/otf';
  return 'font/ttf';
}

/** Loads every font file once per isolate and registers it as a data URL. */
export function ensurePdfFonts(readAsset: AssetReader): Promise<void> {
  if (arePdfFontsRegistered()) return Promise.resolve();
  fontsReady ??= (async () => {
    const dataUrls = new Map<string, string>();
    for (const file of PDF_FONT_FILES) {
      if (dataUrls.has(file.src)) continue;
      const buffer = await readAsset(file.src);
      dataUrls.set(file.src, `data:${mimeFor(file.src)};base64,${toBase64(buffer)}`);
    }
    registerPdfFonts((file) => dataUrls.get(file.src)!);
  })().catch((error) => {
    fontsReady = null;
    throw error;
  });
  return fontsReady;
}

let coverage: Promise<PdfFallbackCoverage> | null = null;

/**
 * Registers the fallback faces (CJK, Arabic, emoji…) this invoice needs, read
 * from static assets as data URLs, once per isolate. Text that Noto Sans Mono
 * covers reads nothing at all.
 */
export function ensurePdfFallbackFonts(data: InvoiceFormData, readAsset: AssetReader): Promise<PdfFallbackFonts> {
  return preparePdfFallbackFonts(invoicePdfText(data), {
    loadCoverage: () => {
      coverage ??= readAsset(PDF_FALLBACK_COVERAGE_PATH)
        .then((buffer) => JSON.parse(new TextDecoder().decode(buffer)) as PdfFallbackCoverage)
        .catch((error) => {
          coverage = null;
          throw error;
        });
      return coverage;
    },
    resolveSrc: async (face) => `data:${mimeFor(face.src)};base64,${toBase64(await readAsset(face.src))}`,
  });
}

/**
 * Parses the optional `theme` of the PDF endpoint / MCP tool. Missing means the
 * preview's default look (dark); anything but `light`/`dark` is a 400.
 */
export function parsePdfTheme(value: string | undefined | null): InvoiceTheme {
  if (value === undefined || value === null || value === '') return DEFAULT_INVOICE_THEME;
  if (isInvoiceTheme(value)) return value;
  throw errors.validation(
    [{ path: 'theme', message: `theme must be one of: ${INVOICE_THEMES.join(', ')}` }],
    'Invalid theme',
  );
}

export async function renderInvoicePdf(
  data: InvoiceFormData,
  readAsset: AssetReader,
  theme: InvoiceTheme = DEFAULT_INVOICE_THEME,
): Promise<Uint8Array> {
  await ensurePdfFonts(readAsset);
  const fallback = await ensurePdfFallbackFonts(data, readAsset);
  // Always pass the theme: there is no on-screen preview to follow on the server.
  const blob = await pdf(<InvoicePDF data={data} theme={theme} fallbackFamilies={fallback.families} />).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

/** Safe `Content-Disposition` filename from an invoice number. */
export function pdfFilename(invoiceNumber: string): string {
  const base = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'invoice';
  return `${base.slice(0, 80)}.pdf`;
}
