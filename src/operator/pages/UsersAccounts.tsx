import { useId, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { OperatorAccountItem } from '../../../shared/accounts';
import { errorMessage, operatorApi } from '../api';
import { Badge, Card, Empty, ErrorNote, Table, fmtAgo, td, th } from '../ui';

function DisableDialog({ account, onClose }: { account: OperatorAccountItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const id = useId();
  const run = useMutation({
    mutationFn: () => operatorApi.disableAccount(account!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Account disabled');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'accounts'] });
      setReason('');
      onClose();
    },
  });
  return (
    <AlertDialog
      open={!!account}
      onOpenChange={(o) => {
        if (!o) {
          setReason('');
          run.reset();
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disable account</AlertDialogTitle>
          <AlertDialogDescription>
            {account?.email} can no longer sign in, and every signed-in device is signed out and loses its sync key immediately. The workspace,
            its recovery key and its agents are not affected (suspend the workspace for that).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <Label htmlFor={id}>Reason (optional, shown only here and in the audit log)</Label>
          <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
          <ErrorNote error={run.error} />
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={run.isPending}>
              Disable
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Users → Accounts: optional user accounts (email, verification, sign-ins, linked workspace). Metadata only. */
export function Accounts() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [disabling, setDisabling] = useState<OperatorAccountItem | null>(null);
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['operator', 'accounts', search, status],
    queryFn: ({ pageParam }) => operatorApi.accounts({ q: search, status, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const enable = useMutation({
    mutationFn: (id: string) => operatorApi.enableAccount(id),
    onSuccess: () => {
      toast.success('Account enabled');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'accounts'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.pages.flatMap((p) => p.accounts) ?? [];
  const first = q.data?.pages[0];
  const searchId = useId();
  return (
    <Card
      title="Accounts"
      description={
        first && !first.enabled
          ? 'User accounts are off (Settings → Accounts). Accounts created while they were on are listed here.'
          : `Users who signed in with WorkOS. One account owns at most one workspace.${first?.requiredForNewWorkspaces ? ' New workspaces require an account.' : ''} Search by email.`
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor={searchId} className="sr-only">
              Search accounts by email
            </label>
            <Input id={searchId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email…" className="h-9 w-48 pl-8 text-xs" />
          </div>
          <select aria-label="Filter accounts by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 border border-input bg-background px-2 text-sm">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      }
    >
      {q.isPending && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data && rows.length === 0 && <Empty>No accounts match.</Empty>}
      {rows.length > 0 && (
        <Table label="Accounts">
          <thead>
            <tr>
              <th className={th}>Email</th>
              <th className={th}>Created</th>
              <th className={th}>Last sign-in</th>
              <th className={th}>Workspace</th>
              <th className={cn(th, 'text-right')}>Devices</th>
              <th className={th}>Status</th>
              <th className={cn(th, 'text-right')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={a.disabled ? 'opacity-70' : undefined}>
                <td className={cn(td, 'whitespace-nowrap')}>
                  {a.email} {a.emailVerified ? <Badge tone="good">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                </td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(a.createdAt)}</td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(a.lastSignInAt)}</td>
                <td className={cn(td, 'font-code text-xs')} title={a.workspaceId ?? undefined}>
                  {a.workspaceId ? `${a.workspaceId.slice(0, 8)}…` : '—'}
                </td>
                <td className={cn(td, 'text-right tabular-nums')}>{a.activeDevices}</td>
                <td className={td}>
                  {a.disabled ? (
                    <span title={a.disabledReason ?? undefined}>
                      <Badge tone="bad">Disabled</Badge>
                    </span>
                  ) : (
                    <Badge tone="good">Active</Badge>
                  )}
                </td>
                <td className={cn(td, 'whitespace-nowrap text-right')}>
                  {a.disabled ? (
                    <Button size="sm" variant="ghost" onClick={() => enable.mutate(a.id)} disabled={enable.isPending}>
                      Enable
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDisabling(a)}>
                      Disable
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.hasNextPage && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
      <DisableDialog account={disabling} onClose={() => setDisabling(null)} />
    </Card>
  );
}
