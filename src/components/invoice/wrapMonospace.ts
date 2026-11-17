import { NOTO_SANS_MONO_COVERAGE } from './pdfFontCoverage';

/** Every Noto Sans Mono glyph the invoice prints advances 600/1000 em. */
const MONO_ADVANCE = 0.6;

const isMono = (cp: number) => {
  let lo = 0;
  let hi = NOTO_SANS_MONO_COVERAGE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < NOTO_SANS_MONO_COVERAGE[mid][0]) hi = mid - 1;
    else if (cp > NOTO_SANS_MONO_COVERAGE[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
};

/** Marks, zero-width joiners/spaces and variation selectors: no advance, never a line start. */
const COMBINING = {
  test: (ch: string) => {
    const cp = ch.codePointAt(0)!;
    return /^\p{M}$/u.test(ch) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f);
  },
};
const EMOJI = /^\p{Extended_Pictographic}$/u;
/** CJK ideographs, kana, CJK punctuation, full-width forms: 1 em in Noto Sans SC, and a line-break opportunity on each side. */
const CJK = /^[\u2e80-\u303f\u3040-\u30ff\u3100-\u31ff\u3200-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]$/u;
const HANGUL = /^[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]$/u;

/**
 * Advance of one character in em. Noto Sans Mono characters are exact; the
 * fallback faces (pdfFallbackFonts.ts) are proportional, so their widths are
 * typical values: Noto Sans SC 1, Noto Sans KR 0.92, Noto Emoji 1.27, other
 * scripts ~0.55. A line that turns out wider is wrapped again by react-pdf.
 */
function advance(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (isMono(cp)) return /^\p{M}$/u.test(ch) ? 0 : MONO_ADVANCE;
  if (COMBINING.test(ch)) return 0;
  if (CJK.test(ch)) return 1;
  if (HANGUL.test(ch)) return 0.92;
  if (EMOJI.test(ch)) return 1.27;
  return 0.55;
}

/** A browser may break before and after each of these (CSS line breaking for CJK, Hangul and emoji). */
const breaksAround = (ch: string) => CJK.test(ch) || HANGUL.test(ch) || EMOJI.test(ch);

const widthOf = (s: string) => [...s].reduce((sum, ch) => sum + advance(ch), 0);

/**
 * Wraps text the way the preview's browser does: greedily, breaking only at
 * spaces, after hyphens and around CJK/Hangul/emoji characters, never
 * hyphenating. @react-pdf's own line breaker (Knuth-Plass) may squeeze spaces
 * to fit one more word on a line, which makes PDF lines and row heights differ
 * from the preview; with a monospace font the browser's breaks can be
 * computed exactly and passed in as explicit lines.
 * `preLine` keeps newlines (`whitespace-pre-line`); otherwise they collapse to
 * spaces as in normal HTML flow. Words longer than a line are split (the
 * preview lets them overflow instead).
 */
export function wrapMonospace(text: string, width: number, fontSize: number, preLine = false): string[] {
  // Available width in em (at least one monospace character).
  const max = Math.max(MONO_ADVANCE, (width + 0.01) / fontSize);
  const fits = (s: string) => widthOf(s) <= max + 1e-9;
  const paragraphs = (preLine ? text : text.replace(/\s*\n\s*/g, ' ')).split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().match(/[^\s-]*-+(?=[^\s-])|\S+|\s+/g) ?? [];
    // Wide characters are tokens of their own: a line may break before or after them.
    const tokens = words.flatMap((word) => (/^\s+$/.test(word) ? [word] : splitAroundWide(word)));
    let line = '';
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) line += ' ';
        continue;
      }
      if (fits((line + token).trimEnd())) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = token;
      while (!fits(line)) {
        const chars = [...line];
        let n = 1;
        while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++;
        lines.push(chars.slice(0, n).join(''));
        line = chars.slice(n).join('');
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function splitAroundWide(word: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of word) {
    if (breaksAround(ch)) {
      if (current) parts.push(current);
      parts.push(ch);
      current = '';
    } else if (COMBINING.test(ch) && parts.length > 0 && !current) {
      // Keep marks and variation selectors with the character they modify.
      parts[parts.length - 1] += ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}
