/**
 * Cloud sync engine: mirrors useInvoiceStore (local-first source of truth)
 * and useSettingsStore with the workspace on the server, following the sync
 * contract in AGENT_API.md ("Sync semantics").
 *
 * One cycle = pull, then push:
 *  1. Pull `GET /invoices?include_deleted=true&updated_since=<cursor>`, paging
 *     with `next` until `hasMore` is false, applying every item by id
 *     (idempotent: `updated_since` is inclusive). Tombstones delete local
 *     copies. The cursor becomes `syncedAt` only after the last page.
 *  2. Push the queue of local changes in order. Invoices are uploaded with
 *     `PUT` + `If-Match: "<last known revision>"`, or `If-None-Match: *` if
 *     never uploaded; deletes with `DELETE` + `If-Match`.
 *
 * Rules:
 *  - Local writes apply immediately and are queued (persisted, so they survive
 *    reloads and offline periods). Repeated edits of one invoice coalesce into
 *    one queue entry that keeps its original position.
 *  - Transient failures (offline, 5xx, 429, write races) stop the queue at
 *    that entry and retry with exponential backoff (or `Retry-After`).
 *    Permanent failures (e.g. 400 validation) drop the entry, keep the invoice
 *    local-only and record why.
 *  - Deleted stays deleted: a tombstone or `410` drops the local copy, even if
 *    it had unsynced edits (the user is told).
 *  - `412` on an upload → fetch the server version and three-way merge against
 *    the last version both agreed on (see mergeContent): non-overlapping edits
 *    are combined, a field edited on both sides keeps the server's value. The
 *    user is told when changes were merged or discarded.
 *  - `412` on a delete (someone changed the invoice after this browser's last
 *    sync) → the newer server version is restored locally rather than deleting
 *    someone else's change; the user is told.
 *  - `401` → the workspace token is no longer valid: the browser is marked
 *    disconnected (src/lib/api/index.ts) and keeps all local data.
 */
import { toast } from 'sonner';
import type { Actor, Invoice } from '@/types/invoice';
import type { ApiInvoice } from '../../../shared/api';
import type { DefaultSettings } from '../../../shared/settings';
import { api } from '@/lib/api';
import { ApiError, describeError, isApiError, NetworkError } from '@/lib/api/errors';
import { useCloudStore, type PendingOp } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import {
  contentEquals,
  contentOf,
  FIELD_LABELS,
  fromApiInvoice,
  mergeContent,
  toInvoiceInput,
  type InvoiceContent,
} from './fields';
import { setLocalInvoiceChangeListener, type LocalInvoiceChange } from './localChanges';

/** How often the app pulls while the tab is visible (agents' changes show up within this). */
export const POLL_INTERVAL_MS = 15_000;
/** Delay between a local write and its upload, to batch bursts of edits. */
export const FLUSH_DELAY_MS = 400;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const MAX_CONFLICT_ROUNDS = 3;

// ---------------------------------------------------------------------------
// Module state (one engine per tab)
// ---------------------------------------------------------------------------

let running: Promise<void> | null = null;
let rerunRequested = false;
let rerunPullSettings = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemoteSettings = false;
let settingsPulledThisSession = false;
/** Why the queue is stuck, until an entry is pushed successfully. */
let queueBlocked: { status: 'offline' | 'error'; message: string } | null = null;

class SessionChanged extends Error {}

const cloud = () => useCloudStore.getState();

