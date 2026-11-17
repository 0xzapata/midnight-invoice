/**
 * Placeholders in invoice templates ({{month_name}}, {{year}}, …), shared by
 * the browser app and the API Worker. One pure function resolves them, always
 * against an explicit date (the invoice's issue date), so the same template
 * gives the same text in the app, through the API and in a later "recurring
 * invoices" feature.
 *
 * Safety: a strict whitelist of names, replaced by plain string lookups. No
 * code, expressions, filters or nested lookups are ever evaluated; anything
 * that is not exactly a known `{{name}}` is left in the text as typed.
 * Unknown names are left visible and reported, and so are known names whose
 * value is not available (e.g. {{client_name}} on an invoice without a
 * client), so the person or agent can fix the text.
 */

export const TEMPLATE_PLACEHOLDERS = [
  { name: 'month', description: 'Month of the issue date, two digits', example: '03' },
  { name: 'month_name', description: 'Month of the issue date', example: 'March' },
  { name: 'prev_month_name', description: 'Month before the issue date', example: 'February' },
  { name: 'prev_month_year', description: 'Year of the month before the issue date', example: '2026' },
  { name: 'year', description: 'Year of the issue date', example: '2026' },
  { name: 'quarter', description: 'Quarter of the issue date', example: 'Q1' },
  { name: 'client_name', description: 'Bill To name of the invoice', example: 'Globex Corporation' },
  { name: 'invoice_number', description: 'Number of the invoice', example: 'INV-0042' },
] as const;

export type TemplatePlaceholderName = (typeof TEMPLATE_PLACEHOLDERS)[number]['name'];

const KNOWN = new Set<string>(TEMPLATE_PLACEHOLDERS.map((p) => p.name));

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** What placeholders are resolved against. */
export interface PlaceholderContext {
  /** Issue date of the invoice, YYYY-MM-DD (calendar date; no time zone involved). */
  issueDate: string;
  /** Bill To name; empty/absent leaves {{client_name}} unresolved. */
  clientName?: string | null;
  /** Invoice number; empty/absent leaves {{invoice_number}} unresolved. */
  invoiceNumber?: string | null;
}

export interface PlaceholderResult {
  text: string;
  /** Names in `{{…}}` that are not placeholders (left in the text as typed), in order of first use. */
  unknown: string[];
  /** Known placeholders that had no value (left in the text), in order of first use. */
  unresolved: TemplatePlaceholderName[];
}

/**
 * `{{ name }}`: two braces, optional spaces, a name of letters, digits, `_`,
 * `.` or `-` (so typos such as {{month-name}} are reported as unknown rather
 * than silently ignored), optional spaces, two braces. Anything else is text.
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]{1,64})\s*\}\}/g;

function parseIsoDate(iso: string): { y: number; m: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m };
}

/** Values of every placeholder for `ctx` (undefined = not available). */
export function placeholderValues(ctx: PlaceholderContext): Record<TemplatePlaceholderName, string | undefined> {
  const date = parseIsoDate(ctx.issueDate);
  const prev = date ? (date.m === 1 ? { y: date.y - 1, m: 12 } : { y: date.y, m: date.m - 1 }) : null;
  const clientName = ctx.clientName?.trim();
  const invoiceNumber = ctx.invoiceNumber?.trim();
  return {
    month: date ? String(date.m).padStart(2, '0') : undefined,
    month_name: date ? MONTH_NAMES[date.m - 1] : undefined,
    prev_month_name: prev ? MONTH_NAMES[prev.m - 1] : undefined,
    prev_month_year: prev ? String(prev.y) : undefined,
    year: date ? String(date.y) : undefined,
    quarter: date ? `Q${Math.ceil(date.m / 3)}` : undefined,
    client_name: clientName || undefined,
    invoice_number: invoiceNumber || undefined,
  };
}

/** Resolves the placeholders in `text` (see the module comment). Pure; never throws. */
export function resolvePlaceholders(text: string, ctx: PlaceholderContext): PlaceholderResult {
  const values = placeholderValues(ctx);
  const unknown: string[] = [];
  const unresolved: TemplatePlaceholderName[] = [];
  const out = text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!KNOWN.has(name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    const value = values[name as TemplatePlaceholderName];
    if (value === undefined) {
      if (!unresolved.includes(name as TemplatePlaceholderName)) unresolved.push(name as TemplatePlaceholderName);
      return whole;
    }
    return value;
  });
  return { text: out, unknown, unresolved };
}

/** Placeholder names used in `text` (known or not), in order of first use. */
export function placeholdersIn(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_RE)) if (!names.includes(match[1])) names.push(match[1]);
  return names;
}

/** Collects unknown/unresolved names over several results (deduplicated, in order). */
export function mergePlaceholderReports(results: Pick<PlaceholderResult, 'unknown' | 'unresolved'>[]): Pick<PlaceholderResult, 'unknown' | 'unresolved'> {
  const unknown: string[] = [];
  const unresolved: TemplatePlaceholderName[] = [];
  for (const r of results) {
    for (const n of r.unknown) if (!unknown.includes(n)) unknown.push(n);
    for (const n of r.unresolved) if (!unresolved.includes(n)) unresolved.push(n);
  }
  return { unknown, unresolved };
}
