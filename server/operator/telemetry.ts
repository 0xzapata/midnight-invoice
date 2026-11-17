/**
 * Request telemetry: an in-memory, per-isolate aggregator that the request
 * hook feeds (one `record` per request: a few Map operations) and that flushes
 * to D1 rollup tables in the background (`ctx.waitUntil`). The first request
 * after a flush schedules the next one after `flushDelayMs`, so a busy isolate
 * writes one D1 batch per window instead of one per request. Failures are
 * logged and dropped: telemetry never fails or slows a user request.
 *
 * Stored: minute + hour buckets per metric ("<service>|<route template>"),
 * counts by status class, duration sum and a 10-bucket histogram; a capped
 * table of recent error responses (route template, status, error code, cf-ray).
 * Never stored: ids in paths, query strings, bodies, tokens, IPs.
 *
 * Note: inside a deployed Worker, Date.now() only advances across I/O, so
 * durations measure time spent waiting on D1/subrequests/streams, not CPU.
 */
import type { OperatorDb, RollupDelta, RollupRow } from './db';

export const DURATION_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, Infinity] as const;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const MAX_ERRORS_PER_FLUSH = 50;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * MINUTE;

export interface RequestSample {
  metric: string;
  status: number;
  durationMs: number;
  at: number;
  errorCode?: string | null;
  ray?: string | null;
  workspaceId?: string | null;
}

export interface TelemetryCollector {
  record(sample: RequestSample): void;
  /** Returns the background flush to hand to waitUntil, or null if one is already scheduled. */
  scheduleFlush(): Promise<void> | null;
  flush(): Promise<void>;
}

export function bucketIndex(durationMs: number): number {
  return DURATION_BOUNDS_MS.findIndex((b) => durationMs < b);
}

export function createTelemetryCollector(odb: OperatorDb, opts: { flushDelayMs?: number; logError?: (m: string, e: unknown) => void } = {}): TelemetryCollector {
  const delay = opts.flushDelayMs ?? 2_000;
  let rollups = new Map<string, RollupDelta>();
  let errorsBuf: { at: number; metric: string; status: number; code: string | null; ray: string | null }[] = [];
  let activity = new Map<string, number>();
  const activityWritten = new Map<string, number>();
  let scheduled: Promise<void> | null = null;

  function add(granularity: 'm' | 'h', bucket: number, s: RequestSample) {
    const key = `${granularity}|${bucket}|${s.metric}`;
    let d = rollups.get(key);
    if (!d) {
      d = { granularity, bucket, metric: s.metric, count: 0, errors: 0, clientErrors: 0, authFailures: 0, rateLimited: 0, maintenance: 0, durSum: 0, hist: new Array(10).fill(0) };
      rollups.set(key, d);
    }
    d.count++;
    // A deliberate maintenance-mode 503 is neither a server nor a client error.
    if (s.errorCode === 'maintenance') d.maintenance++;
    else if (s.status >= 500) d.errors++;
    else if (s.status >= 400) d.clientErrors++;
    if (s.status === 401 || s.status === 403) d.authFailures++;
    if (s.status === 429) d.rateLimited++;
    d.durSum += Math.max(0, s.durationMs);
    d.hist[bucketIndex(Math.max(0, s.durationMs))]++;
  }

  const collector: TelemetryCollector = {
    record(s) {
      add('m', Math.floor(s.at / MINUTE) * MINUTE, s);
      add('h', Math.floor(s.at / HOUR) * HOUR, s);
      if (s.status >= 400 && errorsBuf.length < MAX_ERRORS_PER_FLUSH) {
        errorsBuf.push({ at: s.at, metric: s.metric, status: s.status, code: s.errorCode ?? null, ray: s.ray ?? null });
      }
      if (s.workspaceId && s.at - (activityWritten.get(s.workspaceId) ?? 0) >= ACTIVITY_WRITE_INTERVAL_MS) {
        activity.set(s.workspaceId, s.at);
      }
    },

    scheduleFlush() {
      if (scheduled) return null;
      scheduled = (async () => {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        scheduled = null;
        await collector.flush();
      })();
      return scheduled;
    },

    async flush() {
      const deltas = [...rollups.values()];
      const errs = errorsBuf;
      const act = [...activity.entries()].map(([workspaceId, at]) => ({ workspaceId, at }));
      rollups = new Map();
      errorsBuf = [];
      activity = new Map();
      if (deltas.length === 0 && errs.length === 0 && act.length === 0) return;
      try {
        const stmts = [...deltas.map((d) => odb.rollupStatement(d)), ...errs.map((e) => odb.errorStatement(e))];
        if (stmts.length) await odb.raw.batch(stmts);
        for (const a of act) activityWritten.set(a.workspaceId, a.at);
        if (activityWritten.size > 10_000) activityWritten.clear();
        await odb.touchWorkspaceActivity(act);
      } catch (error) {
        opts.logError?.('Telemetry flush failed (dropped)', error);
      }
    },
  };
  return collector;
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export interface MetricSummary {
  metric: string;
  service: string;
  group: string;
  name: string;
  count: number;
  errors: number;
  clientErrors: number;
  authFailures: number;
  rateLimited: number;
  maintenance: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface SeriesPoint {
  t: number;
  count: number;
  errors: number;
  p95Ms: number | null;
}

const histOf = (r: RollupRow) => [r.h0, r.h1, r.h2, r.h3, r.h4, r.h5, r.h6, r.h7, r.h8, r.h9];

/** Percentile from the fixed-bound histogram (linear within a bucket; the open bucket reports its lower bound). */
export function percentile(hist: number[], q: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i] === 0) continue;
    if (cum + hist[i] >= target) {
      const lo = i === 0 ? 0 : DURATION_BOUNDS_MS[i - 1];
      const hi = DURATION_BOUNDS_MS[i];
      if (!Number.isFinite(hi)) return lo;
      return Math.round(lo + ((target - cum) / hist[i]) * (hi - lo));
    }
    cum += hist[i];
  }
  return DURATION_BOUNDS_MS[DURATION_BOUNDS_MS.length - 2];
}

