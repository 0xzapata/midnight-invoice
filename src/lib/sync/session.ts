/**
 * Joining and leaving a cloud workspace. Leaving never deletes local data:
 * invoices and clients stay in this browser, only the link to the workspace
 * (token, cursors, queue, merge bases) and per-entity revisions are forgotten.
 */
import type { Workspace } from '../../../shared/api';
import { useCloudStore } from '@/stores/useCloudStore';
import { orderedCollections } from './collections';

export function joinWorkspace(workspace: Workspace, token: string): void {
  useCloudStore.setState({
    workspace,
    token,
    disconnectedReason: null,
    cursors: {},
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
    cursors: {},
    queue: [],
    bases: {},
    syncErrors: {},
    status: reason ? 'disconnected' : 'disabled',
    lastError: null,
  });
  // Revisions belong to the old workspace; a future workspace gets fresh uploads.
  for (const col of orderedCollections()) col.setAll(col.all().map((entity) => col.withoutServerState(entity)));
}
