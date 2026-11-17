import { useId, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Search } from 'lucide-react';
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
import type { WorkspaceItem } from '../../../shared/operator';
import { errorMessage, operatorApi } from '../api';
import { Badge, Card, Empty, ErrorNote, PageTitle, Table, fmtAgo, fmtNumber, td, th } from '../ui';
import { Accounts } from './UsersAccounts';

type Dialog = { kind: 'suspend' | 'delete'; ws: WorkspaceItem } | null;

function WorkspaceDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const id = useId();
  const run = useMutation({
    mutationFn: async () => {
      if (!dialog) return;
      if (dialog.kind === 'suspend') await operatorApi.suspend(dialog.ws.id, text.trim() || undefined);
      else await operatorApi.deleteWorkspace(dialog.ws.id, text.trim());
    },
    onSuccess: () => {
      toast.success(dialog?.kind === 'suspend' ? 'Workspace suspended' : 'Workspace deleted');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'workspaces'] });
      setText('');
      onClose();
    },
  });
  const isDelete = dialog?.kind === 'delete';
  return (
    <AlertDialog
      open={!!dialog}
      onOpenChange={(o) => {
        if (!o) {
          setText('');
          run.reset();
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isDelete ? 'Delete workspace' : 'Suspend workspace'}</AlertDialogTitle>
          <AlertDialogDescription>
            {isDelete
              ? 'This permanently deletes the workspace, its invoices, saved clients, settings and agents from the server. Browsers keep their local copies. This cannot be undone.'
              : 'The workspace token and all of its agents will get 403 “workspace_suspended” until you unsuspend it. Nothing is deleted.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <Label htmlFor={id}>{isDelete ? 'Type the workspace id to confirm' : 'Reason (optional, shown only here and in the audit log)'}</Label>
          <Input id={id} value={text} onChange={(e) => setText(e.target.value)} className={isDelete ? 'font-code text-xs' : undefined} placeholder={isDelete ? dialog?.ws.id : ''} autoComplete="off" />
          <ErrorNote error={run.error} />
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant={isDelete ? 'destructive' : 'default'} disabled={run.isPending || (isDelete && text.trim() !== dialog?.ws.id)}>
              {isDelete ? 'Delete permanently' : 'Suspend'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Workspaces() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['operator', 'workspaces', search, status],
    queryFn: ({ pageParam }) => operatorApi.workspaces({ q: search, status, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const unsuspend = useMutation({
    mutationFn: (id: string) => operatorApi.unsuspend(id),
    onSuccess: () => {
      toast.success('Workspace unsuspended');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'workspaces'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.pages.flatMap((p) => p.workspaces) ?? [];
  const searchId = useId();
  return (
    <Card
      title="Workspaces"
      description="Cloud-sync workspaces (anonymous unless an account owns them, see Accounts). Search by id prefix."
      actions={
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor={searchId} className="sr-only">
              Search workspaces
            </label>
            <Input id={searchId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Workspace id…" className="h-9 w-48 pl-8 font-code text-xs" />
          </div>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 border border-input bg-background px-2 text-sm">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      }
    >
      {q.isPending && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data && rows.length === 0 && <Empty>No workspaces match.</Empty>}
      {rows.length > 0 && (
        <Table label="Workspaces">
          <thead>
            <tr>
              <th className={th}>Workspace</th>
              <th className={th}>Created</th>
              <th className={th}>Last activity</th>
              <th className={cn(th, 'text-right')}>Invoices</th>
              <th className={cn(th, 'text-right')}>Clients</th>
              <th className={cn(th, 'text-right')}>Agents</th>
              <th className={th}>Status</th>
              <th className={cn(th, 'text-right')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td className={cn(td, 'font-code text-xs')} title={w.id}>
                  {w.id.slice(0, 8)}…
                </td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(w.createdAt)}</td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(w.lastActivityAt)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(w.invoiceCount)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(w.clientCount)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{fmtNumber(w.agentCount)}</td>
                <td className={td}>
                  {w.suspended ? (
                    <span title={w.suspensionReason ?? undefined}>
                      <Badge tone="bad">Suspended</Badge>
                    </span>
                  ) : (
                    <Badge tone="good">Active</Badge>
                  )}
                </td>
                <td className={cn(td, 'whitespace-nowrap text-right')}>
                  {w.suspended ? (
                    <Button size="sm" variant="ghost" onClick={() => unsuspend.mutate(w.id)} disabled={unsuspend.isPending}>
                      Unsuspend
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'suspend', ws: w })}>
                      Suspend
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog({ kind: 'delete', ws: w })}>
                    Delete
                  </Button>
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
      <WorkspaceDialog dialog={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

function Agents() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['operator', 'agents', search, status],
    queryFn: ({ pageParam }) => operatorApi.agents({ q: search, status, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => operatorApi.revokeAgent(id),
    onSuccess: () => {
      toast.success('Agent revoked');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'agents'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.pages.flatMap((p) => p.agents) ?? [];
  const searchId = useId();
  return (
    <Card
      title="Agents"
      description="Agents across all workspaces. Force-revoking takes effect on the agent's next request."
      actions={
        <div className="flex flex-wrap gap-2">
          <label htmlFor={searchId} className="sr-only">
            Search agents
          </label>
          <Input id={searchId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or id…" className="h-9 w-48 text-xs" />
          <select aria-label="Filter agents by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 border border-input bg-background px-2 text-sm">
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="all">All</option>
          </select>
        </div>
      }
    >
      {q.isPending && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data && rows.length === 0 && <Empty>No agents match.</Empty>}
      {rows.length > 0 && (
        <Table label="Agents">
          <thead>
            <tr>
              <th className={th}>Agent</th>
              <th className={th}>Workspace</th>
              <th className={th}>Scopes</th>
              <th className={th}>Created</th>
              <th className={th}>Last used</th>
              <th className={cn(th, 'text-right')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={a.revokedAt ? 'opacity-60' : undefined}>
                <td className={td}>
                  <span className="break-words">{a.name}</span>
                </td>
                <td className={cn(td, 'font-code text-xs')} title={a.workspaceId}>
                  {a.workspaceId.slice(0, 8)}…
                </td>
                <td className={cn(td, 'text-xs text-muted-foreground')}>{a.scopes.join(', ')}</td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(a.createdAt)}</td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(a.lastUsedAt)}</td>
                <td className={cn(td, 'text-right')}>
                  {a.revokedAt ? (
                    <Badge>Revoked</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => revoke.mutate(a.id)} disabled={revoke.isPending}>
                      Revoke
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
    </Card>
  );
}

export function UsersPage() {
  return (
    <>
      <PageTitle title="Users" description="Workspaces are anonymous unless their owner signs in with an optional account; then only the account email is shown." />
      <div className="mb-4 flex items-start gap-3 border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium text-foreground">Privacy boundary.</span> The console shows metadata only: ids, timestamps and counts. It never
          shows invoice contents, saved clients' names, addresses or emails, settings or tokens, and there is no endpoint that returns them. For accounts
          it shows the sign-in email and its verification status only.
        </p>
      </div>
      <div className="space-y-4">
        <Accounts />
        <Workspaces />
        <Agents />
      </div>
    </>
  );
}