function assertSession(token: string): void {
  if (cloud().token !== token) throw new SessionChanged();
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function actorLabel(actor: Actor | undefined): string {
  if (actor?.type === 'agent') return actor.agentName ? `the agent “${actor.agentName}”` : 'an agent';
  return 'another device';
}

function listFields(fields: readonly (keyof typeof FIELD_LABELS)[]): string {
  const labels = fields.map((f) => FIELD_LABELS[f]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const notices = {
  deletedElsewhere(invoiceNumber: string, by: Actor | undefined) {
    toast.warning(by ? `${invoiceNumber} was deleted by ${actorLabel(by)}` : `${invoiceNumber} was deleted elsewhere`, {
      description: 'Your unsynced changes to it were discarded. Deleted invoices stay deleted.',
    });
  },
  deletedByAgent(invoiceNumber: string, by: Actor | undefined) {
    toast.info(`${invoiceNumber} was deleted by ${actorLabel(by)}`);
  },
  merged(invoiceNumber: string, by: Actor | undefined) {
    toast.info(`${invoiceNumber} was also changed by ${actorLabel(by)}`, {
      description: 'Both sets of changes were kept.',
    });
  },
  lost(invoiceNumber: string, by: Actor | undefined, fields: readonly (keyof typeof FIELD_LABELS)[]) {
    toast.warning(`Some of your changes to ${invoiceNumber} were not applied`, {
      description: `${actorLabel(by)[0].toUpperCase()}${actorLabel(by).slice(1)} changed the ${listFields(fields)} at the same time; the newer version was kept.`,
    });
  },
  restored(invoiceNumber: string, by: Actor | undefined) {
    toast.warning(`${invoiceNumber} was kept`, {
      description: `It was changed by ${actorLabel(by)} after this browser last synced, so it was not deleted. Delete it again if you still want it gone.`,
    });
  },
  rejected(invoiceNumber: string, message: string) {
    toast.error(`${invoiceNumber} could not be synced`, {
      description: `${message} It stays in this browser only; edit and save it to try again.`,
    });
  },
  settingsRejected(message: string) {
    toast.error('Default settings could not be synced', { description: message });
  },
};

// ---------------------------------------------------------------------------
// Local state helpers (these bypass the store actions, so they are not queued)
// ---------------------------------------------------------------------------

function getLocal(id: string): Invoice | undefined {
  return useInvoiceStore.getState().invoices.find((inv) => inv.id === id);
}

function replaceLocal(id: string, next: Invoice, insertIfMissing = true): void {
  useInvoiceStore.setState((state) => {
    const index = state.invoices.findIndex((inv) => inv.id === id);
    if (index < 0) return insertIfMissing ? { invoices: [next, ...state.invoices] } : {};
    const invoices = [...state.invoices];
    invoices[index] = next;
    return { invoices };
  });
}

function removeLocal(id: string): void {
  useInvoiceStore.setState((state) => ({ invoices: state.invoices.filter((inv) => inv.id !== id) }));
}

function setBase(id: string, content: InvoiceContent | null): void {
  useCloudStore.setState((state) => {
    const bases = { ...state.bases };
    if (content) bases[id] = content;
    else delete bases[id];
    return { bases };
  });
}

function setSyncError(id: string, message: string | null): void {
  useCloudStore.setState((state) => {
    if (message === null && !(id in state.syncErrors)) return {};
    const syncErrors = { ...state.syncErrors };
    if (message === null) delete syncErrors[id];
    else syncErrors[id] = message;
    return { syncErrors };
  });
}

function baseOf(id: string): InvoiceContent | null {
  const base = cloud().bases[id];
  return base ? (base as InvoiceContent) : null;
}

/** Local copy := server version (keeps the list position). */
function adoptServer(server: ApiInvoice): void {
  replaceLocal(server.id, fromApiInvoice(server));
  setBase(server.id, contentOf(server));
  setSyncError(server.id, null);
}

/** Drops an invoice the server says is deleted, with everything queued for it. */
function dropDeleted(id: string): void {
  removeLocal(id);
  setBase(id, null);
  setSyncError(id, null);
  useCloudStore.setState((state) => ({ queue: state.queue.filter((op) => op.invoiceId !== id) }));
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function newOp(partial: Pick<PendingOp, 'type'> & Partial<PendingOp>): PendingOp {
  return { opId: crypto.randomUUID(), seq: 0, attempts: 0, notBefore: 0, ...partial };
}

/** Queues the upload of a local invoice (created or edited). */
export function enqueueInvoiceUpsert(id: string): void {
  if (!cloud().token) return;
  useCloudStore.setState((state) => {
    const index = state.queue.findIndex((op) => op.invoiceId === id && op.type !== 'settings');
    const queue = [...state.queue];
    if (index >= 0) {
      const current = queue[index];
      queue[index] = { ...current, type: 'upsert', baseRevision: undefined, seq: current.seq + 1, notBefore: 0 };
    } else {
      queue.push(newOp({ type: 'upsert', invoiceId: id }));
    }
    const syncErrors = { ...state.syncErrors };
    delete syncErrors[id];
    return { queue, syncErrors };
  });
  scheduleFlush();
}

/** Queues the deletion of an invoice the user deleted locally. */
export function enqueueInvoiceDelete(invoice: Invoice): void {
  if (!cloud().token) return;
  useCloudStore.setState((state) => {
    const index = state.queue.findIndex((op) => op.invoiceId === invoice.id && op.type !== 'settings');
    const queue = [...state.queue];
    const neverUploaded = invoice.revision === undefined;
    const del = newOp({
      type: 'delete',
      invoiceId: invoice.id,
      baseRevision: invoice.revision,
      invoiceNumber: invoice.invoiceNumber,
    });
    if (index >= 0) {
      const current = queue[index];
      // A pending upload of an invoice the server never saw: nothing to delete there.
      if (current.type === 'upsert' && neverUploaded && !(invoice.id in state.bases)) queue.splice(index, 1);
      else queue[index] = { ...del, opId: current.opId, seq: current.seq + 1 };
    } else if (!(neverUploaded && invoice.id in state.syncErrors)) {
      queue.push(del);
    }
    const syncErrors = { ...state.syncErrors };
    delete syncErrors[invoice.id];
    return { queue, syncErrors };
  });
  scheduleFlush();
}

/** Queues uploading the default settings (coalesced). */
export function enqueueSettings(): void {
  if (!cloud().token) return;
  useCloudStore.setState((state) => {
    const index = state.queue.findIndex((op) => op.type === 'settings');
    const queue = [...state.queue];
    if (index >= 0) queue[index] = { ...queue[index], seq: queue[index].seq + 1, notBefore: 0 };
    else queue.push(newOp({ type: 'settings' }));
    return { queue };
  });
  scheduleFlush();
}

/** Queues every local invoice (oldest first) for upload, e.g. after joining a workspace. */
export function enqueueAllLocalInvoices(): void {
  // The store lists newest first; reverse so ties keep creation order, then sort (stable) by createdAt.
  const invoices = [...useInvoiceStore.getState().invoices].reverse().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const invoice of invoices) enqueueInvoiceUpsert(invoice.id);
}

function removeOpIfUnchanged(opId: string, seq: number): void {
  useCloudStore.setState((state) => ({ queue: state.queue.filter((op) => !(op.opId === opId && op.seq === seq)) }));
}

function currentOp(opId: string): PendingOp | undefined {
  return cloud().queue.find((op) => op.opId === opId);
}

function backoffDelay(attempts: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) return Math.max(1_000, error.retryAfterMs);
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp * (0.8 + Math.random() * 0.4));
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/** Applies one page of the delta feed. Exported for tests. */
export function applyServerInvoices(items: ApiInvoice[]): void {
  for (const server of items) {
    const pending = cloud().queue.find((op) => op.invoiceId === server.id && op.type !== 'settings');
    const local = getLocal(server.id);

    if (server.deletedAt) {
      if (local || pending) {
        dropDeleted(server.id);
        if (pending?.type === 'upsert') notices.deletedElsewhere(local?.invoiceNumber ?? server.invoiceNumber, server.updatedBy);
        else if (!pending && local && server.updatedBy?.type === 'agent') notices.deletedByAgent(local.invoiceNumber, server.updatedBy);
      } else {
        setBase(server.id, null);
      }
      continue;
    }
    // Local changes are waiting to be uploaded: the push resolves them against this version.
    if (pending) continue;
    if (local?.revision !== undefined && local.revision >= server.revision) continue;
    adoptServer(server);
  }
}

async function pull(token: string): Promise<void> {
  const cursor = cloud().cursor;
  let page = await api.listInvoices({ includeDeleted: true, updatedSince: cursor ?? undefined });
  for (;;) {
    assertSession(token);
    applyServerInvoices(page.invoices);
    if (!page.hasMore || !page.next) {
      useCloudStore.setState({ cursor: page.syncedAt });
      return;
    }
    page = await api.listInvoices({ includeDeleted: true, updatedSince: page.next.updated_since, afterId: page.next.after_id });
  }
}

function applyRemoteSettings(settings: DefaultSettings): void {
  applyingRemoteSettings = true;
  try {
    useSettingsStore.getState().updateSettings(settings);
  } finally {
    applyingRemoteSettings = false;
  }
}

/** Server settings win if they were ever saved and nothing local is waiting to be uploaded. */
async function pullSettings(token: string): Promise<void> {
  const remote = await api.getSettings();
  assertSession(token);
  if (remote.updatedAt === null) return;
  if (cloud().queue.some((op) => op.type === 'settings')) return;
  applyRemoteSettings(remote.settings);
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

const isPermanent = (e: unknown) =>
  e instanceof ApiError && e.status !== 401 && e.status !== 410 && e.status !== 412 && !e.isTransient;

/** After a successful write: adopt the server's copy unless the user edited it meanwhile. */
function acceptWrite(op: PendingOp, seqAtStart: number, server: ApiInvoice): void {
  const latest = currentOp(op.opId);
  if (latest?.seq === seqAtStart) {
    adoptServer(server);
    return;
  }
  setBase(server.id, contentOf(server));
  const local = getLocal(server.id);
  if (!local) {
    // Deleted here while the upload was in flight: delete the copy we just created.
    if (latest?.type === 'delete') {
      useCloudStore.setState((state) => ({
        queue: state.queue.map((q) => (q.opId === op.opId ? { ...q, baseRevision: server.revision } : q)),
      }));
    } else if (!latest) {
      useCloudStore.setState((state) => ({
        queue: [...state.queue, newOp({ type: 'delete', invoiceId: server.id, baseRevision: server.revision, invoiceNumber: server.invoiceNumber })],
      }));
    }
    return;
  }
  // Edited here while the upload was in flight: keep the newer local content, learn the revision.
  replaceLocal(server.id, {
    ...local,
    revision: server.revision,
    updatedAt: server.updatedAt,
    createdAt: server.createdAt,
    createdBy: server.createdBy,
    updatedBy: server.updatedBy,
  }, false);
}

/**
 * The server copy changed since this browser's last sync (412): merge.
 * Returns 'done' when nothing of ours is left to upload, 'retry' to PUT the
 * merged content with the server's revision.
 */
async function resolveUpsertConflict(id: string, token: string): Promise<'done' | 'retry'> {
  let server: ApiInvoice;
  try {
    server = (await api.getInvoice(id)).invoice;
  } catch (e) {
    if (isApiError(e, 410)) {
      const local = getLocal(id);
      dropDeleted(id);
      notices.deletedElsewhere(local?.invoiceNumber ?? 'An invoice', undefined);
      return 'done';
    }
    if (isApiError(e, 404)) {
      // We knew a revision the server no longer has: upload it as new.
      const local = getLocal(id);
      if (local) {
        const { revision: _r, ...rest } = local;
        replaceLocal(id, rest, false);
      }
      setBase(id, null);
      return 'retry';
    }
    throw e;
  }
  assertSession(token);
  const local = getLocal(id);
  if (!local) return 'done';

  const base = baseOf(id);
  const serverContent = contentOf(server);
  const { merged, conflicts } = mergeContent(base, contentOf(local), serverContent);
  if (conflicts.length > 0) notices.lost(local.invoiceNumber, server.updatedBy, conflicts);

  if (contentEquals(merged, serverContent)) {
    adoptServer(server);
    return 'done';
  }
  if (conflicts.length === 0 && base !== null && !contentEquals(base, serverContent)) {
    notices.merged(local.invoiceNumber, server.updatedBy);
  }
  replaceLocal(id, {
    ...fromApiInvoice(server),
    ...merged,
    invoiceName: merged.invoiceName || local.invoiceName,
  }, false);
  setBase(id, serverContent);
  return 'retry';
}

async function pushUpsert(op: PendingOp, token: string): Promise<void> {
  const id = op.invoiceId!;
  const seqAtStart = op.seq;
  for (let round = 0; round <= MAX_CONFLICT_ROUNDS; round++) {
    const local = getLocal(id);
    if (!local) return;
    try {
      const { invoice } = await api.putInvoice(
        id,
        toInvoiceInput(local),
        local.revision !== undefined ? { ifMatch: local.revision } : { ifNoneMatch: true },
      );
      assertSession(token);
      acceptWrite(op, seqAtStart, invoice);
      return;
    } catch (e) {
      if (e instanceof SessionChanged) throw e;
      if (isApiError(e, 410)) {
        dropDeleted(id);
        notices.deletedElsewhere(local.invoiceNumber, undefined);
        return;
      }
      if (isApiError(e, 412)) {
        if ((await resolveUpsertConflict(id, token)) === 'done') return;
        continue;
      }
      if (isPermanent(e)) {
        const message = describeRejection(e as ApiError);
        setSyncError(id, message);
        notices.rejected(local.invoiceNumber, message);
        return;
      }
      throw e;
    }
  }
  // Someone keeps changing it under us: try again later.
  throw new ApiError(409, 'conflict', 'The invoice is being changed elsewhere; retrying shortly');
}

async function pushDelete(op: PendingOp, token: string): Promise<void> {
  const id = op.invoiceId!;
  try {
    await api.deleteInvoice(id, op.baseRevision !== undefined ? { ifMatch: op.baseRevision } : {});
    setBase(id, null);
  } catch (e) {
    if (isApiError(e, 404) || isApiError(e, 410)) {
      setBase(id, null);
      return;
    }
    if (!isApiError(e, 412)) {
      if (isPermanent(e)) return;
      throw e;
    }
    // Changed (or already deleted) after our last sync.
    let server: ApiInvoice;
    try {
      server = (await api.getInvoice(id)).invoice;
    } catch (inner) {
      if (isApiError(inner, 410) || isApiError(inner, 404)) {
        setBase(id, null);
        return;
      }
      throw inner;
    }
    assertSession(token);
    adoptServer(server);
    notices.restored(server.invoiceNumber, server.updatedBy);
  }
}

async function pushSettings(): Promise<void> {
  try {
    await api.putSettings(useSettingsStore.getState().settings);
  } catch (e) {
    if (isPermanent(e)) {
      notices.settingsRejected(describeRejection(e as ApiError));
      return;
    }
    throw e;
  }
}

function describeRejection(e: ApiError): string {
  if (e.code === 'validation_failed' && Array.isArray(e.details) && e.details.length > 0) {
    const first = e.details[0] as { path?: string; message?: string };
    return `${first.message ?? 'Invalid value'}${first.path ? ` (${first.path})` : ''}.`;
  }
  return e.message.endsWith('.') ? e.message : `${e.message}.`;
}

/** Pushes queued changes in order; stops at the first transient failure. */
async function flushQueue(token: string): Promise<void> {
  for (;;) {
    assertSession(token);
    const op = cloud().queue[0];
    if (!op) return;
    if (op.notBefore > Date.now()) {
      scheduleRetry(op.notBefore - Date.now());
      return;
    }
    const seqAtStart = op.seq;
    try {
      if (op.type === 'upsert') await pushUpsert(op, token);
      else if (op.type === 'delete') await pushDelete(op, token);
      else await pushSettings();
      assertSession(token);
      removeOpIfUnchanged(op.opId, seqAtStart);
      queueBlocked = null;
    } catch (e) {
      if (e instanceof SessionChanged || isApiError(e, 401)) throw e;
      const attempts = op.attempts + 1;
      const delay = backoffDelay(attempts, e);
      useCloudStore.setState((state) => ({
        queue: state.queue.map((q) => (q.opId === op.opId ? { ...q, attempts, notBefore: Date.now() + delay } : q)),
      }));
      queueBlocked = { status: e instanceof NetworkError ? 'offline' : 'error', message: describeError(e) };
      scheduleRetry(delay);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

async function runCycle(pullSettingsToo: boolean): Promise<void> {
  const token = cloud().token;
  if (!token) return;
  cloud().setRuntime({ status: 'syncing' });
  try {
    if (pullSettingsToo || !settingsPulledThisSession) {
      await pullSettings(token);
      settingsPulledThisSession = true;
    }
    await pull(token);
    await flushQueue(token);
    assertSession(token);
    if (queueBlocked && cloud().queue.length > 0) {
      cloud().setRuntime({ status: queueBlocked.status, lastError: queueBlocked.message });
    } else {
      queueBlocked = null;
      cloud().setRuntime({ status: 'synced', lastError: null, lastSyncedAt: new Date().toISOString() });
    }
  } catch (e) {
    if (e instanceof SessionChanged) return;
    if (isApiError(e, 401)) return; // leaveWorkspace() already updated the status
    const offline = e instanceof NetworkError;
    if (cloud().token === token) cloud().setRuntime({ status: offline ? 'offline' : 'error', lastError: describeError(e) });
    if (!offline) scheduleRetry(backoffDelay(1, e));
  }
}

/**
 * Runs a sync cycle now (single-flight: calls during a cycle schedule one
 * more cycle right after). `force` clears backoff, for a manual "Retry".
 */
export function syncNow(opts: { force?: boolean; pullSettings?: boolean } = {}): Promise<void> {
  if (!cloud().token) return Promise.resolve();
  if (opts.force) {
    useCloudStore.setState((state) => ({ queue: state.queue.map((op) => ({ ...op, notBefore: 0 })) }));
  }
  if (running) {
    rerunRequested = true;
    rerunPullSettings ||= !!opts.pullSettings;
    return running;
  }
  running = (async () => {
    let pullSettingsToo = !!opts.pullSettings;
    do {
      rerunRequested = false;
      await runCycle(pullSettingsToo);
      pullSettingsToo = rerunPullSettings;
      rerunPullSettings = false;
    } while (rerunRequested && cloud().token);
  })().finally(() => {
    running = null;
  });
  return running;
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void syncNow();
  }, FLUSH_DELAY_MS);
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow();
  }, Math.max(250, delayMs));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function onLocalInvoiceChange(change: LocalInvoiceChange): void {
  if (change.type === 'upsert') enqueueInvoiceUpsert(change.id);
  else enqueueInvoiceDelete(change.invoice);
}

/**
 * Connects the stores to the engine: user edits get queued, settings changes
 * get uploaded. Returns a function that disconnects them again.
 */
export function startCloudSync(): () => void {
  setLocalInvoiceChangeListener(onLocalInvoiceChange);
  const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
    if (state.settings !== prev.settings && !applyingRemoteSettings) enqueueSettings();
  });
  return () => {
    setLocalInvoiceChangeListener(null);
    unsubscribeSettings();
    if (flushTimer) clearTimeout(flushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    flushTimer = null;
    retryTimer = null;
  };
}

/** Settings from the server (when joining an existing workspace). */
export async function adoptOrUploadSettings(): Promise<void> {
  const token = cloud().token;
  if (!token) return;
  const remote = await api.getSettings();
  assertSession(token);
  if (remote.updatedAt !== null) applyRemoteSettings(remote.settings);
  else enqueueSettings();
  settingsPulledThisSession = true;
}

/** Waits for the running cycle, if any (tests, and actions that need a settled state). */
export function whenIdle(): Promise<void> {
  return running ?? Promise.resolve();
}

/** Test helper: forget timers and in-memory state between tests. */
export function resetSyncEngineForTests(): void {
  if (flushTimer) clearTimeout(flushTimer);
  if (retryTimer) clearTimeout(retryTimer);
  flushTimer = null;
  retryTimer = null;
  running = null;
  rerunRequested = false;
  rerunPullSettings = false;
  applyingRemoteSettings = false;
  settingsPulledThisSession = false;
  queueBlocked = null;
}
