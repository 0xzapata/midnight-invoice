import { Font } from '@react-pdf/renderer';

/**
 * The ONE place that declares the fonts used by InvoicePDF.
 *
 * The on-screen preview renders every text role (labels, headings, body,
 * numbers) in Noto Sans Mono (`.invoice-preview *` in src/index.css), at
 * weights 400, 500 (`font-medium`) and 600 (`font-semibold`). The same three
 * static TTF faces are declared there with @font-face and here for the PDF, so
 * both use identical glyphs. Noto Sans Mono covers every symbol that
 * `formatCurrency` can print for the currencies in src/lib/currencies.ts
 * (€ £ ¥ ₹ ₪ ₩ ₫ ₱, NBSP, ...) and Latin, Greek and Cyrillic text. Other scripts
 * (CJK, Arabic, Hebrew, Thai, Devanagari, emoji) use fallback faces that are
 * registered only when an invoice contains them: see ./pdfFallbackFonts.ts.
 *
 * Files live in `public/fonts/` (SIL OFL 1.1, see NotoSansMono-OFL.txt) and
 * are referenced by their public path. The browser loads them by URL; the API
 * Worker (server/pdf/render.tsx) reads the same files from the static-assets
 * binding and registers them as data URLs. (The app-chrome fonts BasierCircle
 * and ProtoMono, WOFF2, are not used inside the invoice and lack ₹ ₪ ₩ ₫ ₱.)
 */
export interface PdfFontFile {
  family: string;
  /** Public path of the font file, e.g. `/fonts/Inter-Regular.ttf` (TTF/OTF/WOFF). */
  src: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export const PDF_FONT_FAMILY = 'Noto Sans Mono';

export const PDF_FONT_FILES: PdfFontFile[] = [
  { family: PDF_FONT_FAMILY, src: '/fonts/NotoSansMono-Regular.ttf', fontWeight: 400 },
  { family: PDF_FONT_FAMILY, src: '/fonts/NotoSansMono-Medium.ttf', fontWeight: 500 },
  { family: PDF_FONT_FAMILY, src: '/fonts/NotoSansMono-SemiBold.ttf', fontWeight: 600 },
];

let registered = false;

/**
 * Registers the PDF fonts once per JS context. The first caller decides how
 * sources are resolved: the browser passes nothing (fetch by URL); the Worker
 * calls this with data URLs before rendering.
 */
export function registerPdfFonts(resolveSrc: (file: PdfFontFile) => string = (file) => file.src): void {
  if (registered) return;
  registered = true;
  for (const file of PDF_FONT_FILES) {
    Font.register({
      family: file.family,
      src: resolveSrc(file),
      fontWeight: file.fontWeight,
      fontStyle: file.fontStyle,
    });
  }
  // The preview never hyphenates (no `hyphens: auto`); wrap whole words in the PDF too.
  Font.registerHyphenationCallback((word) => [word]);
}

export function arePdfFontsRegistered(): boolean {
  return registered;
}
