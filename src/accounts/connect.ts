/**
 * What happens in this browser after signing in (and the account actions
 * that touch the cloud store). The rules, in order:
 *
 * 1. Account has no workspace, browser has none      → create one for the account and upload
 *    this browser's invoices, clients and settings (= turning cloud sync on).
 * 2. Account has no workspace, browser syncs with an anonymous workspace → claim it (owner);
 *    the browser switches to its own device token, the recovery key keeps working.
 * 3. Account has workspace W, browser already syncs with W → swap to a device token, nothing else.
 * 4. Account has W, browser has nothing local         → connect and pull everything.
 * 5. Account has W, browser has local-only invoices/clients/templates → ASK: upload them into W
 *    (merged by the sync engine like a recovery-key connect), or cancel (sign out).
 * 6. Account has W, browser syncs with a different workspace V (or V belongs to another
 *    account) → ASK: switch to W and copy this browser's invoices into it, or cancel.
 *    V on the server is never touched or merged; it stays reachable with its recovery key.
 *
 * Local invoices are never discarded silently, and two server workspaces are never merged.
 */
import type { AccountSessionResponse, DeviceTokenResponse } from '../../shared/accounts';
import { adoptOrUploadSettings, enqueueAllLocal, enqueueSettings, syncNow, whenIdle } from '@/lib/sync/engine';
import { orderedCollections } from '@/lib/sync/collections';
import { joinWorkspace, leaveWorkspace } from '@/lib/sync/session';
import { useCloudStore } from '@/stores/useCloudStore';
import { accountApi, isAccountError } from './api';
import { useAccountStore } from './useAccountStore';

/** Local entities per synced collection (invoices, clients, templates, … in SYNCED_COLLECTIONS). */
export interface LocalCounts {
  invoices: number;
  clients: number;
  templates: number;
}

export interface LocalSituation {
  token: string | null;
  workspaceId: string | null;
  linkedUserId: string | null;
  counts: LocalCounts;
}

export type ConnectPlan =
  | { kind: 'create' }
  | { kind: 'claim' }
  | { kind: 'rebind' }
  | { kind: 'join' }
  | { kind: 'merge-local'; counts: LocalCounts }
  | { kind: 'switch-workspace'; target: 'existing' | 'new'; counts: LocalCounts };

export const hasLocalData = (c: LocalCounts) => c.invoices + c.clients + c.templates > 0;

export function localSituation(): LocalSituation {
  const cloud = useCloudStore.getState();
  const counts: LocalCounts = { invoices: 0, clients: 0, templates: 0 };
  // Every synced collection is uploaded by enqueueAllLocal (referenced collections first,
  // so a template's or invoice's clientId still points at an uploaded client).
  for (const col of orderedCollections()) {
    if (col.name in counts) counts[col.name as keyof LocalCounts] = col.all().length;
  }
  return {
    token: cloud.token,
    workspaceId: cloud.workspace?.id ?? null,
    linkedUserId: useAccountStore.getState().linked?.userId ?? null,
    counts,
  };
}

/** Pure decision (tested): what to do in this browser for this signed-in account. */
export function planConnection(session: Pick<AccountSessionResponse, 'user' | 'workspace'>, local: LocalSituation): ConnectPlan {
  const accountWs = session.workspace?.id ?? null;
  const foreignLink = local.linkedUserId !== null && local.linkedUserId !== session.user.id;
  if (!accountWs) {
    if (!local.token) return { kind: 'create' };
    // A device token of another account cannot be claimed: offer a fresh workspace instead.
    return foreignLink ? { kind: 'switch-workspace', target: 'new', counts: local.counts } : { kind: 'claim' };
  }
  if (local.token && local.workspaceId === accountWs) return { kind: 'rebind' };
  if (local.token) return { kind: 'switch-workspace', target: 'existing', counts: local.counts };
  return hasLocalData(local.counts) ? { kind: 'merge-local', counts: local.counts } : { kind: 'join' };
}

