/**
 * The invoice email: subject, plain-text and HTML parts, built from an
 * invoice plus the sender's optional custom subject/message. Shared by the
 * Worker (what is sent) and the browser (the preview in the send dialog), so
 * both always agree. Plain text only goes in: the HTML part is generated here
 * and every user-supplied string in it is HTML-escaped.
 *
 * Also holds the address and header checks used by the send endpoint.
 */
import { calculateInvoiceTotals } from './invoice-totals';

export const EMAIL_LIMITS = {
  subject: 200,
  message: 2000,
  /** Extra recipients per send (workspace token only). */
  cc: 3,
  address: 254,
  /** Length of the sender name shown in the From display name (security fix M2: was 100). */
  displayName: 60,
  idempotencyKey: 255,
} as const;

/** Product name shown in the From display name ("Acme via Midnight Invoice") and the footer. */
export const EMAIL_BRAND = 'Midnight Invoice';

export interface EmailInvoiceFields {
  invoiceNumber: string;
  invoiceName?: string;
  dueDate?: string;
  fromName: string;
  fromEmail: string;
  toName: string;
  currency: string;
  taxRate: number;
  lineItems: { quantity: number; price: number }[];
}

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** CR, LF, NUL and the other C0/C1 controls: never allowed in a header value. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HEADER_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Controls other than tab and newline: never allowed in the plain-text message. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const BODY_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export function hasHeaderUnsafeChars(value: string): boolean {
  return HEADER_UNSAFE.test(value);
}

export function hasBodyUnsafeChars(value: string): boolean {
  return BODY_UNSAFE.test(value);
}

/** Domains that can never receive mail (RFC 2606 / RFC 6761 reserved names). */
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'localhost']);
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost', 'local', 'internal']);

/**
 * A deliberately strict, boring address check: one @, a dot-atom local part,
 * a hostname with a real-looking TLD, no IP literals, no quoted strings, no
 * display names. Reserved domains (example.com, *.test…) are refused so
 * obviously undeliverable sends never reach the provider.
 */
