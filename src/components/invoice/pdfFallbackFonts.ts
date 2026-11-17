import { Font } from '@react-pdf/renderer';
import type { InvoiceFormData } from '@/types/invoice';
import { sanitizeInvoiceData } from '@/lib/sanitize';
import { printableInvoiceName } from '@/lib/invoiceName';
import faceList from './pdfFallbackFaces.json';
import { NOTO_SANS_MONO_COVERAGE } from './pdfFontCoverage';

/**
 * Fallback fonts for characters Noto Sans Mono (the invoice font) has no glyph
 * for: CJK, Hangul, Arabic, Hebrew, Thai, Devanagari and emoji.
 *
 * They are large compared to the invoice itself (Noto Sans SC alone is
 * 1.5 MB), so nothing is loaded up front: the bundled Noto Sans Mono coverage
 * (pdfFontCoverage.ts, ~2 KB) tells whether an invoice needs any fallback at
 * all. Only then is the per-face coverage table fetched
 * (/fonts/fallback/coverage.json) and only the faces that cover the missing
 * characters are registered with react-pdf, which downloads (browser) or
 * reads (Worker, via the ASSETS binding) just those files. The preview
 * declares the same faces with `unicode-range` in src/index.css, so the
 * browser also fetches them only for text that needs them, and preview and
 * PDF draw those characters with the same glyphs.
 *
 * Characters no face covers (e.g. Bengali, Tamil, Georgian, rare Han
 * characters) are reported as `unsupported` so the app can warn before
 * exporting; in the PDF they print as Noto's empty box.
 *
 * Files and licences (SIL OFL 1.1): public/fonts/fallback/. Regenerate the
 * coverage tables with `node scripts/pdf-font-coverage.mjs` after changing them.
 */

export interface PdfFallbackFace {
  family: string;
  /** Public path of the font file (WOFF: fontkit cannot subset WOFF2 composite glyphs). */
  src: string;
  /** Human description of what the face covers. */
  scripts: string;
}

export const PDF_FALLBACK_FACES: PdfFallbackFace[] = faceList.PDF_FALLBACK_FACES;

/** Per-face coverage, generated from the font files. Fetched only when needed. */
export const PDF_FALLBACK_COVERAGE_PATH = '/fonts/fallback/coverage.json';

type Ranges = ReadonlyArray<readonly [number, number]>;
export interface PdfFallbackCoverage {
  faces: { family: string; ranges: Ranges }[];
}

function inRanges(cp: number, ranges: Ranges): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** True when Noto Sans Mono has a glyph for the code point. */
export function isInPrimaryFont(cp: number): boolean {
  return inRanges(cp, NOTO_SANS_MONO_COVERAGE);
}

/** Invisible characters that never need a glyph of their own (whitespace, joiners, variation selectors, BOM, emoji tags). */
function isInvisible(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp < 0xa0) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    (cp >= 0xe0000 && cp <= 0xe01ef)
  );
}

/** Distinct code points of `text` that Noto Sans Mono cannot draw. */
export function charactersMissingFromPrimary(text: string): number[] {
  const missing = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isInvisible(cp) && !isInPrimaryFont(cp)) missing.add(cp);
  }
  return [...missing].sort((a, b) => a - b);
}

/** Every piece of text the PDF prints for this invoice (what the fonts must cover). */
export function invoicePdfText(data: InvoiceFormData): string {
  const d = sanitizeInvoiceData(data);
  return [
    d.invoiceNumber,
    printableInvoiceName(d.invoiceName),
    d.fromName, d.fromAddress, d.fromEmail,
    d.toName, d.toAddress, d.toEmail,
    ...d.lineItems.map((item) => item.description),
    d.notes, d.paymentDetails,
  ].join('\n');
}

export interface PdfFallbackPlan {
  /** Faces to register and append to the font stack, in PDF_FALLBACK_FACES order. */
  faces: PdfFallbackFace[];
  /** Characters no face covers (they print as an empty box). */
  unsupported: string[];
}

/** Picks the fewest faces (in declaration order) that cover `missing`. */
export function planPdfFallbacks(missing: number[], coverage: PdfFallbackCoverage): PdfFallbackPlan {
  const needed = new Set<string>();
  const unsupported: string[] = [];
  for (const cp of missing) {
    const face = coverage.faces.find((f) => inRanges(cp, f.ranges));
    if (face) needed.add(face.family);
    else unsupported.push(String.fromCodePoint(cp));
  }
  return { faces: PDF_FALLBACK_FACES.filter((f) => needed.has(f.family)), unsupported };
}

const registered = new Map<string, Promise<void>>();

/** Registers a fallback face once per JS context; `resolveSrc` gives the URL (browser) or data URL (Worker). */
function registerFace(face: PdfFallbackFace, resolveSrc: (face: PdfFallbackFace) => string | Promise<string>): Promise<void> {
  let ready = registered.get(face.family);
  if (!ready) {
    ready = Promise.resolve(resolveSrc(face)).then((src) => {
      Font.register({ family: face.family, src, fontWeight: 400 });
    });
    ready.catch(() => registered.delete(face.family));
    registered.set(face.family, ready);
  }
  return ready;
}

/** Families of the fallback faces registered so far (for tests and diagnostics). */
export function registeredPdfFallbackFamilies(): string[] {
  return [...registered.keys()];
}

export interface PreparePdfFallbackOptions {
  /** Loads public/fonts/fallback/coverage.json. Called only when the text needs a fallback. */
  loadCoverage: () => Promise<PdfFallbackCoverage>;
  /** Where react-pdf loads a face from (default: its public URL). */
  resolveSrc?: (face: PdfFallbackFace) => string | Promise<string>;
}

export interface PdfFallbackFonts {
  /** Font families to pass to InvoicePDF (`fallbackFamilies`), already registered. */
  families: string[];
  /** Characters the PDF cannot print. */
  unsupported: string[];
}

/**
 * Makes sure the fonts for `text` are available to react-pdf: registers only
 * the fallback faces the text needs, and nothing (no fetch at all) for text
 * Noto Sans Mono covers.
 */
export async function preparePdfFallbackFonts(text: string, options: PreparePdfFallbackOptions): Promise<PdfFallbackFonts> {
  const missing = charactersMissingFromPrimary(text);
  if (missing.length === 0) return { families: [], unsupported: [] };
  const plan = planPdfFallbacks(missing, await options.loadCoverage());
  const resolveSrc = options.resolveSrc ?? ((face: PdfFallbackFace) => face.src);
  await Promise.all(plan.faces.map((face) => registerFace(face, resolveSrc)));
  return { families: plan.faces.map((f) => f.family), unsupported: plan.unsupported };
}
