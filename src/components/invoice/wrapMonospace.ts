/** Every Noto Sans Mono glyph the invoice prints advances 600/1000 em. */
const MONO_ADVANCE = 0.6;

/**
 * Wraps text the way the preview's browser does: greedily, breaking only at
 * spaces and after hyphens, never hyphenating. @react-pdf's own line breaker
 * (Knuth-Plass) may squeeze spaces to fit one more word on a line, which makes
 * PDF lines and row heights differ from the preview; with a monospace font the
 * browser's breaks can be computed exactly and passed in as explicit lines.
 * `preLine` keeps newlines (`whitespace-pre-line`); otherwise they collapse to
 * spaces as in normal HTML flow. Words longer than a line are split (the
 * preview lets them overflow instead).
 */
export function wrapMonospace(text: string, width: number, fontSize: number, preLine = false): string[] {
  const max = Math.max(1, Math.floor((width + 0.01) / (fontSize * MONO_ADVANCE)));
  const len = (s: string) => [...s].length;
  const paragraphs = (preLine ? text : text.replace(/\s*\n\s*/g, ' ')).split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = paragraph.trim().match(/[^\s-]*-+(?=[^\s-])|\S+|\s+/g) ?? [];
    let line = '';
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) line += ' ';
        continue;
      }
      if (len((line + token).trimEnd()) <= max) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = token;
      while (len(line) > max) {
        const chars = [...line];
        lines.push(chars.slice(0, max).join(''));
        line = chars.slice(max).join('');
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
