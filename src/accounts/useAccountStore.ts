import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCloudStore } from '@/stores/useCloudStore';
import { accountApi } from './api';

export interface LinkedAccount {
  userId: string;
  email: string;
  /** Id of this browser's device token (the token itself lives in the cloud store, like any workspace token). */
  deviceId: string;
  workspaceId: string;
}

/** Why a signed-in browser stopped syncing (the server rejected its device token). */
export interface SignedOutNotice {
  email: string;
  /** `revoked`: signed out from another device / everywhere; `account_disabled`: by the site operator. */
  reason: 'checking' | 'revoked' | 'account_disabled' | 'unknown';
}

interface AccountState {
  /** Set while this browser syncs with a device token of a signed-in account. A hint for the UI; the server is the truth. */
  linked: LinkedAccount | null;
  signedOut: SignedOutNotice | null;
  setLinked: (linked: LinkedAccount | null) => void;
  dismissSignedOut: () => void;
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
      signedOut: null,
      setLinked: (linked) => set(linked ? { linked, signedOut: null } : { linked }),
      dismissSignedOut: () => set({ signedOut: null }),
    }),
    { name: ACCOUNT_STORAGE_KEY, version: 1, partialize: (s) => ({ linked: s.linked, signedOut: s.signedOut }) },
  ),
);

// When the browser leaves the workspace (disconnect, deletion, or the server rejected the token
// after "sign out other devices" / an operator disabling the account), the link is gone too. For a
// rejected device token, ask the server why (the token itself is the proof) so the app can say so.
useCloudStore.subscribe((state, prev) => {
  if (!prev.token && state.token && useAccountStore.getState().signedOut) useAccountStore.setState({ signedOut: null });
  if (!prev.token || state.token) return;
  const { linked } = useAccountStore.getState();
  if (!linked) return;
  if (state.disconnectedReason !== 'token_rejected') {
    useAccountStore.setState({ linked: null });
    return;
  }
  useAccountStore.setState({ linked: null, signedOut: { email: linked.email, reason: 'checking' } });
  const rejected = prev.token;
  void accountApi
    .deviceStatus(rejected)
    .then(({ status }) => (status === 'revoked' || status === 'account_disabled' ? status : 'unknown'))
    .catch(() => 'unknown' as const)
    .then((reason) => {
      const current = useAccountStore.getState().signedOut;
      if (current?.reason === 'checking') useAccountStore.setState({ signedOut: { ...current, reason } });
    });
});

export const useLinkedAccount = () => useAccountStore((s) => s.linked);
