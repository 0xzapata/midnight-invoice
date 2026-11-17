/**
 * Cloud sync engine: mirrors the local-first stores of every synced
 * collection (clients, templates, invoices — see collections/) and useSettingsStore with
 * the workspace on the server, following the sync contract in AGENT_API.md
 * ("Sync semantics"). The engine is collection-agnostic; each collection is a
 * descriptor (collection.ts) registered in collections/index.ts.
 *
 * One cycle = pull, then push:
 *  1. Pull each collection, in dependency order (SYNCED_COLLECTIONS):
 *     `GET /<collection>?include_deleted=true&updated_since=<cursor>`, paging
 *     with `next` until `hasMore` is false, applying every item by id
 *     (idempotent: `updated_since` is inclusive). Tombstones delete local
 *     copies. A collection's cursor becomes `syncedAt` only after its last page.
 *  2. Push the single queue of local changes (all collections + settings) in
 *     order. Entities are uploaded with `PUT` + `If-Match: "<last known
 *     revision>"`, or `If-None-Match: *` if never uploaded; deletes with
 *     `DELETE` + `If-Match`. Before an upload, pending uploads of the entities
 *     it depends on (e.g. the client an invoice references) are moved ahead of
 *     it, so the server never sees a reference to something it does not have.
 *
 * Rules:
 *  - Local writes apply immediately and are queued (persisted, so they survive
 *    reloads and offline periods). Repeated edits of one entity coalesce into
 *    one queue entry that keeps its original position.
 *  - Transient failures (offline, 5xx, 429, write races) stop the queue at
 *    that entry and retry with exponential backoff (or `Retry-After`).
 *    Permanent failures (e.g. 400 validation) drop the entry, keep the entity
 *    local-only and record why.
 *  - Deleted stays deleted: a tombstone or `410` drops the local copy, even if
 *    it had unsynced edits (the user is told).
 *  - `412` on an upload → fetch the server version and three-way merge against
 *    the last version both agreed on (the descriptor's merge): non-overlapping
 *    edits are combined, a field edited on both sides keeps the server's
 *    value. The user is told when changes were merged or discarded.
 *  - `412` on a delete (someone changed the entity after this browser's last
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
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { LocalEntity, ServerEntity, SyncCollection } from './collection';
import { syncKey, type CollectionName } from './collectionNames';
import { COLLECTIONS, orderedCollections } from './collections';
import { setLocalChangeListener, type LocalChange, type LocalEntityLike } from './localChanges';

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

function listFields(col: SyncCollection, fields: readonly string[]): string {
  const labels = fields.map((f) => col.fieldLabel(f));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const notices = {
  deletedElsewhere(col: SyncCollection, label: string, by: Actor | undefined) {
    toast.warning(by ? `${label} was deleted by ${actorLabel(by)}` : `${label} was deleted elsewhere`, {
      description: `Your unsynced changes to it were discarded. Deleted ${col.plural} stay deleted.`,
    });
  },
  deletedByAgent(label: string, by: Actor | undefined) {
    toast.info(`${label} was deleted by ${actorLabel(by)}`);
  },
  merged(label: string, by: Actor | undefined) {
    toast.info(`${label} was also changed by ${actorLabel(by)}`, {
      description: 'Both sets of changes were kept.',
    });
  },
  lost(col: SyncCollection, label: string, by: Actor | undefined, fields: readonly string[]) {
    toast.warning(`Some of your changes to ${label} were not applied`, {
      description: `${actorLabel(by)[0].toUpperCase()}${actorLabel(by).slice(1)} changed the ${listFields(col, fields)} at the same time; the newer version was kept.`,
    });
  },
  restored(label: string, by: Actor | undefined) {
    toast.warning(`${label} was kept`, {
      description: `It was changed by ${actorLabel(by)} after this browser last synced, so it was not deleted. Delete it again if you still want it gone.`,
    });
  },
  rejected(label: string, message: string) {
    toast.error(`${label} could not be synced`, {
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

const isEntityOp = (op: PendingOp, collection: CollectionName, id: string) =>
  op.type !== 'settings' && op.collection === collection && op.entityId === id;

function setBase(col: SyncCollection, id: string, content: unknown | null): void {
  const key = syncKey(col.name, id);
  useCloudStore.setState((state) => {
    const bases = { ...state.bases };
    if (content) bases[key] = content;
    else delete bases[key];
    return { bases };
  });
}

function setSyncError(col: SyncCollection, id: string, message: string | null): void {
  const key = syncKey(col.name, id);
  useCloudStore.setState((state) => {
    if (message === null && !(key in state.syncErrors)) return {};
    const syncErrors = { ...state.syncErrors };
    if (message === null) delete syncErrors[key];
    else syncErrors[key] = message;
    return { syncErrors };
  });
}

function baseOf(col: SyncCollection, id: string): unknown | null {
  return cloud().bases[syncKey(col.name, id)] ?? null;
}

/** Local copy := server version (keeps the list position). */
function adoptServer(col: SyncCollection, server: ServerEntity): void {
  col.setLocal(server.id, col.fromServer(server), true);
  setBase(col, server.id, col.contentOf(server));
  setSyncError(col, server.id, null);
}

