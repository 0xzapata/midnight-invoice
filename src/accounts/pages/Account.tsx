import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { KeyRound, Laptop, LogOut, RotateCw, ShieldAlert, ShieldOff, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';
import { leaveWorkspace } from '@/lib/sync/session';
import { useCloudStore } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';
import type { AccountSessionResponse, DeviceItem } from '../../../shared/accounts';
import { accountApi, accountErrorMessage } from '../api';
import { SignInButtons } from '../components/AccountSignIn';
import { continueAnonymously, signOutThisBrowser } from '../connect';
import { ACCOUNT_SESSION_KEY, useAccountConfig, useAccountSession } from '../hooks';
import { useAccountStore, useLinkedAccount } from '../useAccountStore';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';
const DEVICES_KEY = ['account-devices'] as const;

function Section({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(card, 'space-y-3', className)} aria-label={title}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Confirm({
  trigger,
  title,
  children,
  action,
  destructive,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeviceRow({ device, onRevoke, pending }: { device: DeviceItem; onRevoke: () => void; pending: boolean }) {
  return (
    <li className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {device.label}
          {device.current && <span className="ml-2 border border-primary/40 px-1.5 py-0.5 text-[11px] font-medium text-primary">This browser</span>}
        </p>
        <p className="text-xs">
          Added {format(device.createdAt, 'PP')}
          {device.lastUsedAt
            ? ` · last synced ${formatDistanceToNow(device.lastUsedAt, { addSuffix: true })}`
            : device.lastSeenAt
              ? ` · signed in ${formatDistanceToNow(device.lastSeenAt, { addSuffix: true })}`
              : ''}
          {!device.signedIn && ' · syncing, account session ended'}
        </p>
      </div>
      <Confirm
        trigger={
          <Button variant="outline" size="sm" disabled={pending} className="text-destructive hover:text-destructive">
            <LogOut className="w-4 h-4" aria-hidden="true" />
            {device.current ? 'Sign out' : 'Revoke'}
          </Button>
        }
        title={device.current ? 'Sign out of this browser?' : `Revoke “${device.label}”?`}
        action={device.current ? 'Sign out' : 'Revoke'}
        destructive
        onConfirm={onRevoke}
      >
        <p>That device stops syncing immediately and is signed out. Invoices already on it stay there. Agents are not affected.</p>
      </Confirm>
    </li>
  );
}

function Devices() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const linked = useLinkedAccount();
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: () => accountApi.devices() });
  const afterSignOutHere = () => {
    if (useAccountStore.getState().linked) leaveWorkspace(null);
    useAccountStore.getState().setLinked(null);
    queryClient.setQueryData(ACCOUNT_SESSION_KEY, null);
    navigate('/?tab=settings');
  };
  const revoke = useMutation({
    mutationFn: async (d: DeviceItem) => {
      await accountApi.revokeDevice(d.id);
      return d;
    },
    onSuccess: (d) => {
      if (d.current || d.id === linked?.deviceId) {
        afterSignOutHere();
        toast.success('Signed out of this browser');
        return;
      }
      toast.success(`“${d.label}” signed out`);
      void queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    },
    onError: (e) => toast.error('Could not revoke the device', { description: accountErrorMessage(e) }),
  });
  const everywhere = useMutation({
    mutationFn: async (keepThisDevice: boolean) => {
      await accountApi.signOutEverywhere(keepThisDevice);
      return keepThisDevice;
    },
    onSuccess: (keep) => {
      if (!keep) {
        afterSignOutHere();
        toast.success('Signed out everywhere', { description: 'Every device, including this one, stopped syncing. Invoices stay on each device.' });
        return;
      }
      toast.success('Other devices signed out');
      void queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    },
    onError: (e) => toast.error('Could not sign out', { description: accountErrorMessage(e) }),
  });
  const list = devices.data?.devices ?? [];
  return (
    <Section icon={<Laptop className="h-4 w-4" />} title="Devices">
      <p>Each signed-in browser syncs with its own key. Revoke one you no longer use or do not recognise.</p>
      {devices.isPending && <Spinner />}
      {devices.error && <p className="text-destructive">{accountErrorMessage(devices.error)}</p>}
      {devices.data && list.length === 0 && <p>No device is connected to this account.</p>}
      {list.length > 0 && (
        <ul aria-label="Signed-in devices">
          {list.map((d) => (
            <DeviceRow key={d.id} device={d} pending={revoke.isPending} onRevoke={() => revoke.mutate(d)} />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Confirm
          trigger={
            <Button variant="outline" size="sm" disabled={everywhere.isPending || list.filter((d) => !d.current).length === 0}>
              Sign out other devices
            </Button>
          }
          title="Sign out every other device?"
          action="Sign out others"
          onConfirm={() => everywhere.mutate(true)}
        >
          <p>All other browsers stop syncing and must sign in again. This browser stays signed in.</p>
        </Confirm>
        <Confirm
          trigger={
            <Button variant="outline" size="sm" disabled={everywhere.isPending} className="text-destructive hover:text-destructive">
              Sign out everywhere
            </Button>
          }
          title="Sign out everywhere?"
          action="Sign out everywhere"
          destructive
          onConfirm={() => everywhere.mutate(false)}
        >
          <p>Every browser, including this one, stops syncing and is signed out. Invoices stay on each device and in your account.</p>
        </Confirm>
      </div>
    </Section>
  );
}

function RecoveryKey({ session }: { session: AccountSessionResponse }) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<string | null>(null);
  const inputId = useId();
  const enabled = session.workspace?.recoveryKeyEnabled ?? false;
  const rotate = useMutation({
    mutationFn: () => accountApi.rotateRecoveryKey(),
    onSuccess: (r) => {
      setShown(r.recoveryKey);
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY });
    },
    onError: (e) => toast.error('Could not create a recovery key', { description: accountErrorMessage(e) }),
  });
  const disable = useMutation({
    mutationFn: () => accountApi.disableRecoveryKey(),
    onSuccess: () => {
      setShown(null);
      toast.success('Recovery key turned off');
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY });
    },
    onError: (e) => toast.error('Could not turn off the recovery key', { description: accountErrorMessage(e) }),
  });
  if (!session.workspace) return null;
  return (
    <Section icon={<KeyRound className="h-4 w-4" />} title="Recovery key (optional)">
      <p>
        With an account you get back to your workspace by signing in, so a recovery key is optional. It is a password-less backup: anyone
        holding it has full access to your cloud invoices.
      </p>
      <p>
        Status: <span className="font-medium text-foreground">{enabled ? 'on (the key works)' : 'off (no key works)'}</span>
      </p>
      {shown && (
        <div className="space-y-2">
          <Label htmlFor={inputId} className="text-xs">
            New recovery key (shown once; the previous key no longer works)
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={inputId} readOnly value={shown} spellCheck={false} autoComplete="off" onFocus={(e) => e.currentTarget.select()} className="bg-secondary border-border font-code text-xs" />
            <CopyButton value={shown} label="Copy" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Confirm
          trigger={
            <Button variant="outline" size="sm" disabled={rotate.isPending}>
              <RotateCw className="w-4 h-4" aria-hidden="true" />
              {enabled ? 'Rotate recovery key' : 'Create a recovery key'}
            </Button>
          }
          title={enabled ? 'Replace the recovery key?' : 'Create a recovery key?'}
          action={enabled ? 'Rotate' : 'Create'}
          onConfirm={() => rotate.mutate()}
        >
          <p>{enabled ? 'The current key stops working immediately, on every browser that connected with it. ' : ''}The new key is shown once. Save it in a password manager.</p>
        </Confirm>
        {enabled && (
          <Confirm
            trigger={
              <Button variant="outline" size="sm" disabled={disable.isPending}>
                <ShieldOff className="w-4 h-4" aria-hidden="true" />
                Turn off recovery key
              </Button>
            }
            title="Turn off the recovery key?"
            action="Turn off"
            onConfirm={() => disable.mutate()}
          >
            <p>The key stops working everywhere. Only devices signed in to your account (and agents you approved) keep access.</p>
          </Confirm>
        )}
      </div>
    </Section>
  );
}

function DeleteAccount({ session }: { session: AccountSessionResponse }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [deleteWorkspace, setDeleteWorkspace] = useState(false);
  const [open, setOpen] = useState(false);
  const id = useId();
  const remove = useMutation({
    mutationFn: () => accountApi.deleteAccount(confirm.trim(), deleteWorkspace),
    onSuccess: (r) => {
      const wasLinked = !!useAccountStore.getState().linked;
      if (wasLinked) continueAnonymously(r.deletedWorkspace ? null : r.recoveryKey);
      else if (r.deletedWorkspace && useCloudStore.getState().workspace?.id === session.workspace?.id) leaveWorkspace(null);
      queryClient.setQueryData(ACCOUNT_SESSION_KEY, null);
      setOpen(false);
      toast.success('Account deleted', {
        description: r.deletedWorkspace
          ? 'Your cloud workspace was deleted too. Invoices in this browser were kept.'
          : 'Your workspace was kept. This browser now uses its recovery key (see Settings → Cloud sync).',
      });
      navigate('/?tab=settings');
    },
  });
  return (
    <Section icon={<ShieldAlert className="h-4 w-4 text-destructive" />} title="Delete account" className="border-destructive/30">
      <p>
        Deletes your account, signs out every device and revokes their keys. You choose whether the cloud workspace is deleted too; if
        you keep it, this browser continues with a new recovery key.
      </p>
      <AlertDialog open={open} onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setConfirm('');
            remove.reset();
          }
        }}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Invoices stored in your browsers are never deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            {session.workspace && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={deleteWorkspace} onChange={(e) => setDeleteWorkspace(e.target.checked)} className="mt-1" />
                <span>Also delete the cloud workspace (all cloud invoices, clients, settings and agent connections)</span>
              </label>
            )}
            <div className="space-y-1">
              <Label htmlFor={id}>Type your email address to confirm</Label>
              <Input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={session.user.email} autoComplete="off" />
            </div>
            {remove.error && (
              <p role="alert" className="text-xs text-destructive">
                {accountErrorMessage(remove.error)}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={remove.isPending || confirm.trim().toLowerCase() !== session.user.email}>
                {remove.isPending ? 'Deleting…' : 'Delete account'}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

/** `/account`: the signed-in account (email, sign out, devices, recovery key, deletion). */
export default function Account() {
  const config = useAccountConfig();
  const enabled = config.data?.enabled === true;
  const session = useAccountSession(enabled);
  const linked = useLinkedAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => signOutThisBrowser(),
    onSuccess: () => {
      queryClient.setQueryData(ACCOUNT_SESSION_KEY, null);
      toast.success('Signed out', { description: 'Invoices in this browser were kept.' });
      navigate('/?tab=settings');
    },
    onError: (e) => toast.error('Could not sign out', { description: accountErrorMessage(e) }),
  });
  const s = session.data;
  const thisBrowserLinked = !!s && !!linked && linked.userId === s.user.id;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Account" backTo="/?tab=settings" />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Account</h2>
            <p className="text-sm text-muted-foreground">Sign in to reach your cloud workspace from any browser. Accounts are optional; the app works without one.</p>
          </div>

          {(config.isPending || (enabled && session.isPending)) && <Spinner />}
          {config.data && !enabled && (
            <div className={card}>
              <p className="text-sm text-muted-foreground">Accounts are not available on this site.</p>
            </div>
          )}
          {enabled && session.data === null && (
            <div className={cn(card, 'space-y-3')}>
              <p className="text-sm text-muted-foreground">You are not signed in.</p>
              <SignInButtons returnTo="/account" />
            </div>
          )}
          {session.error && <p className="text-sm text-destructive">{accountErrorMessage(session.error)}</p>}

          {s && (
            <>
              <Section icon={<UserRound className="h-4 w-4" />} title="Signed in">
                <p className="break-all text-base font-medium text-foreground">{s.user.email}</p>
                <p>
                  Account created {format(s.user.createdAt, 'PP')}
                  {s.workspace ? (
                    <>
                      {' '}
                      · workspace <span className="font-code text-xs">{s.workspace.id.slice(0, 8)}</span>
                    </>
                  ) : (
                    ' · no cloud workspace yet'
                  )}
                </p>
                <p>
                  {thisBrowserLinked
                    ? 'This browser syncs with your account.'
                    : 'This browser is not syncing with your account.'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {!thisBrowserLinked && (
                    <Button size="sm" asChild>
                      <Link to="/account/connect?return_to=%2Faccount">Connect this browser</Link>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    {signOut.isPending ? 'Signing out…' : 'Sign out'}
                  </Button>
                </div>
              </Section>
              <Devices />
              <RecoveryKey session={s} />
              <DeleteAccount session={s} />
              <p className="text-xs text-muted-foreground">
                To delete only the cloud workspace and keep the account, use Settings → Cloud sync &amp; agents → Delete cloud workspace.
                One account has one workspace.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
