/**
 * Minimal PDF inspection for tests: inflates FlateDecode streams, reads each
 * font's ToUnicode CMap and decodes the hex strings shown by Tj/TJ operators
 * with the CMap of the font selected by the preceding Tf. Good enough for
 * pdfkit output (what @react-pdf/renderer produces).
 */
import { inflateSync } from 'node:zlib';

interface PdfObject {
  dict: string;
  stream: string | null;
}

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const streamAt = body.search(/stream\r?\n/);
    let stream: string | null = null;
    let dict = body;
    if (streamAt >= 0) {
      dict = body.slice(0, streamAt);
      const dataStart = start + streamAt + body.slice(streamAt).match(/^stream\r?\n/)![0].length;
      const dataEnd = text.indexOf('endstream', dataStart);
      let raw = pdf.subarray(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) {
        try {
          raw = inflateSync(raw);
        } catch {
          raw = Buffer.alloc(0);
        }
      }
      stream = raw.toString('latin1');
    }
    objects.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return objects;
}

/** Every (inflated) stream of the PDF as latin1 text, e.g. to look for drawing operators. */
export function pdfStreams(bytes: Uint8Array): string[] {
  return [...parseObjects(Buffer.from(bytes)).values()].flatMap((o) => (o.stream === null ? [] : [o.stream]));
}

/** `/BaseFont` names of every font dictionary in the PDF (subset prefixes included). */
export function pdfBaseFonts(bytes: Uint8Array): string[] {
  return [...parseObjects(Buffer.from(bytes)).values()]
    .map((o) => o.dict.match(/\/Type\s*\/Font\b[^]*?\/BaseFont\s*\/([^\s/>]+)/)?.[1] ?? o.dict.match(/\/BaseFont\s*\/([^\s/>]+)[^]*?\/Type\s*\/Font\b/)?.[1])
    .filter((name): name is string => !!name);
}

function hexToString(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 4) {
    s += String.fromCodePoint(parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16));
  }
  return s;
}

function parseCMap(s: string): Map<string, string> {
  const cmap = new Map<string, string>();
  for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) cmap.set(src.toLowerCase(), hexToString(dst));
  }
  for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const line of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]+>)/g)) {
      const [, lo, hi, dst] = line;
      const width = lo.length;
      const from = parseInt(lo, 16);
      const to = parseInt(hi, 16);
      // pdfkit writes astral targets with a space between the UTF-16 halves (<d83d de80>).
      const targets = dst.startsWith('[') ? [...dst.matchAll(/<([0-9a-fA-F\s]+)>/g)].map((x) => x[1].replace(/\s+/g, '')) : null;
      for (let c = from; c <= to; c++) {
        const key = c.toString(16).padStart(width, '0');
        if (targets) cmap.set(key, hexToString(targets[c - from] ?? ''));
        else cmap.set(key, String.fromCodePoint(parseInt(dst.slice(1, -1).replace(/\s+/g, ''), 16) + (c - from)));
      }
    }
  }
  return cmap;
}

function decodeWith(cmap: Map<string, string> | undefined, hex: string): string {
  const width = cmap?.size ? [...cmap.keys()][0].length : 2;
  let s = '';
  for (let i = 0; i < hex.length; i += width) {
    const key = hex.slice(i, i + width).toLowerCase();
    s += cmap?.get(key) ?? String.fromCharCode(parseInt(key, 16));
  }
  return s;
}

export function extractPdfText(bytes: Uint8Array): string {
  return extractPdfPages(bytes).map((lines) => lines.join('\n')).join('\n');
}

/** The text runs of each page, in drawing order (one array per page, in page order). */
export function extractPdfPages(bytes: Uint8Array): string[][] {
  const objects = parseObjects(Buffer.from(bytes));
  // Font object id -> its ToUnicode CMap.
  const cmapByFont = new Map<number, Map<string, string>>();
  for (const [id, o] of objects) {
    const ref = o.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    const cmapStream = ref ? objects.get(Number(ref[1]))?.stream : null;
    if (cmapStream) cmapByFont.set(id, parseCMap(cmapStream));
  }
  const pages: string[][] = [];
  for (const page of pageObjectsInOrder(objects)) {
    const lines: string[] = [];
    pages.push(lines);
    // Resource name (e.g. F2) -> font object id. Resources may be inline or referenced.
    let resources = page.dict;
    const resRef = page.dict.match(/\/Resources\s+(\d+)\s+0\s+R/);
    if (resRef) resources = objects.get(Number(resRef[1]))?.dict ?? '';
    const fontDict = resources.match(/\/Font\s*<<([^>]*)>>/)?.[1] ?? '';
    const fontIds = new Map([...fontDict.matchAll(/\/(\S+)\s+(\d+)\s+0\s+R/g)].map(([, name, id]) => [name, Number(id)]));
    const contentRefs = [...(page.dict.match(/\/Contents\s+(\[[^\]]*\]|\d+\s+0\s+R)/)?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)];
    for (const [, ref] of contentRefs) {
      const content = objects.get(Number(ref))?.stream ?? '';
      let cmap: Map<string, string> | undefined;
      for (const op of content.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|\[((?:[^\]]*?))\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (op[1] !== undefined) {
          cmap = cmapByFont.get(fontIds.get(op[1]) ?? -1);
        } else if (op[2] !== undefined) {
          lines.push([...op[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => decodeWith(cmap, x[1])).join(''));
        } else {
          lines.push(decodeWith(cmap, op[3]));
        }
      }
    }
  }
  return pages;
}

/** The (inflated) content stream of each page, in page order. */
export function pdfPageContents(bytes: Uint8Array): string[] {
  const objects = parseObjects(Buffer.from(bytes));
  return pageObjectsInOrder(objects).map((page) =>
    [...(page.dict.match(/\/Contents\s+(\[[^\]]*\]|\d+\s+0\s+R)/)?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)]
      .map(([, ref]) => objects.get(Number(ref))?.stream ?? '')
      .join('\n'),
  );
}

/** Page objects in document order (following /Kids from the page tree root). */
function pageObjectsInOrder(objects: Map<number, PdfObject>): PdfObject[] {
  const root = [...objects.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\b/.test(o.dict));
  const out: PdfObject[] = [];
  const visit = (o: PdfObject | undefined) => {
    if (!o) return;
    if (/\/Type\s*\/Page\b/.test(o.dict)) {
      out.push(o);
      return;
    }
    const kids = o.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? '';
    for (const [, id] of kids.matchAll(/(\d+)\s+0\s+R/g)) visit(objects.get(Number(id)));
  };
  visit(root);
  return out;
}