/** Drops an entity the server says is deleted, with everything queued for it. */
function dropDeleted(col: SyncCollection, id: string): void {
  col.removeLocal(id);
  setBase(col, id, null);
  setSyncError(col, id, null);
  useCloudStore.setState((state) => ({ queue: state.queue.filter((op) => !isEntityOp(op, col.name, id)) }));
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function newOp(partial: Pick<PendingOp, 'type'> & Partial<PendingOp>): PendingOp {
  return { opId: crypto.randomUUID(), seq: 0, attempts: 0, notBefore: 0, ...partial };
}

/** Queues the upload of a local entity (created or edited). */
export function enqueueUpsert(collection: CollectionName, id: string): void {
  if (!cloud().token) return;
  const key = syncKey(collection, id);
  useCloudStore.setState((state) => {
    const index = state.queue.findIndex((op) => isEntityOp(op, collection, id));
    const queue = [...state.queue];
    if (index >= 0) {
      const current = queue[index];
      queue[index] = { ...current, type: 'upsert', baseRevision: undefined, seq: current.seq + 1, notBefore: 0 };
    } else {
      queue.push(newOp({ type: 'upsert', collection, entityId: id }));
    }
    const syncErrors = { ...state.syncErrors };
    delete syncErrors[key];
    return { queue, syncErrors };
  });
  scheduleFlush();
}

/** Queues the deletion of an entity the user deleted locally. */
export function enqueueDelete(collection: CollectionName, entity: LocalEntityLike): void {
  if (!cloud().token) return;
  const col = COLLECTIONS[collection];
  const key = syncKey(collection, entity.id);
  useCloudStore.setState((state) => {
    const index = state.queue.findIndex((op) => isEntityOp(op, collection, entity.id));
    const queue = [...state.queue];
    const neverUploaded = entity.revision === undefined;
    const del = newOp({
      type: 'delete',
      collection,
      entityId: entity.id,
      baseRevision: entity.revision,
      label: col.label(entity as LocalEntity),
    });
    if (index >= 0) {
      const current = queue[index];
      // A pending upload of an entity the server never saw: nothing to delete there.
      if (current.type === 'upsert' && neverUploaded && !(key in state.bases)) queue.splice(index, 1);
      else queue[index] = { ...del, opId: current.opId, seq: current.seq + 1 };
    } else if (!(neverUploaded && key in state.syncErrors)) {
      queue.push(del);
    }
    const syncErrors = { ...state.syncErrors };
    delete syncErrors[key];
    return { queue, syncErrors };
  });
  scheduleFlush();
}

/** Queues the upload of a local invoice (created or edited). */
export const enqueueInvoiceUpsert = (id: string): void => enqueueUpsert('invoices', id);
/** Queues the deletion of an invoice the user deleted locally. */
export const enqueueInvoiceDelete = (invoice: Invoice): void => enqueueDelete('invoices', invoice);

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

/**
 * Queues every local entity of every collection for upload, e.g. after
 * joining a workspace: collections in dependency order (clients before the
 * invoices that reference them), each in its upload order (oldest first).
 */
export function enqueueAllLocal(): void {
  for (const col of orderedCollections()) {
    const entities = col.uploadOrder ? col.uploadOrder(col.all()) : col.all();
    for (const entity of entities) enqueueUpsert(col.name, entity.id);
  }
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

/**
 * If the head of the queue is an upload whose dependencies still have
 * uploads waiting further back, moves those to the front (keeping their
 * relative order). Returns true when the queue was reordered.
 */
function hoistDependencies(op: PendingOp): boolean {
  if (op.type !== 'upsert' || !op.collection || !op.entityId) return false;
  const col = COLLECTIONS[op.collection];
  const local = col.getLocal(op.entityId);
  const deps = local && col.dependencies ? col.dependencies(local) : [];
  if (deps.length === 0) return false;
  const queue = cloud().queue;
  const waiting = queue.filter((q) => q.type === 'upsert' && deps.some((d) => isEntityOp(q, d.collection, d.id)) && q.opId !== op.opId);
  if (waiting.length === 0) return false;
  const ids = new Set(waiting.map((q) => q.opId));
  useCloudStore.setState({ queue: [...waiting, ...queue.filter((q) => !ids.has(q.opId))] });
  return true;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/** Applies one page of a collection's delta feed. */
export function applyServerItems(col: SyncCollection, items: ServerEntity[]): void {
  for (const server of items) {
    const pending = cloud().queue.find((op) => isEntityOp(op, col.name, server.id));
    const local = col.getLocal(server.id);

    if (server.deletedAt) {
      if (local || pending) {
        dropDeleted(col, server.id);
        if (pending?.type === 'upsert') notices.deletedElsewhere(col, local ? col.label(local) : col.label(server), server.updatedBy);
        else if (!pending && local && server.updatedBy?.type === 'agent') notices.deletedByAgent(col.label(local), server.updatedBy);
      } else {
        setBase(col, server.id, null);
      }
      continue;
    }
    // Local changes are waiting to be uploaded: the push resolves them against this version.
    if (pending) continue;
    if (local?.revision !== undefined && local.revision >= server.revision) continue;
    adoptServer(col, server);
  }
}

/** Applies one page of the invoice feed. Exported for tests. */
export function applyServerInvoices(items: ApiInvoice[]): void {
  applyServerItems(COLLECTIONS.invoices, items);
}

async function pullCollection(col: SyncCollection, token: string): Promise<void> {
  const cursor = cloud().cursors[col.name];
  let page = await col.listPage({ updatedSince: cursor });
  for (;;) {
    assertSession(token);
    applyServerItems(col, page.items);
    if (!page.hasMore || !page.next) {
      useCloudStore.setState((state) => ({ cursors: { ...state.cursors, [col.name]: page.syncedAt } }));
      return;
    }
    page = await col.listPage({ updatedSince: page.next.updated_since, afterId: page.next.after_id });
  }
}

async function pull(token: string): Promise<void> {
  for (const col of orderedCollections()) await pullCollection(col, token);
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
function acceptWrite(col: SyncCollection, op: PendingOp, seqAtStart: number, server: ServerEntity): void {
  const latest = currentOp(op.opId);
  if (latest?.seq === seqAtStart) {
    adoptServer(col, server);
    return;
  }
  setBase(col, server.id, col.contentOf(server));
  const local = col.getLocal(server.id);
  if (!local) {
    // Deleted here while the upload was in flight: delete the copy we just created.
    if (latest?.type === 'delete') {
      useCloudStore.setState((state) => ({
        queue: state.queue.map((q) => (q.opId === op.opId ? { ...q, baseRevision: server.revision } : q)),
      }));
    } else if (!latest) {
      useCloudStore.setState((state) => ({
        queue: [...state.queue, newOp({ type: 'delete', collection: col.name, entityId: server.id, baseRevision: server.revision, label: col.label(server) })],
      }));
    }
    return;
  }
  // Edited here while the upload was in flight: keep the newer local content, learn the revision.
  col.setLocal(server.id, {
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
async function resolveUpsertConflict(col: SyncCollection, id: string, token: string): Promise<'done' | 'retry'> {
  let server: ServerEntity;
  try {
    server = await col.fetchOne(id);
  } catch (e) {
    if (isApiError(e, 410)) {
      const local = col.getLocal(id);
      dropDeleted(col, id);
      notices.deletedElsewhere(col, local ? col.label(local) : col.fallbackLabel, undefined);
      return 'done';
    }
    if (isApiError(e, 404)) {
      // We knew a revision the server no longer has: upload it as new.
      const local = col.getLocal(id);
      if (local) {
        const { revision: _r, ...rest } = local;
        col.setLocal(id, rest as LocalEntity, false);
      }
      setBase(col, id, null);
      return 'retry';
    }
    throw e;
  }
  assertSession(token);
  const local = col.getLocal(id);
  if (!local) return 'done';

  const base = baseOf(col, id);
  const serverContent = col.contentOf(server);
  const { merged, conflicts } = col.merge(base, col.contentOf(local), serverContent);
  if (conflicts.length > 0) notices.lost(col, col.label(local), server.updatedBy, conflicts);

  if (col.contentEquals(merged, serverContent)) {
    adoptServer(col, server);
    return 'done';
  }
  if (conflicts.length === 0 && base !== null && !col.contentEquals(base, serverContent)) {
    notices.merged(col.label(local), server.updatedBy);
  }
  col.setLocal(id, col.withContent(server, merged, local), false);
  setBase(col, id, serverContent);
  return 'retry';
}

async function pushUpsert(col: SyncCollection, op: PendingOp, token: string): Promise<void> {
  const id = op.entityId!;
  const seqAtStart = op.seq;
  for (let round = 0; round <= MAX_CONFLICT_ROUNDS; round++) {
    const local = col.getLocal(id);
    if (!local) return;
    try {
      const server = await col.put(local, local.revision !== undefined ? { ifMatch: local.revision } : { ifNoneMatch: true });
      assertSession(token);
      acceptWrite(col, op, seqAtStart, server);
      return;
    } catch (e) {
      if (e instanceof SessionChanged) throw e;
      if (isApiError(e, 410)) {
        dropDeleted(col, id);
        notices.deletedElsewhere(col, col.label(local), undefined);
        return;
      }
      if (isApiError(e, 412)) {
        if ((await resolveUpsertConflict(col, id, token)) === 'done') return;
        continue;
      }
      if (isPermanent(e)) {
        const message = describeRejection(e as ApiError);
        setSyncError(col, id, message);
        notices.rejected(col.label(local), message);
        return;
      }
      throw e;
    }
  }
  // Someone keeps changing it under us: try again later.
  throw new ApiError(409, 'conflict', `The ${col.plural.replace(/s$/, '')} is being changed elsewhere; retrying shortly`);
}

async function pushDelete(col: SyncCollection, op: PendingOp, token: string): Promise<void> {
  const id = op.entityId!;
  try {
    await col.remove(id, op.baseRevision !== undefined ? { ifMatch: op.baseRevision } : {});
    setBase(col, id, null);
  } catch (e) {
    if (isApiError(e, 404) || isApiError(e, 410)) {
      setBase(col, id, null);
      return;
    }
    if (!isApiError(e, 412)) {
      if (isPermanent(e)) return;
      throw e;
    }
    // Changed (or already deleted) after our last sync.
    let server: ServerEntity;
    try {
      server = await col.fetchOne(id);
    } catch (inner) {
      if (isApiError(inner, 410) || isApiError(inner, 404)) {
        setBase(col, id, null);
        return;
      }
      throw inner;
    }
    assertSession(token);
    adoptServer(col, server);
    notices.restored(col.label(server), server.updatedBy);
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
  // Each hoist moves at least one entry permanently ahead; bound it anyway.
  let hoists = cloud().queue.length;
  for (;;) {
    assertSession(token);
    const op = cloud().queue[0];
    if (!op) return;
    if (hoists > 0 && hoistDependencies(op)) {
      hoists--;
      continue;
    }
    if (op.notBefore > Date.now()) {
      scheduleRetry(op.notBefore - Date.now());
      return;
    }
    const seqAtStart = op.seq;
    try {
      if (op.type === 'settings') await pushSettings();
      else if (op.type === 'upsert') await pushUpsert(COLLECTIONS[op.collection!], op, token);
      else await pushDelete(COLLECTIONS[op.collection!], op, token);
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

function onLocalChange(change: LocalChange): void {
  if (change.type === 'upsert') enqueueUpsert(change.collection, change.id);
  else enqueueDelete(change.collection, change.entity);
}

/**
 * Connects the stores to the engine: user edits get queued, settings changes
 * get uploaded. Returns a function that disconnects them again.
 */
export function startCloudSync(): () => void {
  setLocalChangeListener(onLocalChange);
  const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
    if (state.settings !== prev.settings && !applyingRemoteSettings) enqueueSettings();
  });
  return () => {
    setLocalChangeListener(null);
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
