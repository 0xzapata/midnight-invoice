import { useId, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, History, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { EnableCloudSyncCard } from '@/components/sync/CloudSyncSettings';
import { ActivityTimeline } from '@/components/activity/ActivityTimeline';
import { useActivityFeed } from '@/components/activity/useActivity';
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/errors';
import { activityParamsOf } from '@/components/activity/filters';
import { useCloudEnabled } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';
import { ACTIVITY_ACTION_GROUPS } from '../../shared/activity';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';
const control =
  'h-10 w-full border border-border bg-secondary px-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

function Field({ label, children, id }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Filters() {
  const id = useId();
  const [search, setSearch] = useSearchParams();
  const agents = useQuery({ queryKey: ['agents'], queryFn: async () => (await api.listAgents()).agents });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };
  const agent = search.get('agent') ?? '';
  const knownAgent = !agent || agent === 'you' || agents.data?.some((a) => a.id === agent);
  const active = ['agent', 'group', 'from', 'to'].some((k) => search.get(k));

  return (
    <form className={cn(card, 'grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4')} aria-label="Filter activity" onSubmit={(e) => e.preventDefault()}>
      <Field label="Who" id={`${id}-who`}>
        <select id={`${id}-who`} className={control} value={agent} onChange={(e) => set('agent', e.target.value)}>
          <option value="">Everyone</option>
          <option value="you">You (your browsers)</option>
          {agents.data?.some((a) => !a.revokedAt) && (
            <optgroup label="Agents">
              {agents.data.filter((a) => !a.revokedAt).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          )}
          {agents.data?.some((a) => a.revokedAt) && (
            <optgroup label="Revoked agents">
              {agents.data.filter((a) => a.revokedAt).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (revoked)
                </option>
              ))}
            </optgroup>
          )}
          {!knownAgent && <option value={agent}>Selected agent</option>}
        </select>
      </Field>
      <Field label="What" id={`${id}-what`}>
        <select id={`${id}-what`} className={control} value={search.get('group') ?? ''} onChange={(e) => set('group', e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTIVITY_ACTION_GROUPS).map(([key, g]) => (
            <option key={key} value={key}>
              {g.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From" id={`${id}-from`}>
        <input id={`${id}-from`} type="date" className={control} value={search.get('from') ?? ''} max={search.get('to') ?? undefined} onChange={(e) => set('from', e.target.value)} />
      </Field>
      <Field label="To" id={`${id}-to`}>
        <input id={`${id}-to`} type="date" className={control} value={search.get('to') ?? ''} min={search.get('from') ?? undefined} onChange={(e) => set('to', e.target.value)} />
      </Field>
      {active && (
        <div className="min-[360px]:col-span-2 lg:col-span-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSearch(new URLSearchParams(), { replace: true })}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      )}
    </form>
  );
}

function Feed() {
  const [search] = useSearchParams();
  const params = useMemo(() => activityParamsOf(search), [search]);
  const feed = useActivityFeed(params);
  const filtered = Object.keys(params).length > 0;

  if (feed.isPending) {
    return (
      <div className="flex justify-center py-12" role="status" aria-label="Loading activity">
        <Spinner size="sm" />
      </div>
    );
  }
  if (feed.isError) {
    return (
      <div className={cn(card, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')} role="alert">
        <p className="text-sm text-destructive">{describeError(feed.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void feed.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const entries = feed.data.pages.flatMap((p) => p.activity);
  if (entries.length === 0) {
    return (
      <div className={cn(card, 'flex flex-col items-center gap-3 py-10 text-center')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
          <History className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {filtered ? 'No activity matches these filters.' : 'Nothing recorded yet. Changes made from now on will show up here.'}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className={card}>
        <ActivityTimeline entries={entries} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} shown
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void feed.refetch()} disabled={feed.isFetching}>
            <RefreshCw className={cn('h-4 w-4', feed.isFetching && !feed.isFetchingNextPage && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
          {feed.hasNextPage && (
            <Button variant="outline" size="sm" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
              {feed.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** `/activity`: the workspace's audit trail — what you and your agents did. */
export default function Activity() {
  const enabled = useCloudEnabled();
  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Activity" />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">Activity</h2>
            <p className="text-sm text-muted-foreground">
              What happened in your cloud workspace and who did it: invoices and clients created, changed or deleted, status
              changes, PDFs downloaded through the API, and agents approved or revoked.
            </p>
            {enabled && (
              <p className="text-xs text-muted-foreground">
                <Link to="/agents" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  Manage agents
                </Link>
              </p>
            )}
          </div>
          {!enabled ? (
            <EnableCloudSyncCard reason="Activity is recorded by the cloud workspace, so it starts once cloud sync is on. Changes you make while cloud sync is off stay in this browser and are not logged." />
          ) : (
            <>
              <Filters />
              <Feed />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
