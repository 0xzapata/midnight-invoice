/**
 * Invoice status: the stored lifecycle (`draft | sent | paid | void`), the
 * transition rules, the derived "overdue" state and the dashboard summary.
 * Pure functions shared by the browser app and the API Worker, so both
 * enforce exactly the same rules.
 *
 * Dates (`issueDate`, `dueDate`, `sentAt`, `paidAt`) are plain calendar dates
 * (`YYYY-MM-DD`), compared as strings. "Today" is supplied by the caller: the
 * browser passes the user's *local* calendar date (`localToday()`), the server
 * the *UTC* date (`utcToday()`). Around midnight the two can differ by a day,
 * so an invoice can be overdue in the app a few hours before (or after) the
 * API reports it.
 */
import { calculateInvoiceTotals, roundMoney } from './invoice-totals';
import type { LineItem } from './types/invoice';

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Status assumed for invoices saved before statuses existed (no `status`
 * field, locally or on the server). `draft` claims nothing: treating old
 * invoices as `sent` would report every historical invoice with a past due
 * date as overdue although most were long paid.
 */
export const DEFAULT_INVOICE_STATUS: InvoiceStatus = 'draft';

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  void: 'Void',
};

/** Status-related fields of an invoice, as stored. */
export interface InvoiceStatusFields {
  status: InvoiceStatus;
  /** Date the invoice was marked sent (`YYYY-MM-DD`); null while a draft. */
  sentAt: string | null;
  /** Date it was paid (`YYYY-MM-DD`); set iff status is `paid`. */
  paidAt: string | null;
}

type MaybeStatus = { status?: unknown; sentAt?: unknown; paidAt?: unknown };

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

/** The stored status, defaulting old/unknown values to `draft`. */
export function statusOf(invoice: MaybeStatus | null | undefined): InvoiceStatus {
  return isInvoiceStatus(invoice?.status) ? invoice.status : DEFAULT_INVOICE_STATUS;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && DATE_RE.test(v) ? v : null);

/**
 * Brings status fields into their invariant shape:
 * - `draft`: no sentAt, no paidAt;
 * - `sent`: sentAt set (default `today`), no paidAt;
 * - `paid`: paidAt set (default `today`), sentAt set (default paidAt);
 * - `void`: no paidAt; sentAt kept if it was sent (so reopening knows).
 */
