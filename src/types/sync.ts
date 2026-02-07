export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'conflict';

export interface SyncState {
  status: SyncStatus;
  lastSyncTime?: Date;
  isOnline: boolean;
  setStatus: (status: SyncStatus) => void;
  setLastSyncTime: (time: Date) => void;
  setIsOnline: (online: boolean) => void;
  startSync: () => void;
  completeSync: () => void;
  markOffline: () => void;
  markConflict: () => void;
}

export const SYNC_ICONS = {
  synced: 'Check',
  syncing: 'RefreshCw',
  offline: 'WifiOff',
  conflict: 'AlertTriangle',
} as const;

export const SYNC_COLORS = {
  synced: 'text-green-500',
  syncing: 'text-yellow-500',
  offline: 'text-gray-500',
  conflict: 'text-red-500',
} as const;
