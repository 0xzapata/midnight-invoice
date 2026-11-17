import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui/spinner';
import { operatorApi } from '../api';
import { BarChart, HBars } from '../charts';
import { Card, ErrorNote, PageTitle, StatTile, fmtMs, fmtNumber, fmtPercent } from '../ui';

const hourLabel = (t: number) => new Date(t).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });

function fillDays(rows: { day: string; n: number }[], days: number) {
  const map = new Map(rows.map((r) => [r.day, r.n]));
  const out: { key: string; label: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ key: d, label: new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: map.get(d) ?? 0 });
  }
  return out;
}

export function OverviewPage() {
  const q = useQuery({ queryKey: ['operator', 'overview'], queryFn: operatorApi.overview, refetchInterval: 30_000 });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const o = q.data;
  const err24 = o.api.last24h.errorRate;
  return (
    <>
      <PageTitle title="Overview" description="Headline numbers across workspaces, invoices, agents and the API. Refreshes every 30 seconds." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Workspaces" value={fmtNumber(o.workspaces.total)} sub={`+${fmtNumber(o.workspaces.recent)} new · ${fmtNumber(o.workspaces.active7d)} active (7d)`} />
        <StatTile label="Invoices" value={fmtNumber(o.invoices.total)} sub={`+${fmtNumber(o.invoices.recent)} created (7d)`} />
        <StatTile label="Agents" value={fmtNumber(o.agents.active)} sub={`${fmtNumber(o.agents.revoked)} revoked · ${fmtNumber(o.agents.pendingRegistrations)} pending`} />
        <StatTile
          label="API requests (24h)"
          value={fmtNumber(o.api.last24h.requests)}
          sub={`${fmtPercent(err24)} errors · p50 ${fmtMs(o.api.last24h.p50Ms)} · p95 ${fmtMs(o.api.last24h.p95Ms)}`}
          tone={err24 > 0.05 ? 'bad' : err24 > 0.01 ? 'warn' : 'default'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="API requests per hour (last 24 h)" description="Public REST API and MCP. Hover a bar for the count." className="lg:col-span-2">
          <BarChart
            label="API requests per hour"
            data={o.requestsHourly.map((p) => ({ key: p.t, label: hourLabel(p.t), value: p.count, detail: p.errors ? `${p.errors} server errors` : undefined }))}
            format={(v) => fmtNumber(v)}
          />
        </Card>
        <Card title="Last 7 days">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="text-right tabular-nums">{fmtNumber(o.api.last7d.requests)}</dd>
            <dt className="text-muted-foreground">Server errors</dt>
            <dd className="text-right tabular-nums">
              {fmtNumber(o.api.last7d.errors)} ({fmtPercent(o.api.last7d.errorRate)})
            </dd>
            <dt className="text-muted-foreground">p50 latency</dt>
            <dd className="text-right tabular-nums">{fmtMs(o.api.last7d.p50Ms)}</dd>
            <dt className="text-muted-foreground">p95 latency</dt>
            <dd className="text-right tabular-nums">{fmtMs(o.api.last7d.p95Ms)}</dd>
            <dt className="text-muted-foreground">Suspended workspaces</dt>
            <dd className="text-right tabular-nums">{fmtNumber(o.workspaces.suspended)}</dd>
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="New workspaces per day (14 days)">
          <BarChart label="New workspaces per day" height={100} data={fillDays(o.workspacesDaily, 14)} format={(v) => fmtNumber(v)} />
        </Card>
        <Card title="New invoices per day (14 days)">
          <BarChart label="New invoices per day" height={100} data={fillDays(o.invoicesDaily, 14)} format={(v) => fmtNumber(v)} />
        </Card>
        <Card title="Invoices by creator" description="Who created the invoices that exist now (all time / last 7 days).">
          <HBars
            rows={[
              { label: `People (${fmtNumber(o.invoices.byCreator.user.recent)} in 7d)`, value: o.invoices.byCreator.user.total },
              { label: `Agents (${fmtNumber(o.invoices.byCreator.agent.recent)} in 7d)`, value: o.invoices.byCreator.agent.total, tone: 'muted' },
            ]}
            format={(v) => fmtNumber(v)}
          />
        </Card>
      </div>
    </>
  );
}
