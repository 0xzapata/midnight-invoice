import { create } from 'zustand';
import type { SyncState } from '@/types/sync';

export const useSyncStore = create<SyncState>((set) => ({
  status: 'synced',
  lastSyncTime: undefined,
  isOnline: true,
  setStatus: (status) => set({ status }),
  setLastSyncTime: (time) => set({ lastSyncTime: time }),
  setIsOnline: (online) => set({ isOnline: online }),
  startSync: () => set({ status: 'syncing' }),
  completeSync: () => set({ status: 'synced', lastSyncTime: new Date() }),
  markOffline: () => set({ status: 'offline' }),
  markConflict: () => set({ status: 'conflict' }),
}));
