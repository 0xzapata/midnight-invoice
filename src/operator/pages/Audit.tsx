import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { operatorApi } from '../api';
import { Badge, Card, Empty, ErrorNote, PageTitle, Table, fmtDateTime, td, th } from '../ui';

const ACTIONS = [
  ['', 'All actions'],
  ['auth', 'Sign-ins & sign-outs'],
  ['bootstrap', 'Bootstrap'],
  ['settings', 'Settings changes'],
  ['workspace', 'Workspaces'],
  ['agent', 'Agents'],
  ['deploy', 'Redeploys'],
  ['runtime', 'Runtime reloads'],
  ['encryption', 'Encryption & keys'],
  ['operator', 'Operators'],
  ['session', 'Sessions'],
] as const;

const tone = (action: string) =>
  /failed|denied|delete|revoke|suspend\b|remove/.test(action) ? ('bad' as const) : action.startsWith('encryption') ? ('warn' as const) : ('default' as const);

export function AuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const actorId = useId();
  const q = useInfiniteQuery({
    queryKey: ['operator', 'audit', action, actor],
    queryFn: ({ pageParam }) => operatorApi.audit({ action, actor, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <>
      <PageTitle title="Audit log" description="Every operator action: sign-ins, setup, settings changes (never values of secrets), suspensions, deletions, redeploys and key operations." />
      <Card
        actions={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} className="h-9 border border-input bg-background px-2 text-sm">
              {ACTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label htmlFor={actorId} className="sr-only">
              Filter by actor
            </label>
            <Input id={actorId} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor email…" className="h-9 w-48 text-xs" />
          </div>
        }
        title="Entries"
      >
        {q.isPending && <Spinner />}
        <ErrorNote error={q.error} />
        {q.data && rows.length === 0 && <Empty>No entries match.</Empty>}
        {rows.length > 0 && (
          <Table label="Audit log">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Actor</th>
                <th className={th}>Action</th>
                <th className={th}>Target</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtDateTime(e.at)}</td>
                  <td className={td}>
                    <span className="block">{e.actorEmail ?? e.actorType}</span>
                    {e.ip && <span className="block font-code text-[11px] text-muted-foreground">{e.ip}</span>}
                  </td>
                  <td className={td}>
                    <Badge tone={tone(e.action)}>{e.action}</Badge>
                  </td>
                  <td className={cn(td, 'max-w-[14rem] break-all font-code text-xs')}>{e.target ?? '—'}</td>
                  <td className={cn(td, 'max-w-[16rem] break-all font-code text-[11px] text-muted-foreground')}>{e.detail ? JSON.stringify(e.detail) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {q.hasNextPage && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Load older entries
          </Button>
        )}
      </Card>
    </>
  );
}
