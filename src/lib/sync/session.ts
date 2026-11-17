/**
 * Joining and leaving a cloud workspace. Leaving never deletes local data:
 * invoices stay in this browser, only the link to the workspace (token,
 * cursor, queue, merge bases) and per-invoice revisions are forgotten.
 */
import type { Workspace } from '../../../shared/api';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { withoutServerState } from './fields';

export function joinWorkspace(workspace: Workspace, token: string): void {
  useCloudStore.setState({
    workspace,
    token,
    disconnectedReason: null,
    cursor: null,
    queue: [],
    bases: {},
    syncErrors: {},
    status: 'idle',
    lastError: null,
    lastSyncedAt: null,
  });
}

/**
 * Forgets the workspace in this browser. `token_rejected` = the server no
 * longer accepts the key (shown as "disconnected"); otherwise the user chose
 * to leave and the app returns to purely local mode.
 */
export function leaveWorkspace(reason: 'token_rejected' | null = null): void {
  useCloudStore.setState({
    workspace: null,
    token: null,
    disconnectedReason: reason,
    cursor: null,
    queue: [],
    bases: {},
    syncErrors: {},
    status: reason ? 'disconnected' : 'disabled',
    lastError: null,
  });
  // Revisions belong to the old workspace; a future workspace gets fresh uploads.
  useInvoiceStore.setState((state) => ({ invoices: state.invoices.map(withoutServerState) }));
}
