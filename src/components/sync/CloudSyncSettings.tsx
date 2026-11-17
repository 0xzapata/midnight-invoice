import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Bot, Cloud, CloudUpload, Eye, EyeOff, History, KeyRound, Link2, RefreshCw, ShieldAlert, Trash2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { describeError } from '@/lib/api/errors';
import {
  connectExistingWorkspace,
  deleteCloudWorkspace,
  disconnectThisBrowser,
  enableCloudSync,
  InvalidRecoveryKeyError,
} from '@/lib/sync/cloudActions';
import { syncNow } from '@/lib/sync/engine';
import { useCloudStore } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';

const sectionCard = 'rounded-lg border border-border bg-card p-4 sm:p-5';

/** Form to link this browser to an existing workspace with its recovery key. */
export function ConnectWorkspaceForm({ onConnected, autoFocus }: { onConnected?: () => void; autoFocus?: boolean }) {
  const id = useId();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await connectExistingWorkspace(key);
      setKey('');
      toast.success('Connected to your cloud workspace');
      onConnected?.();
    } catch (err) {
      setError(err instanceof InvalidRecoveryKeyError ? err.message : describeError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2" aria-describedby={`${id}-help`}>
      <Label htmlFor={`${id}-key`} className="text-xs text-muted-foreground">
        Recovery key
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="mi_ws_…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-help`}
          className="bg-secondary border-border font-code"
        />
        <Button type="submit" variant="outline" disabled={pending || key.trim() === ''} className="sm:w-auto">
          <Link2 className="w-4 h-4" aria-hidden="true" />
          {pending ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Paste the recovery key from a browser that already syncs (Settings → Cloud sync &amp; agents → Link another device).
        Invoices already in this browser are added to that workspace.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Opt-in explanation with "Turn on cloud sync" and "Connect existing workspace".
 * Used in settings and wherever a feature needs cloud sync (approving agents).
 */
export function EnableCloudSyncCard({ reason, onEnabled }: { reason?: string; onEnabled?: () => void }) {
  const [pending, setPending] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const disconnected = useCloudStore((s) => s.disconnectedReason === 'token_rejected');

  const enable = async () => {
    setPending(true);
    try {
      await enableCloudSync();
      toast.success('Cloud sync is on', { description: 'Your invoices and default settings are being uploaded.' });
      onEnabled?.();
    } catch (err) {
      toast.error('Could not turn on cloud sync', { description: describeError(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn(sectionCard, 'space-y-4')}>
      {disconnected && (
        <div role="alert" className="flex gap-3 border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">
          <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p>
            This browser was disconnected: the server no longer accepts its key (the workspace may have been deleted from
            another device). Your invoices are still here. Turn cloud sync on again, or connect with a recovery key.
          </p>
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Cloud className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div className="space-y-2 text-sm">
          {reason && <p className="font-medium text-foreground">{reason}</p>}
          <p className="text-muted-foreground">
            Right now your invoices are stored only in this browser. When you turn on cloud sync, your invoices and default
            settings are <strong className="font-medium text-foreground">uploaded to and stored on this app’s server</strong> in
            an anonymous workspace (no account, no email), so you can open them on your other devices and so AI agents{' '}
            <em>you approve</em> can read and create invoices for you.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Drafts stay in this browser.</li>
            <li>The app keeps working offline; changes sync when you are back online.</li>
            <li>You can disconnect this browser or delete the cloud copy at any time.</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={enable} disabled={pending}>
          <CloudUpload className="w-4 h-4" aria-hidden="true" />
          {pending ? 'Turning on…' : 'Turn on cloud sync'}
        </Button>
        <Button variant="outline" onClick={() => setShowConnect((v) => !v)} aria-expanded={showConnect}>
          <KeyRound className="w-4 h-4" aria-hidden="true" />
          Connect existing workspace
        </Button>
      </div>
      {showConnect && <ConnectWorkspaceForm onConnected={onEnabled} autoFocus />}
    </div>
  );
}

/** Reveal-on-request recovery key, for linking another browser or device. */
function RecoveryKeyPanel() {
  const token = useCloudStore((s) => s.token);
  const [revealed, setRevealed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputId = useId();
  if (!token) return null;

  return (
    <div className={cn(sectionCard, 'space-y-3')}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-foreground">Link another browser or device</h4>
          <p className="text-sm text-muted-foreground">
            Your workspace has no password. Its <strong className="font-medium text-foreground">recovery key</strong> is the only
            way to open it from another device, or from this one if you clear your browser data. Save it in a password manager.
          </p>
        </div>
      </div>
      {revealed ? (
        <div className="space-y-2">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">
            Recovery key
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={inputId}
              readOnly
              value={token}
              spellCheck={false}
              autoComplete="off"
              onFocus={(e) => e.currentTarget.select()}
              className="bg-secondary border-border font-code text-xs"
            />
            <div className="flex gap-2">
              <CopyButton value={token} label="Copy" />
              <Button variant="ghost" size="sm" onClick={() => setRevealed(false)}>
                <EyeOff className="w-4 h-4" aria-hidden="true" />
                Hide
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            On the other device: Settings → Cloud sync &amp; agents → Connect existing workspace.
          </p>
        </div>
      ) : (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Eye className="w-4 h-4" aria-hidden="true" />
              Show recovery key
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Show your recovery key?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Anyone with this key has full access to your cloud invoices: they can read, change and delete them, and
                    approve agents.
                  </p>
                  <p>
                    Never paste it into a chat or give it to an AI agent; agents connect with their own code instead. Make sure
                    nobody can see your screen.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => setRevealed(true)}>Show key</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function ConnectedPanel() {
  const workspace = useCloudStore((s) => s.workspace);
  const status = useCloudStore((s) => s.status);
  const pending = useCloudStore((s) => s.queue.length);
  const lastSyncedAt = useCloudStore((s) => s.lastSyncedAt);
  const lastError = useCloudStore((s) => s.lastError);
  const localOnly = useCloudStore((s) => Object.keys(s.syncErrors).length);
  const [busy, setBusy] = useState<'disconnect' | 'delete' | null>(null);

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await disconnectThisBrowser();
      toast.success('This browser is disconnected', { description: 'Your invoices are still here. Use the recovery key to reconnect.' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await deleteCloudWorkspace();
      toast.success('Cloud workspace deleted', { description: 'Invoices in this browser were kept. Agents no longer have access.' });
    } catch (err) {
      toast.error('Could not delete the cloud workspace', { description: describeError(err) });
    } finally {
      setBusy(null);
    }
  };

  const statusText =
    status === 'synced'
      ? `Up to date${lastSyncedAt ? ` · checked ${formatDistanceToNow(parseISO(lastSyncedAt), { addSuffix: true })}` : ''}`
      : status === 'offline'
        ? 'Offline · changes sync when you are back online'
        : status === 'error' || status === 'paused'
          ? (lastError ?? (status === 'paused' ? 'Cloud sync is paused' : 'Sync failed'))
          : 'Syncing…';

  return (
    <div className="space-y-4">
      <div className={cn(sectionCard, 'space-y-4')}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Cloud className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium text-foreground">Cloud sync is on</p>
            <p className="text-muted-foreground">
              Invoices and default settings are stored on this app’s server so your devices and approved agents can use them.
              Drafts stay in this browser.
            </p>
            <p className="text-muted-foreground" aria-live="polite">
              <span className={cn(status === 'error' && 'text-destructive', status === 'paused' && 'text-amber-600 dark:text-amber-400')}>{statusText}</span>
              {pending > 0 && ` · ${pending} change${pending === 1 ? '' : 's'} waiting`}
              {localOnly > 0 && ` · ${localOnly} invoice${localOnly === 1 ? '' : 's'} could not be uploaded (marked “Not synced”)`}
            </p>
            {workspace && (
              <p className="truncate font-code text-xs text-muted-foreground">Workspace {workspace.id.slice(0, 8)}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" size="sm" onClick={() => void syncNow({ force: true, pullSettings: true })}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Sync now
          </Button>
          <Button variant="outline" size="sm" asChild className="font-mono">
            <Link to="/agents">
              <Bot className="w-4 h-4" aria-hidden="true" />
              Manage agents
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="font-mono">
            <Link to="/activity">
              <History className="w-4 h-4" aria-hidden="true" />
              Activity log
            </Link>
          </Button>
        </div>
      </div>

      <RecoveryKeyPanel />

      <div className={cn(sectionCard, 'space-y-3 border-destructive/30')}>
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <h4 className="text-sm font-medium text-foreground">Stop syncing</h4>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null}>
                <Unplug className="w-4 h-4" aria-hidden="true" />
                Disconnect this browser
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect this browser?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      This browser stops syncing and forgets the workspace’s recovery key. Invoices stay here and in the cloud;
                      approved agents keep their access.
                    </p>
                    <p className="font-medium text-foreground">
                      To reconnect later you will need the recovery key. Copy it first if you have not saved it.
                    </p>
                    {pending > 0 && (
                      <p className="text-destructive">
                        {pending} change{pending === 1 ? ' has' : 's have'} not been uploaded yet and will stay in this browser only.
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {busy === 'delete' ? 'Deleting…' : 'Delete cloud workspace'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete the cloud workspace?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      All invoices and settings stored on the server are permanently deleted, every connected agent loses
                      access immediately, and other devices linked to this workspace are disconnected.
                    </p>
                    <p className="font-medium text-foreground">The invoices in this browser are kept.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void remove()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete workspace
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

/** Settings → "Cloud sync & agents". */
export function CloudSyncSettings() {
  const enabled = useCloudStore((s) => !!s.token);
  return (
    <section id="cloud-sync" aria-labelledby="cloud-sync-title" className="space-y-4 scroll-mt-20">
      <div>
        <h3 id="cloud-sync-title" className="text-lg font-semibold text-foreground">
          Cloud sync &amp; agents
        </h3>
        <p className="text-sm text-muted-foreground">
          {enabled ? 'This browser syncs with your cloud workspace.' : 'Off. Everything stays in this browser.'}
        </p>
      </div>
      {enabled ? <ConnectedPanel /> : <EnableCloudSyncCard />}
    </section>
  );
}
