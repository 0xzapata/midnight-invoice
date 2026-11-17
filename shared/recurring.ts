/**
 * Recurring invoices: the schedule model and its calendar math, shared by the
 * API Worker (which generates the invoices) and the browser app (which shows
 * the plain-language summary and the upcoming dates). Pure functions only.
 *
 * Calendar rules (documented in AGENT_API.md "Recurring invoices"):
 *
 * - A schedule's `startDate` is its anchor. Weekly and two-weekly schedules
 *   run on the anchor's weekday; monthly, quarterly (every 3 months) and
 *   yearly schedules on the anchor's day of the month (and month, for yearly).
 * - Month-end rule: when the anchor day does not exist in a month, the run is
 *   on that month's last day (the 31st → 30 April, 28/29 February), and the
 *   following months go back to the anchor day (31 May). Every run date is
 *   computed from the anchor, never from the previous run, so it never drifts.
 *   A yearly schedule anchored on 29 February runs on 28 February in other
 *   years.
 * - Run dates are calendar dates in the schedule's IANA time zone. A period
 *   is due once that date has begun there; time-of-day and DST never matter:
 *   a 23- or 25-hour day still has exactly one run date, and the server's
 *   hourly job generates it in the first run after local midnight.
 */
import type { Actor } from './types/invoice';

export const RECURRING_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_STATUSES = ['active', 'paused', 'ended'] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

/**
 * What happens to each generated invoice: stays a `draft` (default), is
 * marked `sent` (dated on the run date), or is emailed (`send_email`, only
 * when the server has email sending, and only the user can choose it).
 */
export const RECURRING_AUTO_ACTIONS = ['draft', 'mark_sent', 'send_email'] as const;
export type RecurringAutoAction = (typeof RECURRING_AUTO_ACTIONS)[number];

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

export const AUTO_ACTION_LABELS: Record<RecurringAutoAction, string> = {
  draft: 'Create a draft for you to review',
  mark_sent: 'Create it and mark it as sent',
  send_email: 'Create it and email it to the client',
};

export const RECURRING_LIMITS = {
  name: 200,
  notes: 5000,
  maxOccurrences: 1000,
  /** Upcoming dates a preview can list. */
  previewMax: 24,
  timezone: 64,
} as const;

/** What a person (or agent) configures. */
export interface RecurringScheduleConfig {
  name: string;
  /** The template every invoice is generated from (required). */
  templateId: string;
  /** Saved client to bill instead of the template's default client (null: the template's). */
  clientId: string | null;
  frequency: RecurringFrequency;
  /** First run date and anchor (YYYY-MM-DD, in `timezone`). */
  startDate: string;
  /** IANA time zone the run dates are counted in, e.g. "Europe/Berlin". */
  timezone: string;
  /** Last possible run date, inclusive (null: no end date). */
  endDate: string | null;
  /** Stop after this many generated invoices (null: no limit). */
  maxOccurrences: number | null;
  autoAction: RecurringAutoAction;
  /** Values that win over the template (null: use the template's). */
  overrides: RecurringOverrides;
}

export interface RecurringOverrides {
  /** Printed notes; may contain placeholders. */
  notes: string | null;
  /** Percent. */
  taxRate: number | null;
}

/** Why the last attempt failed (cleared by the next success or by editing the schedule). */
export interface RecurringError {
  /** Stable code: template_deleted, template_not_found, client_deleted, validation_failed, workspace_suspended, maintenance, email_unavailable, internal_error. */
  code: string;
  message: string;
  at: string;
  /** Period (run date) that failed. */
  period: string | null;
  /** Consecutive failed attempts. */
  attempts: number;
}

export interface RecurringSchedule extends RecurringScheduleConfig {
  id: string;
  status: RecurringStatus;
  /** Next run date (YYYY-MM-DD in `timezone`); null once ended. */
  nextRunDate: string | null;
  lastRunDate: string | null;
  lastInvoiceId: string | null;
  /** Invoices generated so far. */
  runCount: number;
  lastError: RecurringError | null;
  /** Earliest retry after a failure (ISO timestamp). */
  retryAt: string | null;
  /** Periods skipped by the catch-up policy (after downtime or a pause). */
  skippedCount: number;
  lastSkipped: { from: string; to: string; count: number } | null;
  /** Plain-language cadence, e.g. "Every month on the 1st, starting 1 Dec 2026". */
  summary: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Incremented on every configuration change (also the ETag); generation does not change it. */
  revision: number;
  createdBy: Actor;
  updatedBy: Actor;
}