export function normalizeStatusFields(invoice: MaybeStatus | null | undefined, today: string): InvoiceStatusFields {
  const status = statusOf(invoice);
  const sentAt = dateOrNull(invoice?.sentAt);
  const paidAt = dateOrNull(invoice?.paidAt);
  switch (status) {
    case 'draft':
      return { status, sentAt: null, paidAt: null };
    case 'sent':
      return { status, sentAt: sentAt ?? today, paidAt: null };
    case 'paid': {
      const paid = paidAt ?? today;
      return { status, sentAt: sentAt ?? paid, paidAt: paid };
    }
    case 'void':
      return { status, sentAt, paidAt: null };
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Allowed status changes. Setting the current status again is always allowed
 * (a no-op, or an update of sentAt/paidAt).
 * - draft → sent | void
 * - sent  → paid | void | draft (undo "mark sent")
 * - paid  → sent (undo "mark paid") | void
 * - void  → draft | sent (reopen)
 */
export const STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['sent', 'void'],
  sent: ['paid', 'void', 'draft'],
  paid: ['sent', 'void'],
  void: ['draft', 'sent'],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

/** Convenience actions offered by the UI, REST (`/mark-sent`…) and MCP. */
export const STATUS_ACTIONS = ['mark_sent', 'mark_paid', 'void', 'reopen'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export const STATUS_ACTION_LABELS: Record<StatusAction, string> = {
  mark_sent: 'Mark as sent',
  mark_paid: 'Mark as paid',
  void: 'Void',
  reopen: 'Reopen',
};

/**
 * Target status of an action, or null if it does not apply to `current`.
 * `mark_sent` applies to drafts, `mark_paid` to sent invoices, `void` to
 * anything not void; `reopen` undoes a payment (paid → sent) or a void
 * (→ sent if it had been sent, else draft).
 */
export function actionTarget(action: StatusAction, current: MaybeStatus): InvoiceStatus | null {
  const from = statusOf(current);
  let to: InvoiceStatus | null;
  switch (action) {
    case 'mark_sent':
      // Only drafts: undoing a payment or a void is `reopen`.
      to = from === 'draft' ? 'sent' : null;
      break;
    case 'mark_paid':
      to = 'paid';
      break;
    case 'void':
      to = 'void';
      break;
    case 'reopen':
      to = from === 'paid' ? 'sent' : from === 'void' ? (dateOrNull(current.sentAt) ? 'sent' : 'draft') : null;
      break;
  }
  if (to === null || to === from || !canTransition(from, to)) return null;
  return to;
}

/** Actions that change the status of an invoice in its current state (for menus). */
export function availableActions(current: MaybeStatus): StatusAction[] {
  return STATUS_ACTIONS.filter((a) => actionTarget(a, current) !== null);
}

export type TransitionResult =
  | { ok: true; fields: InvoiceStatusFields; changed: boolean }
  | { ok: false; from: InvoiceStatus; to: InvoiceStatus; allowed: readonly InvoiceStatus[]; message: string };

/**
 * The single transition rule used by the browser store and the server.
 * `paidAt` / `sentAt` override the default (`today`) dates.
 */
export function transitionStatus(
  current: MaybeStatus,
  to: InvoiceStatus,
  opts: { today: string; paidAt?: string | null; sentAt?: string | null },
): TransitionResult {
  const before = normalizeStatusFields(current, opts.today);
  const from = before.status;
  if (!canTransition(from, to)) {
    const allowed = STATUS_TRANSITIONS[from];
    return {
      ok: false,
      from,
      to,
      allowed,
      message: `Cannot change an invoice from ${from} to ${to} (allowed: ${allowed.join(', ')})`,
    };
  }
  let next: InvoiceStatusFields;
  switch (to) {
    case 'draft':
      next = { status: 'draft', sentAt: null, paidAt: null };
      break;
    case 'sent':
      next = { status: 'sent', sentAt: opts.sentAt ?? before.sentAt ?? opts.today, paidAt: null };
      break;
    case 'paid': {
      const paidAt = opts.paidAt ?? before.paidAt ?? opts.today;
      next = { status: 'paid', sentAt: opts.sentAt ?? before.sentAt ?? paidAt, paidAt };
      break;
    }
    case 'void':
      next = { status: 'void', sentAt: before.sentAt, paidAt: null };
      break;
  }
  const changed = next.status !== before.status || next.sentAt !== before.sentAt || next.paidAt !== before.paidAt;
  return { ok: true, fields: next, changed };
}

// ---------------------------------------------------------------------------
// Dates and overdue
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** The user's local calendar date (browser "today"). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The UTC calendar date (server "today"). */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Overdue is derived, never stored: status `sent` and a due date strictly
 * before `today`. Due today is not overdue; no due date is never overdue.
 */
export function isOverdue(invoice: MaybeStatus & { dueDate?: string }, today: string): boolean {
  const due = invoice.dueDate;
  return statusOf(invoice) === 'sent' && typeof due === 'string' && DATE_RE.test(due) && due < today;
}

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(invoice: MaybeStatus & { dueDate?: string }, today: string): number {
  if (!isOverdue(invoice, today)) return 0;
  return dayNumber(today) - dayNumber(invoice.dueDate!);
}

/**
 * Dashboard bucket of an invoice. `outstanding` = sent and not overdue;
 * `overdue` = sent and past due. Void invoices are in no bucket.
 */
export type StatusBucket = 'draft' | 'outstanding' | 'overdue' | 'paid' | 'void';

export function bucketOf(invoice: MaybeStatus & { dueDate?: string }, today: string): StatusBucket {
  const status = statusOf(invoice);
  if (status === 'sent') return isOverdue(invoice, today) ? 'overdue' : 'outstanding';
  return status;
}

// ---------------------------------------------------------------------------
// Summary (dashboard totals strip and GET /invoices/summary)
// ---------------------------------------------------------------------------

export interface SummaryBucket {
  count: number;
  /** Sum of invoice totals in this currency, rounded to 2 decimals. */
  total: number;
}

export interface CurrencySummary {
  currency: string;
  draft: SummaryBucket;
  outstanding: SummaryBucket;
  overdue: SummaryBucket;
  paidThisMonth: SummaryBucket;
  paidThisYear: SummaryBucket;
}

export interface OverdueItem {
  id: string;
  invoiceNumber: string;
  invoiceName?: string;
  toName: string;
  currency: string;
  total: number;
  dueDate: string;
  daysOverdue: number;
}

export interface InvoiceSummary {
  /** The "today" the summary was computed for (YYYY-MM-DD). */
  asOf: string;
  /** One entry per currency in use by non-void invoices; amounts are never summed across currencies. */
  currencies: CurrencySummary[];
  /** The oldest overdue invoices (earliest due date first). */
  oldestOverdue: OverdueItem[];
}

export interface SummarizableInvoice extends MaybeStatus {
  id: string;
  invoiceNumber: string;
  invoiceName?: string;
  toName: string;
  currency: string;
  dueDate?: string;
  lineItems: Pick<LineItem, 'quantity' | 'price'>[];
  taxRate: number;
}

const emptyBucket = (): SummaryBucket => ({ count: 0, total: 0 });

/**
 * Counts and totals per currency. "Paid this month/year" use `paidAt` and
 * the calendar month/year of `today`.
 */
export function summarizeInvoices(
  invoices: readonly SummarizableInvoice[],
  today: string,
  opts: { oldestOverdueLimit?: number } = {},
): InvoiceSummary {
  const byCurrency = new Map<string, CurrencySummary & { invoices: number }>();
  const overdue: OverdueItem[] = [];
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const add = (bucket: SummaryBucket, total: number) => {
    bucket.count += 1;
    bucket.total += total;
  };

  for (const invoice of invoices) {
    const bucket = bucketOf(invoice, today);
    if (bucket === 'void') continue;
    const currency = invoice.currency || 'USD';
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = {
        currency,
        draft: emptyBucket(),
        outstanding: emptyBucket(),
        overdue: emptyBucket(),
        paidThisMonth: emptyBucket(),
        paidThisYear: emptyBucket(),
        invoices: 0,
      };
      byCurrency.set(currency, entry);
    }
    entry.invoices += 1;
    const { total } = calculateInvoiceTotals(invoice);
    if (bucket === 'paid') {
      const paidAt = dateOrNull(invoice.paidAt) ?? '';
      if (paidAt.startsWith(year)) add(entry.paidThisYear, total);
      if (paidAt.startsWith(month)) add(entry.paidThisMonth, total);
    } else {
      add(entry[bucket], total);
    }
    if (bucket === 'overdue') {
      overdue.push({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ...(invoice.invoiceName ? { invoiceName: invoice.invoiceName } : {}),
        toName: invoice.toName,
        currency,
        total,
        dueDate: invoice.dueDate!,
        daysOverdue: daysOverdue(invoice, today),
      });
    }
  }

  const currencies = [...byCurrency.values()]
    .sort((a, b) => b.invoices - a.invoices || a.currency.localeCompare(b.currency))
    .map(({ invoices: _n, ...entry }) => {
      for (const key of ['draft', 'outstanding', 'overdue', 'paidThisMonth', 'paidThisYear'] as const) {
        entry[key].total = roundMoney(entry[key].total);
      }
      return entry;
    });
  overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  return { asOf: today, currencies, oldestOverdue: overdue.slice(0, opts.oldestOverdueLimit ?? 5) };
}
