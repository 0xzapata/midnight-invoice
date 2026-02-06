import { RefreshCw, WifiOff, AlertTriangle, Check } from 'lucide-react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { formatDistanceToNow } from '@/lib/utils';

export function SyncStatusIndicator() {
  const { status, icon, color, lastSyncTime, isOnline } = useSyncStatus();

  const getStatusText = () => {
    switch (status) {
      case 'synced':
        return 'Synced';
      case 'syncing':
        return 'Syncing...';
      case 'offline':
        return 'Offline';
      case 'conflict':
        return 'Conflict';
      default:
        return 'Unknown';
    }
  };

  const getStatusTooltip = () => {
    if (!isOnline) {
      return 'You are offline. Changes will sync when you reconnect.';
    }
    if (status === 'synced' && lastSyncTime) {
      return `Last synced: ${formatDistanceToNow(lastSyncTime)}`;
    }
    if (status === 'syncing') {
      return 'Syncing your changes to the cloud...';
    }
    if (status === 'conflict') {
      return 'There are conflicting changes. Click to resolve.';
    }
    return undefined;
  };

  return (
    <div
      className="flex items-center gap-2 text-xs font-medium"
      title={getStatusTooltip()}
      data-testid="sync-status-indicator"
    >
      <div className={`flex items-center gap-1 ${color}`}>
        {status === 'synced' && <Check className="w-3 h-3" aria-label="Check" />}
        {status === 'syncing' && <RefreshCw className="w-3 h-3 animate-spin" aria-label="RefreshCw" />}
        {status === 'offline' && <WifiOff className="w-3 h-3" aria-label="WifiOff" />}
        {status === 'conflict' && <AlertTriangle className="w-3 h-3" aria-label="AlertTriangle" />}
      </div>
      <span className="text-muted-foreground">
        {getStatusText()}
      </span>
    </div>
  );
}