// ---------------------------------------------------------------------------
// Calendar math (YYYY-MM-DD strings, proleptic Gregorian, no time zones)
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parse(iso: string): Ymd {
  const match = ISO_RE.exec(iso);
  if (!match) throw new Error(`Invalid date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const fmt = ({ y, m, d }: Ymd) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Days in month `m` (1-12) of year `y`. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValidIsoDate(iso: string): boolean {
  const match = ISO_RE.exec(iso);
  if (!match) return false;
  const { y, m, d } = parse(iso);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const toUtcMs = (iso: string) => {
  const { y, m, d } = parse(iso);
  return Date.UTC(y, m - 1, d);
};

export function addDays(iso: string, days: number): string {
  const date = new Date(toUtcMs(iso) + days * 86_400_000);
  return fmt({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** Month offset from the anchor, with the month-end rule (day clamped to the month's last day). */
function addMonthsClamped(anchor: Ymd, months: number): string {
  const index = anchor.y * 12 + (anchor.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return fmt({ y, m, d: Math.min(anchor.d, daysInMonth(y, m)) });
}

const STEP: Record<RecurringFrequency, { days?: number; months?: number }> = {
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
};

/** The k-th run date (k = 0 is the start date). */
export function occurrence(startDate: string, frequency: RecurringFrequency, k: number): string {
  const step = STEP[frequency];
  if (step.days) return addDays(startDate, k * step.days);
  return addMonthsClamped(parse(startDate), k * step.months!);
}

/** The first run date on or after `date` (the start date if `date` is earlier). */
export function occurrenceOnOrAfter(startDate: string, frequency: RecurringFrequency, date: string): string {
  if (date <= startDate) return startDate;
  const step = STEP[frequency];
  if (step.days) return occurrence(startDate, frequency, Math.ceil(daysBetween(startDate, date) / step.days));
  const a = parse(startDate);
  const b = parse(date);
  const monthsApart = (b.y - a.y) * 12 + (b.m - a.m);
  let k = Math.max(0, Math.floor(monthsApart / step.months!) - 1);
  while (occurrence(startDate, frequency, k) < date) k++;
  return occurrence(startDate, frequency, k);
}

/** The first run date strictly after `date`. */
export function occurrenceAfter(startDate: string, frequency: RecurringFrequency, date: string): string {
  return occurrenceOnOrAfter(startDate, frequency, addDays(date, 1));
}

/** The last run date on or before `date`, or null if the schedule starts later. */
export function occurrenceOnOrBefore(startDate: string, frequency: RecurringFrequency, date: string): string | null {
  if (date < startDate) return null;
  const next = occurrenceOnOrAfter(startDate, frequency, date);
  if (next === date) return date;
  const step = STEP[frequency];
  if (step.days) return addDays(next, -step.days);
  // Step back from the anchor index of `next`.
  const a = parse(startDate);
  const n = parse(next);
  const k = ((n.y - a.y) * 12 + (n.m - a.m)) / step.months!;
  return occurrence(startDate, frequency, k - 1);
}

type Cadence = Pick<RecurringScheduleConfig, 'frequency' | 'startDate' | 'endDate' | 'maxOccurrences'>;

/**
 * Next run date of a schedule: the first run date on or after `onOrAfter`
 * (and after `lastRunDate`), or null when the end date or the occurrence
 * limit has been reached.
 */
export function nextRunDate(cfg: Cadence, state: { onOrAfter: string; lastRunDate?: string | null; runCount?: number }): string | null {
  if (cfg.maxOccurrences != null && (state.runCount ?? 0) >= cfg.maxOccurrences) return null;
  let from = state.onOrAfter;
  if (state.lastRunDate && addDays(state.lastRunDate, 1) > from) from = addDays(state.lastRunDate, 1);
  const next = occurrenceOnOrAfter(cfg.startDate, cfg.frequency, from);
  if (cfg.endDate && next > cfg.endDate) return null;
  return next;
}

/** Up to `count` run dates from `from` on (inclusive), respecting the end conditions. */
export function upcomingRunDates(cfg: Cadence, from: string | null, count: number, runCount = 0): string[] {
  const out: string[] = [];
  if (!from) return out;
  let date: string | null = occurrenceOnOrAfter(cfg.startDate, cfg.frequency, from);
  let n = runCount;
  while (date && out.length < count) {
    if (cfg.endDate && date > cfg.endDate) break;
    if (cfg.maxOccurrences != null && n >= cfg.maxOccurrences) break;
    out.push(date);
    n++;
    date = occurrenceAfter(cfg.startDate, cfg.frequency, date);
  }
  return out;
}

/**
 * Catch-up plan for a schedule whose next run date is `nextRun` on local date
 * `today`: the single most recent due period is generated, older missed ones
 * are skipped (counted, and listed up to `listMax`). Null when nothing is due.
 */
export function catchUpPlan(
  cfg: Cadence,
  nextRun: string,
  today: string,
  listMax = 50,
): { period: string; skipped: string[]; skippedCount: number } | null {
  if (nextRun > today) return null;
  const latest = occurrenceOnOrBefore(cfg.startDate, cfg.frequency, cfg.endDate && cfg.endDate < today ? cfg.endDate : today);
  if (!latest || latest < nextRun) return null;
  const skipped: string[] = [];
  let skippedCount = 0;
  for (let d = occurrenceOnOrAfter(cfg.startDate, cfg.frequency, nextRun); d < latest; d = occurrenceAfter(cfg.startDate, cfg.frequency, d)) {
    skippedCount++;
    if (skipped.length < listMax) skipped.push(d);
    if (skippedCount > 100_000) break;
  }
  return { period: latest, skipped, skippedCount };
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > RECURRING_LIMITS.timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date (YYYY-MM-DD) of `instant` in the IANA time zone `tz`. */
export function localDateIn(instant: Date | number, tz: string): string {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(typeof instant === 'number' ? new Date(instant) : instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ---------------------------------------------------------------------------
// Plain language
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "1 Dec 2026" (`long`: "1 December 2026"). */
export function formatRunDate(iso: string, long = false): string {
  const { y, m, d } = parse(iso);
  const month = MONTHS[m - 1];
  return `${d} ${long ? month : month.slice(0, 3)} ${y}`;
}

export function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(toUtcMs(iso)).getUTCDay()];
}

/** "on the 1st" / "on the 31st (the last day in shorter months)" / "on Monday" … */
export function cadencePhrase(frequency: RecurringFrequency, startDate: string): string {
  const { m, d } = parse(startDate);
  if (frequency === 'weekly' || frequency === 'biweekly') return `on ${weekdayOf(startDate)}`;
  if (frequency === 'yearly') {
    if (m === 2 && d === 29) return 'on 29 February (28 February in other years)';
    return `on ${d} ${MONTHS[m - 1]}`;
  }
  const monthEnd = d >= 29 ? ` (the last day in shorter months)` : '';
  if (frequency === 'quarterly') {
    const months = [0, 3, 6, 9]
      .map((o) => (m - 1 + o) % 12)
      .sort((a, b) => a - b)
      .map((i) => MONTHS[i].slice(0, 3));
    return `on the ${ordinal(d)}${monthEnd} (${months.join(', ')})`;
  }
  return `on the ${ordinal(d)}${monthEnd}`;
}

/**
 * "Every month on the 1st, starting 1 Dec 2026, until 30 Nov 2027". With
 * `nextRunDate`, adds " — next: 1 Jan 2027" (or " — ended").
 */
export function describeSchedule(
  cfg: Pick<RecurringScheduleConfig, 'frequency' | 'startDate' | 'endDate' | 'maxOccurrences'>,
  opts: { nextRunDate?: string | null; status?: RecurringStatus } = {},
): string {
  let text = `${FREQUENCY_LABELS[cfg.frequency]} ${cadencePhrase(cfg.frequency, cfg.startDate)}, starting ${formatRunDate(cfg.startDate)}`;
  if (cfg.endDate) text += `, until ${formatRunDate(cfg.endDate)}`;
  if (cfg.maxOccurrences != null) text += `, ${cfg.maxOccurrences === 1 ? 'once' : `${cfg.maxOccurrences} times`}`;
  if (opts.status === 'ended') text += ' — ended';
  else if (opts.nextRunDate) text += ` — next: ${formatRunDate(opts.nextRunDate)}`;
  else if (opts.nextRunDate === null) text += ' — no more runs';
  return text;
}
