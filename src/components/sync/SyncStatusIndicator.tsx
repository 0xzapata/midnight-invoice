import { Link } from 'react-router';
import { AlertTriangle, CloudCheck, CloudOff, PauseCircle, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCloudStore, type SyncStatus } from '@/stores/useCloudStore';
import { syncNow } from '@/lib/sync/engine';
import { cn } from '@/lib/utils';

const LABELS: Record<Exclude<SyncStatus, 'disabled'>, string> = {
  disconnected: 'Disconnected',
  idle: 'Syncing…',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  paused: 'Sync paused',
  error: 'Sync error',
};

/**
 * Unobtrusive cloud sync status for page headers. Renders nothing while cloud
 * sync is off, so the local-only app looks exactly as before.
 */
export function SyncStatusIndicator({ className }: { className?: string }) {
  const status = useCloudStore((s) => s.status);
  const pending = useCloudStore((s) => s.queue.length);
  const lastError = useCloudStore((s) => s.lastError);
  const lastSyncedAt = useCloudStore((s) => s.lastSyncedAt);

  if (status === 'disabled') return null;

  const label = LABELS[status];
  const busy = status === 'syncing' || status === 'idle';
  const problem = status === 'error' || status === 'offline' || status === 'paused' || status === 'disconnected';
  const Icon = busy ? RefreshCw : status === 'synced' ? CloudCheck : status === 'error' ? AlertTriangle : status === 'paused' ? PauseCircle : CloudOff;

  const waiting = pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.` : '';
  const detail =
    status === 'disconnected'
      ? 'This browser is no longer connected to a cloud workspace. Your invoices are still here.'
      : status === 'synced'
        ? `All changes saved to the cloud${lastSyncedAt ? ` (last checked ${format(parseISO(lastSyncedAt), 'HH:mm:ss')})` : ''}.`
        : status === 'offline'
          ? `You are offline. ${waiting || 'Changes are kept in this browser.'}`
          : status === 'error' || status === 'paused'
            ? `${lastError ?? (status === 'paused' ? 'Cloud sync is paused.' : 'Sync failed.')} ${waiting}`
            : `Syncing with the cloud… ${waiting}`;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/?tab=settings"
            className={cn(
              'inline-flex h-9 items-center gap-1.5 px-2 font-mono text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              status === 'synced' && 'text-muted-foreground',
              busy && 'text-muted-foreground',
              (status === 'offline' || status === 'paused') && 'text-amber-600 dark:text-amber-400',
              (status === 'error' || status === 'disconnected') && 'text-destructive',
            )}
            aria-label={`Cloud sync: ${label}. ${detail}`}
          >
            <Icon className={cn('h-4 w-4 shrink-0', busy && 'animate-spin')} aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
            {pending > 0 && problem && (
              <span className="font-mono text-[10px] tabular-nums" aria-hidden="true">
                {pending}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{detail}</TooltipContent>
      </Tooltip>
      {(status === 'error' || status === 'offline' || status === 'paused') && (
        <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => void syncNow({ force: true, pullSettings: true })}>
          Retry
        </Button>
      )}
      {/* Announced to screen readers when the status changes. */}
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? '' : `Cloud sync: ${label}`}
      </span>
    </div>
  );
}
