import { pdf } from '@react-pdf/renderer';
import type { InvoiceFormData } from '@/types/invoice';
import { InvoicePDF } from './InvoicePDF';
import { PDF_FALLBACK_COVERAGE_PATH, type PdfFallbackCoverage, invoicePdfText, preparePdfFallbackFonts } from './pdfFallbackFonts';

export interface InvoicePdfExport {
  blob: Blob;
  /** Characters the PDF cannot print (shown as empty boxes); warn the user. */
  unsupported: string[];
}

async function loadCoverage(): Promise<PdfFallbackCoverage> {
  const res = await fetch(PDF_FALLBACK_COVERAGE_PATH);
  if (!res.ok) throw new Error(`Could not load ${PDF_FALLBACK_COVERAGE_PATH} (${res.status})`);
  return (await res.json()) as PdfFallbackCoverage;
}

/**
 * Renders the invoice PDF in the browser. Fallback fonts (CJK, Arabic, emoji…)
 * are fetched only when the invoice contains characters that need them.
 */
export async function exportInvoicePdf(data: InvoiceFormData): Promise<InvoicePdfExport> {
  const fonts = await preparePdfFallbackFonts(invoicePdfText(data), { loadCoverage });
  const blob = await pdf(<InvoicePDF data={data} fallbackFamilies={fonts.families} />).toBlob();
  return { blob, unsupported: fonts.unsupported };
}

/** Toast text for characters the PDF cannot print, or null when everything prints. */
export function unsupportedCharactersWarning(unsupported: string[]): string | null {
  if (unsupported.length === 0) return null;
  const shown = unsupported.slice(0, 12).join(' ');
  return `Some characters cannot be printed in the PDF and appear as empty boxes: ${shown}${unsupported.length > 12 ? ' …' : ''}`;
}
