import { useSyncStore } from '@/stores/useSyncStore';
import { useEffect } from 'react';
import { SYNC_ICONS, SYNC_COLORS, type SyncStatus } from '@/types/sync';

export function useSyncStatus() {
  const { status, isOnline, lastSyncTime } = useSyncStore();

  useEffect(() => {
    const handleOnline = () => useSyncStore.getState().setIsOnline(true);
    const handleOffline = () => useSyncStore.getState().markOffline();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    status,
    isOnline,
    lastSyncTime,
    icon: SYNC_ICONS[status],
    color: SYNC_COLORS[status],
    isSynced: status === 'synced',
    isSyncing: status === 'syncing',
    isOffline: status === 'offline',
    isConflict: status === 'conflict',
  };
}
