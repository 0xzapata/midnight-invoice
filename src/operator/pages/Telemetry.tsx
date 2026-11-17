import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { operatorApi } from '../api';
import { BarChart, HBars } from '../charts';
import { Badge, Card, Empty, ErrorNote, PageTitle, StatTile, Table, fmtAgo, fmtBytes, fmtMs, fmtNumber, fmtPercent, td, th } from '../ui';

const RANGES = [
  ['1h', 'Last hour'],
  ['24h', '24 hours'],
  ['7d', '7 days'],
] as const;

export function TelemetryPage() {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('24h');
  const q = useQuery({ queryKey: ['operator', 'telemetry', range], queryFn: () => operatorApi.telemetry(range), refetchInterval: 30_000 });
  const label = (t: number) =>
    range === '7d'
      ? new Date(t).toLocaleString('en', { weekday: 'short', hour: '2-digit', hour12: false })
      : new Date(t).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <>
      <PageTitle
        title="Telemetry"
        description="Per part of the service: request counts, errors and latency from D1 rollups written by the Worker. No request bodies, tokens, ids or client IPs are stored."
        actions={
          <div role="group" aria-label="Time range" className="flex border border-border">
            {RANGES.map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => setRange(value)}
                className={cn('px-3 py-1.5 text-xs', range === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {text}
              </button>
            ))}
          </div>
        }
      />
      {q.isPending && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Requests" value={fmtNumber(q.data.totals.requests)} sub={`p50 ${fmtMs(q.data.totals.p50Ms)} · p95 ${fmtMs(q.data.totals.p95Ms)}`} />
            <StatTile
              label="Server errors (5xx)"
              value={fmtNumber(q.data.totals.errors)}
              sub={fmtPercent(q.data.totals.errorRate)}
              tone={q.data.totals.errorRate > 0.05 ? 'bad' : q.data.totals.errorRate > 0.01 ? 'warn' : 'default'}
            />
            <StatTile label="Auth failures (401/403)" value={fmtNumber(q.data.totals.authFailures)} sub={`${fmtNumber(q.data.totals.clientErrors)} client errors in total`} />
            <StatTile label="Rate-limited (429)" value={fmtNumber(q.data.totals.rateLimited)} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Requests" description="All services, including the console itself.">
              <BarChart label="Requests" data={q.data.series.map((p) => ({ key: p.t, label: label(p.t), value: p.count }))} format={(v) => fmtNumber(v)} />
            </Card>
            <Card title="Server errors (5xx)" description="Same buckets as the request chart.">
              <BarChart label="Server errors" tone="destructive" data={q.data.series.map((p) => ({ key: p.t, label: label(p.t), value: p.errors }))} format={(v) => fmtNumber(v)} />
            </Card>
          </div>

          <Card title="Parts of the service" className="mt-4">
            {q.data.groups.length === 0 ? (
              <Empty>No traffic in this range yet.</Empty>
            ) : (
              <Table label="Service groups">
                <thead>
                  <tr>
                    <th className={th}>Part</th>
                    <th className={cn(th, 'text-right')}>Requests</th>
                    <th className={cn(th, 'text-right')}>5xx</th>
                    <th className={cn(th, 'text-right')}>Error rate</th>
                    <th className={cn(th, 'text-right')}>p50</th>
                    <th className={cn(th, 'text-right')}>p95</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.groups.map((g) => (
                    <tr key={g.group}>
                      <td className={td}>{g.group}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(g.requests)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(g.errors)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtPercent(g.errorRate)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(g.p50Ms)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(g.p95Ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Agent registration funnel" description="Device-flow registrations started in this range (from D1).">
              <HBars
                rows={[
                  { label: 'Registered', value: q.data.registrationFunnel.registered },
                  { label: 'Approved', value: q.data.registrationFunnel.approved },
                  { label: 'Key issued', value: q.data.registrationFunnel.redeemed },
                  { label: 'Denied', value: q.data.registrationFunnel.denied, tone: 'muted' },
                  { label: 'Expired', value: q.data.registrationFunnel.expired, tone: 'muted' },
                  { label: 'Still pending', value: q.data.registrationFunnel.pending, tone: 'muted' },
                ]}
              />
            </Card>
            <Card title="D1 database" description="Probe from this Worker isolate.">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right">{q.data.d1.ok ? <Badge tone="good">Healthy</Badge> : <Badge tone="bad">Failing</Badge>}</dd>
                <dt className="text-muted-foreground">Query latency</dt>
                <dd className="text-right tabular-nums">{fmtMs(q.data.d1.latencyMs)}</dd>
                <dt className="text-muted-foreground">Database size</dt>
                <dd className="text-right tabular-nums">{fmtBytes(q.data.d1.sizeBytes)}</dd>
                <dt className="text-muted-foreground">Latest migration</dt>
                <dd className="truncate text-right font-code text-xs" title={q.data.d1.migration ?? ''}>
                  {q.data.d1.migration ?? '—'}
                </dd>
              </dl>
            </Card>
            <Card title="Notes">
              <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
                {q.data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Routes and tools" description="Route templates (ids are never recorded). MCP rows are per tool." className="mt-4">
            <MetricsTable metrics={q.data.metrics} />
          </Card>

          <Card title="Recent error responses" description="Last 50 responses with status 400 or above (capped table)." className="mt-4">
            {q.data.recentErrors.length === 0 ? (
              <Empty>No errors recorded.</Empty>
            ) : (
              <Table label="Recent errors">
                <thead>
                  <tr>
                    <th className={th}>When</th>
                    <th className={th}>Route</th>
                    <th className={th}>Status</th>
                    <th className={th}>Code</th>
                    <th className={th}>cf-ray</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.recentErrors.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(e.at)}</td>
                      <td className={cn(td, 'font-code text-xs')}>{e.metric.replace('|', ' · ')}</td>
                      <td className={td}>
                        <Badge tone={e.status >= 500 ? 'bad' : 'warn'}>{e.status}</Badge>
                      </td>
                      <td className={cn(td, 'font-code text-xs')}>{e.code ?? '—'}</td>
                      <td className={cn(td, 'font-code text-xs text-muted-foreground')}>{e.ray ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function MetricsTable({ metrics }: { metrics: { metric: string; group: string; name: string; service: string; count: number; errors: number; clientErrors: number; p50Ms: number | null; p95Ms: number | null }[] }) {
  const [all, setAll] = useState(false);
  if (metrics.length === 0) return <Empty>No traffic in this range yet.</Empty>;
  const shown = all ? metrics : metrics.slice(0, 15);
  return (
    <>
      <Table label="Routes">
        <thead>
          <tr>
            <th className={th}>Route / tool</th>
            <th className={th}>Part</th>
            <th className={cn(th, 'text-right')}>Requests</th>
            <th className={cn(th, 'text-right')}>4xx</th>
            <th className={cn(th, 'text-right')}>5xx</th>
            <th className={cn(th, 'text-right')}>p50</th>
            <th className={cn(th, 'text-right')}>p95</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.metric}>
              <td className={cn(td, 'font-code text-xs')}>{m.name}</td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{m.group}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(m.count)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(m.clientErrors)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(m.errors)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(m.p50Ms)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{fmtMs(m.p95Ms)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {metrics.length > 15 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${metrics.length}`}
        </Button>
      )}
    </>
  );
}
