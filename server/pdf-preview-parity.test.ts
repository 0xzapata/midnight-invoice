import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Font } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FILES, arePdfFontsRegistered, registerPdfFonts } from '@/components/invoice/pdfFonts';
import { DEFAULT_INVOICE_THEME, INVOICE_CSS_TOKENS } from '@/components/invoice/invoiceTheme';

/**
 * The PDF (InvoicePDF.tsx) cannot read CSS, so it mirrors the preview's CSS
 * tokens and fonts. These tests fail when the two drift apart.
 */

const root = path.resolve(import.meta.dirname, '..');
const css = readFileSync(path.resolve(root, 'src/index.css'), 'utf8');
const html = readFileSync(path.resolve(root, 'index.html'), 'utf8');

/** Reads `--name: value;` declarations from the first `selector { ... }` block of src/index.css. */
function cssVars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block in index.css`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

describe('PDF palette', () => {
  it('uses exactly the CSS tokens the preview reads (:root = light, .dark = dark)', () => {
    const light = cssVars(':root');
    const dark = cssVars('.dark');
    for (const [token, value] of Object.entries(INVOICE_CSS_TOKENS.light)) expect(light[token], `light --${token}`).toBe(value);
    for (const [token, value] of Object.entries(INVOICE_CSS_TOKENS.dark)) expect(dark[token], `dark --${token}`).toBe(value);
  });

  it('defaults to the theme the app ships with (<body class="dark">)', () => {
    expect(DEFAULT_INVOICE_THEME).toBe('dark');
    expect(html).toMatch(/<body[^>]*class="[^"]*\bdark\b/);
  });
});

describe('PDF fonts', () => {
  it('are the font family the preview computes for every text role', () => {
    // `.invoice-preview *` overrides the app fonts (BasierCircle/ProtoMono) for all invoice text.
    expect(css).toMatch(new RegExp(`\\.invoice-preview \\*\\s*\\{\\s*font-family:\\s*'${PDF_FONT_FAMILY}'`));
  });

  it('declare a TTF face for each weight the preview uses (400, font-medium 500, font-semibold 600)', () => {
    expect(PDF_FONT_FILES.map((f) => f.fontWeight).sort()).toEqual([400, 500, 600]);
    for (const file of PDF_FONT_FILES) {
      const bytes = readFileSync(path.join(root, 'public', file.src));
      // TrueType outlines (sfnt version 0x00010000): readable by react-pdf in the browser and the Worker.
      expect(bytes.readUInt32BE(0), file.src).toBe(0x00010000);
    }
  });

  it('are the same files the preview loads with @font-face', () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
      family: body.match(/font-family:\s*'([^']+)'/)?.[1],
      src: body.match(/url\('([^']+)'\)/)?.[1],
      weight: Number(body.match(/font-weight:\s*(\d+)/)?.[1]),
    }));
    for (const file of PDF_FONT_FILES) {
      expect(faces).toContainEqual({ family: file.family, src: file.src, weight: file.fontWeight });
    }
  });

  it('ship with their licence', () => {
    expect(readFileSync(path.join(root, 'public/fonts/NotoSansMono-OFL.txt'), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it('register every face with react-pdf once', () => {
    registerPdfFonts();
    registerPdfFonts();
    expect(arePdfFontsRegistered()).toBe(true);
    expect(Font.getRegisteredFontFamilies()).toContain(PDF_FONT_FAMILY);
    const family = Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight: 600 });
    expect(family?.src).toBe('/fonts/NotoSansMono-SemiBold.ttf');
    expect(Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight: 500 })?.src).toBe('/fonts/NotoSansMono-Medium.ttf');
    expect(Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight: 400 })?.src).toBe('/fonts/NotoSansMono-Regular.ttf');
  });
});
