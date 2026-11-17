import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { errorMessage, operatorApi } from '../api';
import { Badge, Card, Empty, ErrorNote, PageTitle, Table, fmtAgo, fmtDateTime, td, th } from '../ui';

const KEY = ['operator', 'deployments'] as const;

function runTone(status: string | null, conclusion: string | null) {
  if (conclusion === 'success') return 'good' as const;
  if (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out') return 'bad' as const;
  if (status === 'in_progress' || status === 'queued' || status === 'pending') return 'info' as const;
  return 'default' as const;
}

export function DeploymentsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: operatorApi.deployments, refetchInterval: 15_000 });
  const [confirm, setConfirm] = useState(false);
  const reload = useMutation({
    mutationFn: operatorApi.reload,
    onSuccess: (r) => {
      toast.success(`Runtime configuration reloaded (version ${r.configVersion})`, { description: `Every isolate picks it up within ${r.propagationSeconds} s.` });
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const redeploy = useMutation({
    mutationFn: operatorApi.redeploy,
    onSuccess: (r) => {
      toast.success(`Deploy workflow dispatched on ${r.ref}`);
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: KEY }), 2000);
    },
    onError: (e) => toast.error('Redeploy failed', { description: errorMessage(e) }),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageTitle title="Deployments" description="What is running, and the two honest equivalents of “restart” and “redeploy” for a Cloudflare Worker." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Running version">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Worker version</dt>
            <dd className="truncate text-right font-code text-xs" title={d.version.id ?? ''}>
              {d.version.id ?? 'unavailable (local dev)'}
            </dd>
            <dt className="text-muted-foreground">Version tag</dt>
            <dd className="text-right font-code text-xs">{d.version.tag || '—'}</dd>
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd className="text-right">{fmtDateTime(d.version.timestamp)}</dd>
            <dt className="text-muted-foreground">Git commit</dt>
            <dd className="text-right font-code text-xs">{d.build.sha || '—'}</dd>
            <dt className="text-muted-foreground">Built</dt>
            <dd className="text-right">{fmtDateTime(d.build.time)}</dd>
            <dt className="text-muted-foreground">Config version</dt>
            <dd className="text-right tabular-nums">{d.configVersion}</dd>
          </dl>
        </Card>
        <Card
          title="Restart = reload runtime configuration"
          description={`Workers have no long-running process to restart. This bumps the configuration version: every isolate drops its cached settings, keys and suspension list on its next request (within ${d.propagationSeconds} s). Code changes need a redeploy.`}
        >
          <Button variant="outline" onClick={() => reload.mutate()} disabled={reload.isPending}>
            <RefreshCw aria-hidden="true" className={cn(reload.isPending && 'animate-spin')} />
            Reload runtime configuration
          </Button>
        </Card>
        <Card
          title="Redeploy"
          description="Dispatches the repository's GitHub Actions deploy workflow (workflow_dispatch), which builds and runs wrangler deploy."
        >
          {d.configured ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-code text-foreground">{d.repository}</span> · <span className="font-code">{d.workflow}</span> on{' '}
                <span className="font-code">{d.ref}</span>
              </p>
              <Button onClick={() => setConfirm(true)} disabled={redeploy.isPending}>
                <Rocket aria-hidden="true" />
                Redeploy
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Set {d.missing.map((m) => <code key={m} className="mx-0.5 font-code text-xs text-foreground">{m}</code>)} in{' '}
              <Link to="/operator/settings" className="text-primary underline-offset-4 hover:underline">
                Settings → Deployments
              </Link>{' '}
              (a fine-grained token with Actions read &amp; write on this repository only).
            </p>
          )}
        </Card>
      </div>

      <Card title="Recent workflow runs" className="mt-4" description="Refreshes every 15 seconds.">
        {d.runsError && <ErrorNote error={d.runsError} />}
        {!d.runsError && d.runs.length === 0 && <Empty>{d.configured ? 'No runs yet.' : 'Configure GitHub to see runs.'}</Empty>}
        {d.runs.length > 0 && (
          <Table label="Workflow runs">
            <thead>
              <tr>
                <th className={th}>Run</th>
                <th className={th}>Status</th>
                <th className={th}>Commit</th>
                <th className={th}>Trigger</th>
                <th className={th}>Started</th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td className={td}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                        {r.title ?? `#${r.id}`}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      (r.title ?? `#${r.id}`)
                    )}
                  </td>
                  <td className={td}>
                    <Badge tone={runTone(r.status, r.conclusion)}>{r.conclusion ?? r.status ?? 'unknown'}</Badge>
                  </td>
                  <td className={cn(td, 'font-code text-xs')}>
                    {r.headSha?.slice(0, 7) ?? '—'} <span className="text-muted-foreground">{r.headBranch}</span>
                  </td>
                  <td className={cn(td, 'text-muted-foreground')}>
                    {r.event}
                    {r.actor ? ` · ${r.actor}` : ''}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeploy {d.repository}?</AlertDialogTitle>
            <AlertDialogDescription>
              This dispatches {d.workflow} on {d.ref}. The workflow deploys whatever that ref contains; in-flight requests finish on the old version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => redeploy.mutate()}>Dispatch deploy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
