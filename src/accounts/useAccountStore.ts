import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCloudStore } from '@/stores/useCloudStore';

export interface LinkedAccount {
  userId: string;
  email: string;
  /** Id of this browser's device token (the token itself lives in the cloud store, like any workspace token). */
  deviceId: string;
  workspaceId: string;
}

interface AccountState {
  /** Set while this browser syncs with a device token of a signed-in account. A hint for the UI; the server is the truth. */
  linked: LinkedAccount | null;
  setLinked: (linked: LinkedAccount | null) => void;
}

export const ACCOUNT_STORAGE_KEY = 'account-storage';

/**
 * Which account (if any) this browser's cloud token belongs to. Optional
 * user accounts never change how sync works: the cloud store still holds one
 * workspace token; for a signed-in browser it is this device's own token.
 */
export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      linked: null,
      setLinked: (linked) => set({ linked }),
    }),
    { name: ACCOUNT_STORAGE_KEY, version: 1, partialize: (s) => ({ linked: s.linked }) },
  ),
);

// When the browser leaves the workspace (disconnect, deletion, or the server
// rejected the token after "sign out other devices"), the link is gone too.
useCloudStore.subscribe((state, prev) => {
  if (prev.token && !state.token && useAccountStore.getState().linked) useAccountStore.getState().setLinked(null);
});

export const useLinkedAccount = () => useAccountStore((s) => s.linked);