/** MCP tools counted in the Email group (sends and failures next to the REST send endpoint). */
const EMAIL_MCP_TOOLS = new Set(['tool send_invoice_email']);

/** Route-group ("part of the site") for a metric. */
export function groupOf(metric: string): { service: string; group: string; name: string } {
  const [service, name = ''] = metric.split('|');
  if (service === 'mcp') return { service, group: EMAIL_MCP_TOOLS.has(name) ? 'Email' : 'MCP endpoint', name };
  if (service === 'operator') return { service, group: 'Operator console', name };
  const path = name.replace(/^[A-Z]+ /, '');
  let group = 'REST: other';
  if (name.endsWith('(sync)')) group = 'Sync';
  else if (/^\/invoices\/:id\/(send|emails)$/.test(path)) group = 'Email';
  else if (path.startsWith('/invoices/:id/pdf')) group = 'PDF rendering';
  else if (path === '/invoices/summary' || /^\/invoices\/:id\/(mark-sent|mark-paid|void|reopen)$/.test(path)) group = 'Invoice status';
  else if (path.startsWith('/clients')) group = 'Clients';
  else if (path.startsWith('/templates')) group = 'Templates';
  else if (path === '/activity' || /^\/agents\/[^/]+\/activity$/.test(path)) group = 'Activity log';
  else if (path.startsWith('/agents/register') || path.startsWith('/agents/token') || path.startsWith('/agents/registrations')) group = 'Agent registration';
  else if (path.startsWith('/agents')) group = 'Agents';
  else if (path.startsWith('/invoices')) group = 'Invoices';
  else if (path.startsWith('/workspace')) group = 'Workspaces';
  else if (path.startsWith('/settings')) group = 'Settings';
  else if (path === '/health' || path === '/openapi.json') group = 'Meta';
  else if (path.startsWith('/api/oauth/') || path.startsWith('/oauth/')) group = 'OAuth';
  return { service, group, name };
}

export function summarize(rows: RollupRow[]): { metrics: MetricSummary[]; total: Omit<MetricSummary, 'metric' | 'service' | 'group' | 'name'> } {
  const by = new Map<string, { rows: RollupRow[] }>();
  for (const r of rows) {
    const e = by.get(r.metric) ?? { rows: [] };
    e.rows.push(r);
    by.set(r.metric, e);
  }
  const agg = (rs: RollupRow[]) => {
    const hist = new Array(10).fill(0);
    let count = 0, errors = 0, clientErrors = 0, authFailures = 0, rateLimited = 0, maintenance = 0, dur = 0;
    for (const r of rs) {
      count += r.count;
      errors += r.errors;
      clientErrors += r.client_errors;
      authFailures += r.auth_failures;
      rateLimited += r.rate_limited;
      maintenance += r.maintenance ?? 0;
      dur += r.dur_sum;
      histOf(r).forEach((v, i) => (hist[i] += v));
    }
    return {
      count,
      errors,
      clientErrors,
      authFailures,
      rateLimited,
      maintenance,
      errorRate: count ? errors / count : 0,
      avgMs: count ? Math.round(dur / count) : 0,
      p50Ms: percentile(hist, 0.5),
      p95Ms: percentile(hist, 0.95),
    };
  };
  const metrics = [...by.entries()]
    .map(([metric, e]) => ({ metric, ...groupOf(metric), ...agg(e.rows) }))
    .sort((a, b) => b.count - a.count);
  return { metrics, total: agg(rows) };
}

export function series(rows: RollupRow[], from: number, to: number, step: number, filter?: (metric: string) => boolean): SeriesPoint[] {
  const points = new Map<number, { count: number; errors: number; hist: number[] }>();
  for (let t = Math.floor(from / step) * step; t <= to; t += step) points.set(t, { count: 0, errors: 0, hist: new Array(10).fill(0) });
  for (const r of rows) {
    if (filter && !filter(r.metric)) continue;
    const t = Math.floor(r.bucket / step) * step;
    const p = points.get(t);
    if (!p) continue;
    p.count += r.count;
    p.errors += r.errors;
    histOf(r).forEach((v, i) => (p.hist[i] += v));
  }
  return [...points.entries()].map(([t, p]) => ({ t, count: p.count, errors: p.errors, p95Ms: percentile(p.hist, 0.95) }));
}
