import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  CURRENT_CLOUD_VERSION,
  EMPTY_CLOUD_STATE,
  migrateCloudStore,
  type CloudPersistedState,
  type PendingOp,
} from '@/lib/storageMigrations';

export type { PendingOp };

/**
 * What the header shows. `disabled` = cloud sync never turned on (the app is
 * purely local, as before); `disconnected` = the server rejected this
 * browser's key.
 */
export type SyncStatus = 'disabled' | 'disconnected' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface CloudRuntimeState {
  status: SyncStatus;
  /** User-facing description of the last failure. Never contains the token. */
  lastError: string | null;
  /** When the last full sync (pull + push) finished, ISO. */
  lastSyncedAt: string | null;
}

export type CloudState = CloudPersistedState &
  CloudRuntimeState & {
    setRuntime: (patch: Partial<CloudRuntimeState>) => void;
  };

export const CLOUD_STORAGE_KEY = 'cloud-sync-storage';

/**
 * Cloud sync & agents state (opt-in). Holds the anonymous workspace this
 * browser belongs to, its bearer token (the "recovery key"), the delta-sync
 * cursors and the queue of local changes waiting to be uploaded. Invoices and
 * clients themselves stay in useInvoiceStore / useClientStore, the
 * local-first source of truth; the sync engine (src/lib/sync/engine.ts)
 * moves changes between them and the server.
 */
export const useCloudStore = create<CloudState>()(
  persist(
    (set) => ({
      ...EMPTY_CLOUD_STATE,
      status: 'disabled',
      lastError: null,
      lastSyncedAt: null,
      setRuntime: (patch) => set(patch),
    }),
    {
      name: CLOUD_STORAGE_KEY,
      version: CURRENT_CLOUD_VERSION,
      migrate: migrateCloudStore,
      partialize: (state): CloudPersistedState => ({
        workspace: state.workspace,
        token: state.token,
        disconnectedReason: state.disconnectedReason,
        cursors: state.cursors,
        queue: state.queue,
        bases: state.bases,
        syncErrors: state.syncErrors,
      }),
      merge: (persisted, current) => {
        const restored = { ...current, ...(persisted as Partial<CloudPersistedState>) };
        return {
          ...restored,
          status: restored.token ? 'idle' : restored.disconnectedReason ? 'disconnected' : 'disabled',
        };
      },
    },
  ),
);

/** True when this browser syncs with a cloud workspace. */
export const isCloudEnabled = (state: Pick<CloudState, 'token'> = useCloudStore.getState()) => !!state.token;

export const useCloudEnabled = () => useCloudStore((s) => !!s.token);
