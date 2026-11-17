/**
 * What the "Cloud sync & agents" settings do. All of them keep local data.
 */
import { TOKEN_PREFIX } from '../../../shared/api';
import { api } from '@/lib/api';
import { ApiError, isApiError } from '@/lib/api/errors';
import { useCloudStore } from '@/stores/useCloudStore';
import { adoptOrUploadSettings, enqueueAllLocalInvoices, enqueueSettings, syncNow, whenIdle } from './engine';
import { joinWorkspace, leaveWorkspace } from './session';

/** Workspace tokens: prefix + 43 base64url characters. */
const RECOVERY_KEY_RE = new RegExp(`^${TOKEN_PREFIX.workspace}[A-Za-z0-9_-]{20,200}$`);

export class InvalidRecoveryKeyError extends Error {
  constructor(message = 'That is not a valid recovery key. It starts with “mi_ws_”.') {
    super(message);
    this.name = 'InvalidRecoveryKeyError';
  }
}

/**
 * Turns cloud sync on: creates an anonymous workspace, then uploads the
 * default settings and every local invoice (drafts stay local).
 */
export async function enableCloudSync(): Promise<void> {
  const { workspace, token } = await api.createWorkspace();
  joinWorkspace(workspace, token);
  enqueueSettings();
  enqueueAllLocalInvoices();
  await syncNow();
}

/**
 * Links this browser to an existing workspace with its recovery key (the
 * workspace token). Validated with GET /workspace before anything is stored.
 * Server settings win if they were ever saved; local invoices are added to
 * the workspace (same-id conflicts are merged by the sync engine).
 */
export async function connectExistingWorkspace(rawKey: string): Promise<void> {
  const key = rawKey.trim();
  if (!RECOVERY_KEY_RE.test(key)) throw new InvalidRecoveryKeyError();
  let workspace;
  try {
    ({ workspace } = await api.getWorkspace(key));
  } catch (e) {
    if (isApiError(e, 401)) throw new InvalidRecoveryKeyError('This recovery key was not accepted. Check it, or the workspace may have been deleted.');
    throw e;
  }
  joinWorkspace(workspace, key);
  await adoptOrUploadSettings();
  enqueueAllLocalInvoices();
  await syncNow();
}

/** Forgets the workspace in this browser only. The cloud copy stays and is reachable with the recovery key. */
export async function disconnectThisBrowser(): Promise<void> {
  await whenIdle().catch(() => undefined);
  leaveWorkspace(null);
}

/**
 * Deletes the workspace on the server (all cloud invoices, settings and agent
 * connections) and disconnects this browser. Local invoices are kept.
 */
export async function deleteCloudWorkspace(): Promise<void> {
  const token = useCloudStore.getState().token;
  if (!token) return;
  await whenIdle().catch(() => undefined);
  try {
    // Explicit token: a 401 here means "already deleted", not "disconnected".
    await api.request<void>('DELETE', '/workspace', { auth: token });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  leaveWorkspace(null);
}

export const getRecoveryKey = (): string | null => useCloudStore.getState().token;
