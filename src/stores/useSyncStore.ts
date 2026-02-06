import { create } from 'zustand';
import type { SyncState, SyncStatus } from '@/types/sync';

interface SyncStore extends SyncState {}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'synced' as SyncStatus,
  lastSyncTime: undefined,
  isOnline: true,
  setStatus: (status: SyncStatus) => set({ status }),
  setLastSyncTime: (time: Date) => set({ lastSyncTime: time }),
  setIsOnline: (online: boolean) => set({ isOnline: online }),
  startSync: () => set({ status: 'syncing' }),
  completeSync: () => set({ status: 'synced', lastSyncTime: new Date() }),
  markOffline: () => set({ status: 'offline' }),
  markConflict: () => set({ status: 'conflict' }),
}));
