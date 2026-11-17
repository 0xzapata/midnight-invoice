/**
 * Fallback fonts for characters Noto Sans Mono lacks: coverage tables match
 * the font files, faces are loaded only when needed, and the PDF prints the
 * characters with real glyphs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as fontkit from 'fontkit';
import { readPublicAsset } from './test/helpers';
import { extractPdfText, pdfBaseFonts } from './test/pdf-text';
import { renderInvoicePdf } from './pdf/render';
import { NOTO_SANS_MONO_COVERAGE } from '@/components/invoice/pdfFontCoverage';
import {
  PDF_FALLBACK_FACES,
  type PdfFallbackCoverage,
  charactersMissingFromPrimary,
  planPdfFallbacks,
  preparePdfFallbackFonts,
  registeredPdfFallbackFamilies,
} from '@/components/invoice/pdfFallbackFonts';
import type { InvoiceFormData } from '../shared/types/invoice';

const root = path.resolve(import.meta.dirname, '..');
const pub = (p: string) => path.join(root, 'public', p);
const coverageJson = JSON.parse(readFileSync(pub('/fonts/fallback/coverage.json'), 'utf8')) as PdfFallbackCoverage;

function rangesOf(file: string): [number, number][] {
  const font = fontkit.create(readFileSync(pub(file))) as fontkit.Font;
  const points = [...font.characterSet].filter((cp) => font.glyphForCodePoint(cp).id !== 0).sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const cp of points) {
    const last = ranges.at(-1);
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

const fonts = (bytes: Uint8Array) => [...new Set(pdfBaseFonts(bytes).map((n) => n.replace(/^[A-Z]{6}\+/, '')))].sort();

const formData = (overrides: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  invoiceNumber: 'INV-0042',
  issueDate: '2026-11-17',
  dueDate: '',
  fromName: 'Midnight Studio',
  fromAddress: '',
  fromEmail: '',
  toName: 'Client',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: '1', description: 'Work', quantity: 1, price: 1 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  ...overrides,
});

describe('glyph coverage tables (scripts/pdf-font-coverage.mjs)', () => {
  it('match Noto Sans Mono', () => {
    expect(NOTO_SANS_MONO_COVERAGE).toEqual(rangesOf('/fonts/NotoSansMono-Regular.ttf'));
  });

  it('match every fallback face, in declaration order', () => {
    expect(coverageJson.faces.map((f) => f.family)).toEqual(PDF_FALLBACK_FACES.map((f) => f.family));
    for (const face of PDF_FALLBACK_FACES) {
      expect(coverageJson.faces.find((f) => f.family === face.family)?.ranges, face.family).toEqual(rangesOf(face.src));
    }
  });

  it('Noto Sans Mono covers Latin, Greek and Cyrillic but not CJK, Arabic, Hebrew, Thai, Devanagari or emoji', () => {
    expect(charactersMissingFromPrimary('Ünïcødé façade — Ελληνικά Русский Українська ₴ € ₹ ½ “quotes” …')).toEqual([]);
    for (const text of ['发', 'カ', '한', 'ف', 'ש', 'ก', 'क', '🚀', 'অ', 'ა']) {
      expect(charactersMissingFromPrimary(text), text).toHaveLength(1);
    }
    // Joiners and variation selectors need no glyph of their own.
    expect(charactersMissingFromPrimary('a‍️b​')).toEqual([]);
  });
});

describe('fallback font files', () => {
  it.each(PDF_FALLBACK_FACES)('$family is a WOFF with its SIL OFL licence next to it', (face) => {
    const bytes = readFileSync(pub(face.src));
    // WOFF 1.0: fontkit cannot subset WOFF2 fonts with composite glyphs.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOFF');
    const licence = face.src.replace(/-Regular\.woff$/, '-OFL.txt');
    expect(readFileSync(pub(licence), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it('are declared for the preview with the same files and in the same order as the PDF stack', () => {
    const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');
    for (const face of PDF_FALLBACK_FACES) {
      expect(css).toMatch(new RegExp(`font-family: '${face.family}';\\s*src: url\\('${face.src.replace(/\./g, '\\.')}'\\) format\\('woff'\\);[^}]*unicode-range:`));
    }
    const stack = css.match(/\.invoice-preview \*\s*\{\s*font-family:\s*([^;]+);/)?.[1];
    expect(stack).toBe(["'Noto Sans Mono'", ...PDF_FALLBACK_FACES.map((f) => `'${f.family}'`), 'monospace'].join(', '));
  });
});

describe('loading fallback faces on demand', () => {
  it('loads nothing for text Noto Sans Mono covers', async () => {
    const loadCoverage = vi.fn(async () => coverageJson);
    const resolveSrc = vi.fn((face: { src: string }) => face.src);
    expect(await preparePdfFallbackFonts('Müller & Söhne — Ελλάδα, Москва €12', { loadCoverage, resolveSrc })).toEqual({ families: [], unsupported: [] });
    expect(loadCoverage).not.toHaveBeenCalled();
    expect(resolveSrc).not.toHaveBeenCalled();
  });

  it('registers only the faces the text needs and reports what nothing covers', async () => {
    const resolveSrc = vi.fn((face: { family: string; src: string }) => pub(face.src));
    const result = await preparePdfFallbackFonts('Invoice שלום 🚀 আমার', { loadCoverage: async () => coverageJson, resolveSrc });
    expect(result.families).toEqual(['Noto Sans Hebrew', 'Noto Emoji']);
    expect(result.unsupported).toEqual(['আ', 'ম', 'র', 'া']);
    expect(resolveSrc.mock.calls.map(([face]) => face.family)).toEqual(['Noto Sans Hebrew', 'Noto Emoji']);
    expect(registeredPdfFallbackFamilies()).not.toContain('Noto Sans SC');
  });

  it('plans the fewest faces in a fixed order', () => {
    const plan = planPdfFallbacks(charactersMissingFromPrimary('한국 中国 日本語 ひらがな'), coverageJson);
    expect(plan.faces.map((f) => f.family)).toEqual(['Noto Sans SC', 'Noto Sans KR']);
    expect(plan.unsupported).toEqual([]);
  });
});

describe('PDF output with non-Latin text', () => {
  it('embeds only Noto Sans Mono for Latin/Greek/Cyrillic invoices', async () => {
    const bytes = await renderInvoicePdf(formData({ toName: 'ООО «Ромашка»', notes: 'Ευχαριστώ' }), readPublicAsset);
    expect(fonts(bytes).every((f) => f.startsWith('NotoSansMono-'))).toBe(true);
    expect(extractPdfText(bytes)).toContain('ООО «Ромашка»');
  });

  it.each([
    ['Chinese', '网站设计与开发', 'NotoSansSC', '网站设计与开发'],
    ['Japanese', 'ウェブサイト制作', 'NotoSansSC', 'ウェブサイト制作'],
    ['Korean', '웹사이트 디자인', 'NotoSansKR', '웹사이트 디자인'],
    ['Thai', 'ออกแบบเว็บไซต์', 'NotoSansThai', 'ออกแบบเว็บไซต์'],
    // Shaped conjuncts/reordered vowel signs do not map back to text one to one; the first word does.
    ['Hindi', 'वेबसाइट डिज़ाइन', 'NotoSansDevanagari', 'वेबसाइट'],
    ['emoji', 'Launch 🚀 done ✅', 'NotoEmoji', 'Launch 🚀 done ✅'],
  ])('prints %s with real glyphs from the fallback face', async (_script, description, font, expected) => {
    const bytes = await renderInvoicePdf(formData({ lineItems: [{ id: '1', description, quantity: 1, price: 1 }] }), readPublicAsset);
    expect(fonts(bytes)).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${font}`))]));
    // A missing glyph maps to .notdef, which has no Unicode mapping and drops out of the text.
    // Runs are split where the font or a mark changes, so compare without line breaks.
    const text = extractPdfText(bytes).replace(/\n/g, '');
    expect(text).toContain(expected);
  });

  it.each([
    ['Hebrew', 'עיצוב אתר', 'NotoSansHebrew'],
    ['Arabic', 'تصميم الموقع', 'NotoSansArabic'],
  ])('prints right-to-left %s with the fallback face (every letter has a glyph)', async (_script, description, font) => {
    const bytes = await renderInvoicePdf(formData({ lineItems: [{ id: '1', description, quantity: 1, price: 1 }] }), readPublicAsset);
    expect(fonts(bytes)).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${font}`))]));
    // Glyphs are drawn in visual (right-to-left) order, so compare the letters, not the string.
    const letters = (s: string) => [...s.replace(/\s/g, '')].sort().join('');
    const line = extractPdfText(bytes).split('\n').filter((l) => /[\u0590-\u06ff\ufb50-\ufeff]/.test(l)).join('');
    if (font === 'NotoSansHebrew') expect(letters(line)).toBe(letters(description));
    // Shaped Arabic glyphs (joined forms, lam-alef ligature) map back to base letters only approximately
    // in pdfkit's ToUnicode table, so only check that Arabic glyphs were drawn; shaping is checked visually.
    else expect(line.replace(/\s/g, '').length).toBeGreaterThanOrEqual(description.replace(/\s/g, '').length - 2);
  });
});