export const needsChoice = (p: ConnectPlan) => p.kind === 'merge-local' || p.kind === 'switch-workspace';

function link(session: Pick<AccountSessionResponse, 'user'>, res: DeviceTokenResponse) {
  useAccountStore.getState().setLinked({ userId: session.user.id, email: session.user.email, deviceId: res.deviceId, workspaceId: res.workspace.id });
}

/** Connects the browser to `res` and uploads everything local (the engine merges same-id conflicts). */
async function joinAndUpload(res: DeviceTokenResponse, settings: 'adopt' | 'upload') {
  joinWorkspace({ id: res.workspace.id, createdAt: res.workspace.createdAt }, res.token);
  if (settings === 'adopt') await adoptOrUploadSettings();
  else enqueueSettings();
  enqueueAllLocal();
  await syncNow();
}

export type ConnectOutcome = 'created' | 'claimed' | 'rebound' | 'joined' | 'merged' | 'switched';

/**
 * Carries out a plan (after the user chose, for the plans that ask). Returns
 * what happened; a claim that turns out to be impossible (the workspace
 * belongs to another account) throws so the caller can offer a switch.
 */
export async function executePlan(session: Pick<AccountSessionResponse, 'user'>, plan: ConnectPlan): Promise<ConnectOutcome> {
  const current = useCloudStore.getState().token;
  switch (plan.kind) {
    case 'create': {
      const res = await accountApi.createWorkspace();
      await joinAndUpload(res, 'upload');
      link(session, res);
      return 'created';
    }
    case 'claim': {
      const res = await accountApi.claim(current!);
      // Same workspace, same cursors and queue: only the credential changes.
      useCloudStore.setState({ token: res.token });
      link(session, res);
      return 'claimed';
    }
    case 'rebind': {
      const res = await accountApi.connect(current);
      useCloudStore.setState({ token: res.token });
      link(session, res);
      return 'rebound';
    }
    case 'join':
    case 'merge-local': {
      const res = await accountApi.connect(null);
      await joinAndUpload(res, 'adopt');
      link(session, res);
      return plan.kind === 'join' ? 'joined' : 'merged';
    }
    case 'switch-workspace': {
      await whenIdle().catch(() => undefined);
      const res = plan.target === 'existing' ? await accountApi.connect(current) : await accountApi.createWorkspace();
      // Forget the other workspace here (its server copy is untouched), keep every local entity.
      leaveWorkspace(null);
      await joinAndUpload(res, plan.target === 'existing' ? 'adopt' : 'upload');
      link(session, res);
      return 'switched';
    }
  }
}

/** True when a claim failed because the workspace belongs to someone else. */
export const isOwnedElsewhere = (e: unknown) => isAccountError(e, 409, 'workspace_owned');

/**
 * Signs this browser out: revokes its session and device token on the server,
 * then leaves the workspace locally. Invoices stay in this browser.
 */
export async function signOutThisBrowser(): Promise<void> {
  await whenIdle().catch(() => undefined);
  const linked = useAccountStore.getState().linked;
  const token = linked ? useCloudStore.getState().token : null;
  try {
    await accountApi.signOut(token);
  } catch (e) {
    // Already signed out / token already revoked (401), or accounts turned off / unavailable
    // (404 / 503): nothing more to do on the server; still leave the workspace here.
    if (!isAccountError(e, 401) && !isAccountError(e, 404) && !isAccountError(e, 503)) throw e;
  }
  if (linked) leaveWorkspace(null);
  useAccountStore.getState().setLinked(null);
}

/** After "delete account" with the workspace kept: continue anonymously with the returned recovery key. */
export function continueAnonymously(recoveryKey: string | null): void {
  useAccountStore.getState().setLinked(null);
  if (recoveryKey && useCloudStore.getState().token) useCloudStore.setState({ token: recoveryKey });
  else leaveWorkspace(null);
}
