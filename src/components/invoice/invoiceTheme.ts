/**
 * Colour tokens of the invoice, shared by the on-screen preview and the PDF.
 *
 * The preview (InvoicePreview.tsx) is styled with Tailwind classes that read
 * the CSS design tokens in `src/index.css` (`bg-card`, `text-foreground`,
 * `text-muted-foreground`, `border-border`, `text-primary`), which follow the
 * closest `.dark` ancestor. The PDF (InvoicePDF.tsx) cannot read CSS, so it
 * uses INVOICE_PALETTES, built from the very same HSL token values below.
 * `invoiceTheme.test.ts` parses `src/index.css` and fails if the two drift.
 */

export const INVOICE_THEMES = ['light', 'dark'] as const;
export type InvoiceTheme = (typeof INVOICE_THEMES)[number];

/** The app ships dark (`<html class="dark">` in index.html, see src/lib/theme.ts), so the preview is dark by default. */
export const DEFAULT_INVOICE_THEME: InvoiceTheme = 'dark';

/** The CSS tokens the preview uses, as HSL triplets exactly as written in src/index.css. */
export const INVOICE_CSS_TOKENS = {
  light: {
    card: '0 0% 100%',
    foreground: '0 0% 5%',
    'muted-foreground': '0 0% 45%',
    border: '0 0% 90%',
    primary: '160 84% 39%',
  },
  dark: {
    card: '0 0% 6%',
    foreground: '0 0% 95%',
    'muted-foreground': '0 0% 55%',
    border: '0 0% 16%',
    primary: '160 84% 39%',
  },
} as const satisfies Record<InvoiceTheme, Record<string, string>>;

export interface InvoicePalette {
  /** Page/card background (`bg-card`). */
  background: string;
  /** Primary text (`text-foreground`). */
  text: string;
  /** Labels, addresses, notes (`text-muted-foreground`). */
  muted: string;
  /** Header and total dividers (`border-border`). */
  border: string;
  /** Line-item dividers (`border-border/50`), pre-blended over the background. */
  borderSubtle: string;
  /** The total amount (`text-primary`). */
  accent: string;
}

type Rgb = [number, number, number];

/** Converts a CSS HSL triplet such as `160 84% 39%` to 8-bit sRGB, like the browser does. */
export function hslTripletToRgb(triplet: string): Rgb {
  const [h, s, l] = triplet.trim().split(/\s+/).map((part) => parseFloat(part));
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function blend(top: Rgb, bottom: Rgb, alpha: number): Rgb {
  return top.map((v, i) => Math.round(v * alpha + bottom[i] * (1 - alpha))) as Rgb;
}

function buildPalette(theme: InvoiceTheme): InvoicePalette {
  const t = INVOICE_CSS_TOKENS[theme];
  const card = hslTripletToRgb(t.card);
  const border = hslTripletToRgb(t.border);
  return {
    background: toHex(card),
    text: toHex(hslTripletToRgb(t.foreground)),
    muted: toHex(hslTripletToRgb(t['muted-foreground'])),
    border: toHex(border),
    borderSubtle: toHex(blend(border, card, 0.5)),
    accent: toHex(hslTripletToRgb(t.primary)),
  };
}

export const INVOICE_PALETTES: Record<InvoiceTheme, InvoicePalette> = {
  light: buildPalette('light'),
  dark: buildPalette('dark'),
};

export function isInvoiceTheme(value: unknown): value is InvoiceTheme {
  return typeof value === 'string' && (INVOICE_THEMES as readonly string[]).includes(value);
}

/**
 * The theme the on-screen preview is showing right now. The preview's colours
 * come from the closest `.dark` ancestor, so look there (the preview element
 * itself if mounted, else the body). Outside a browser (the API Worker) this
 * returns the preview's default look.
 */
export function resolveDocumentInvoiceTheme(): InvoiceTheme {
  // Typed structurally: this module is also compiled for the Worker (no DOM lib).
  type El = { closest(selector: string): unknown };
  const doc = (globalThis as { document?: { body: El | null; querySelector(selector: string): El | null } }).document;
  if (!doc?.body) return DEFAULT_INVOICE_THEME;
  const anchor = doc.querySelector('.invoice-preview') ?? doc.body;
  return anchor.closest('.dark') ? 'dark' : 'light';
}
