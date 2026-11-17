import { Font } from '@react-pdf/renderer';

/**
 * The ONE place that declares the fonts used by InvoicePDF.
 *
 * Files live in `public/` and are referenced by their public path. The browser
 * loads them by URL; the API Worker (server/pdf/render.ts) reads the same
 * files from the static-assets binding and registers them as data URLs. To
 * change PDF fonts, edit this list (and the `fontFamily`/`fontWeight` styles in
 * InvoicePDF.tsx); both renderers pick it up.
 */
export interface PdfFontFile {
  family: string;
  /** Public path of the font file, e.g. `/fonts/Inter-Regular.ttf` (TTF/OTF/WOFF). */
  src: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export const PDF_FONT_FAMILY = 'Noto Sans Mono';

// Using local Noto Sans Mono font for widely supported currency symbols
export const PDF_FONT_FILES: PdfFontFile[] = [
  { family: PDF_FONT_FAMILY, src: '/fonts/NotoSansMono-Regular.ttf' },
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
}

export function arePdfFontsRegistered(): boolean {
  return registered;
}
