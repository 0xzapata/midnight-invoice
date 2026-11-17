/**
 * Minimal PDF text extraction for tests: inflates FlateDecode streams, reads
 * ToUnicode CMaps and decodes the hex strings shown by Tj/TJ operators. Good
 * enough for pdfkit output (what @react-pdf/renderer produces).
 */
import { inflateSync } from 'node:zlib';

function streams(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    let raw = pdf.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) {
      try {
        raw = inflateSync(raw);
      } catch {
        continue;
      }
    }
    out.push(raw.toString('latin1'));
    re.lastIndex = end;
  }
  return out;
}

function hexToString(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 4) {
    s += String.fromCodePoint(parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16));
  }
  return s;
}

export function extractPdfText(bytes: Uint8Array): string {
  const all = streams(Buffer.from(bytes));
  const cmap = new Map<string, string>();
  for (const s of all) {
    if (!s.includes('begincmap')) continue;
    for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) cmap.set(src.toLowerCase(), hexToString(dst));
    }
    for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const line of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
        const [, lo, hi, dst] = line;
        const width = lo.length;
        const from = parseInt(lo, 16);
        const to = parseInt(hi, 16);
        const targets = dst.startsWith('[') ? [...dst.matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]) : null;
        for (let c = from; c <= to; c++) {
          const key = c.toString(16).padStart(width, '0');
          if (targets) cmap.set(key, hexToString(targets[c - from] ?? ''));
          else cmap.set(key, String.fromCodePoint(parseInt(dst.slice(1, -1), 16) + (c - from)));
        }
      }
    }
  }
  const width = cmap.size ? [...cmap.keys()][0].length : 2;
  const decode = (hex: string) => {
    let s = '';
    for (let i = 0; i < hex.length; i += width) {
      const key = hex.slice(i, i + width).toLowerCase();
      s += cmap.get(key) ?? String.fromCharCode(parseInt(key, 16));
    }
    return s;
  };
  const lines: string[] = [];
  for (const s of all) {
    if (s.includes('begincmap')) continue;
    for (const op of s.matchAll(/\[((?:[^\]]*?))\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      if (op[1] !== undefined) {
        lines.push([...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => decode(x[1])).join(''));
      } else {
        lines.push(decode(op[2]));
      }
    }
  }
  return lines.join('\n');
}