export function isDeliverableEmail(value: string): boolean {
  if (typeof value !== 'string' || value.length > EMAIL_LIMITS.address || hasHeaderUnsafeChars(value)) return false;
  const match = /^([A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*)@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})$/.exec(value);
  if (!match || match[1].length > 64) return false;
  const domain = match[2].toLowerCase();
  if (RESERVED_DOMAINS.has(domain)) return false;
  const labels = domain.split('.');
  if (RESERVED_TLDS.has(labels[labels.length - 1])) return false;
  if ([...RESERVED_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return false;
  return true;
}

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/**
 * For the activity log: keeps the domain (useful: which client) and the first
 * character of the mailbox, hides the rest: `billing@acme.io` → `b•••@acme.io`.
 */
export function maskEmail(value: string): string {
  const v = value.trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${v[0]}•••${v.slice(at)}`.slice(0, 120);
}

/**
 * RFC 5322 display name + address. The name is quoted with `"` and `\`
 * escaped; header-unsafe characters must be rejected before calling this.
 */
export function formatMailbox(name: string, address: string): string {
  const clean = name.trim();
  if (!clean) return address;
  return `"${clean.replace(/["\\]/g, (c) => `\\${c}`)}" <${address}>`;
}

/**
 * Characters that make a display name deceptive in a mail client: controls,
 * bidi overrides/isolates and zero-width characters (reorder or hide text),
 * quotes and angle brackets (fake a second mailbox), "@" (makes a name look
 * like an address, e.g. "support@bank.com via …"), backslashes and the
 * Unicode line/paragraph separators.
 */
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- matching control and invisible characters is the point
const DECEPTIVE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0"'`<>@\\]/g;

/** The sender name as it may appear in the From display name: deceptive characters removed, whitespace collapsed, length capped. */
export function cleanDisplayName(fromName: string): string {
  return Array.from(fromName.replace(DECEPTIVE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, EMAIL_LIMITS.displayName)
    .join('')
    .trim();
}

/** "Acme Studio via Midnight Invoice": the sender's name (cleaned, see cleanDisplayName), attributed to this service. */
export function senderDisplayName(fromName: string, serviceName: string = EMAIL_BRAND): string {
  const name = cleanDisplayName(fromName);
  const service = serviceName.trim() || EMAIL_BRAND;
  return name ? `${name} via ${service}` : service;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** YYYY-MM-DD → "Dec 1, 2026" (UTC, so server and browser agree). */
export function formatEmailDate(date: string | undefined | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function defaultEmailSubject(invoice: Pick<EmailInvoiceFields, 'invoiceNumber' | 'fromName'>): string {
  const from = invoice.fromName.trim().replace(HEADER_UNSAFE, ' ');
  const subject = `Invoice ${invoice.invoiceNumber}${from ? ` from ${from}` : ''}`;
  return subject.slice(0, EMAIL_LIMITS.subject);
}

export function defaultEmailMessage(invoice: EmailInvoiceFields): string {
  const { total } = calculateInvoiceTotals(invoice);
  const due = formatEmailDate(invoice.dueDate);
  const greeting = invoice.toName.trim() ? `Hi ${invoice.toName.trim()},` : 'Hello,';
  return [
    greeting,
    '',
    `Please find attached invoice ${invoice.invoiceNumber} for ${formatMoney(total, invoice.currency)}${due ? `, due ${due}` : ''}.`,
    '',
    'Thank you for your business.',
  ].join('\n');
}

/** The facts that are always included, whatever the custom message says. */
function summaryRows(invoice: EmailInvoiceFields): [string, string][] {
  const { total } = calculateInvoiceTotals(invoice);
  const rows: [string, string][] = [['Invoice', invoice.invoiceNumber]];
  if (invoice.invoiceName?.trim()) rows.push(['For', invoice.invoiceName.trim()]);
  rows.push(['Amount due', formatMoney(total, invoice.currency)]);
  const due = formatEmailDate(invoice.dueDate);
  if (due) rows.push(['Due date', due]);
  return rows;
}

export function composeInvoiceEmail(
  invoice: EmailInvoiceFields,
  options: { subject?: string; message?: string; attachmentName?: string } = {},
): ComposedEmail {
  const subject = options.subject?.trim() || defaultEmailSubject(invoice);
  const message = (options.message?.trim() ? options.message : defaultEmailMessage(invoice)).replace(/\r\n?/g, '\n').trim();
  const sender = invoice.fromName.trim();
  const signature = sender || 'The sender';
  const rows = summaryRows(invoice);
  const replyLine = invoice.fromEmail.trim()
    ? `Questions about this invoice? Reply to this email to reach ${signature}.`
    : null;
  const attachment = options.attachmentName ?? 'the attached PDF';

  const text = [
    message,
    '',
    sender ? `— ${sender}` : null,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `The invoice is attached as a PDF (${attachment}).`,
    '',
    replyLine,
    `Sent with ${EMAIL_BRAND}.`,
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const e = escapeHtml;
  const paragraphs = message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;">${e(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${e(label)}</td>` +
        `<td style="padding:6px 0;text-align:right;font-weight:600;font-size:13px;">${e(value)}</td></tr>`,
    )
    .join('');
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${e(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;font-size:15px;line-height:1.55;">` +
    `<tr><td style="padding:28px 28px 8px 28px;">${paragraphs}${sender ? `<p style="margin:0 0 8px 0;">— ${e(sender)}</p>` : ''}</td></tr>` +
    `<tr><td style="padding:8px 28px 20px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;">${table}</table>` +
    `<p style="margin:12px 0 0 0;font-size:13px;color:#6b7280;">The invoice is attached as a PDF (${e(attachment)}).</p></td></tr>` +
    `<tr><td style="padding:0 28px 24px 28px;font-size:12px;color:#71717a;">${replyLine ? `${e(replyLine)}<br>` : ''}Sent with ${e(EMAIL_BRAND)}.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
