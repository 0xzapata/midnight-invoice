/**
 * What the sync engine needs to know about one synced collection. The engine
 * (engine.ts) is generic: pull/push, queue, backoff, tombstones, 410/412
 * handling and the three-way merge are the same for every collection; a
 * descriptor supplies the store access, the REST calls and the content
 * model. See AGENTS.md "Adding a synced collection".
 */
import type { Actor } from '@/types/invoice';
import type { WritePreconditions } from '@/lib/api/client';
import type { CollectionName } from './collectionNames';

/** Sync metadata every local entity may carry (absent until first synced). */
export interface LocalEntity {
  id: string;
  createdAt: string;
  revision?: number;
  updatedAt?: string;
  createdBy?: Actor;
  updatedBy?: Actor;
}

/** What every collection's REST resource returns (see AGENT_API.md "Sync semantics"). */
export interface ServerEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  createdBy: Actor;
  updatedBy: Actor;
}

export interface FeedPage<S> {
  items: S[];
  syncedAt: string;
  hasMore: boolean;
  next: { updated_since: string; after_id: string } | null;
}

export interface MergeOutcome<C> {
  merged: C;
  /** Fields both sides changed to different values (the server's value was kept). */
  conflicts: string[];
}

export interface SyncCollection<L extends LocalEntity = LocalEntity, S extends ServerEntity = ServerEntity, C = unknown> {
  name: CollectionName;
  /** Plural noun for messages, e.g. "invoices" ("Deleted invoices stay deleted."). */
  plural: string;
  /** Used in messages when the entity is gone, e.g. "An invoice". */
  fallbackLabel: string;
  /** How messages name one entity, e.g. "INV-0007" or "Client “Globex”". */
  label(entity: L | S): string;
  /** Human label of a content field, for conflict messages. */
  fieldLabel(field: string): string;

  // --- Local store. These must bypass the store's change emitter (no echo). ---
  all(): L[];
  getLocal(id: string): L | undefined;
  /** Replaces the local copy (keeping its list position), or inserts it when missing and `insertIfMissing`. */
  setLocal(id: string, next: L, insertIfMissing: boolean): void;
  removeLocal(id: string): void;
  /** Replaces the whole local list in one write (same order). */
  setAll(entities: L[]): void;

  // --- Server ---
  listPage(params: { updatedSince?: string; afterId?: string }): Promise<FeedPage<S>>;
  fetchOne(id: string): Promise<S>;
  /** PUT of the local copy (create-or-replace). */
  put(local: L, pre: WritePreconditions): Promise<S>;
  remove(id: string, pre: WritePreconditions): Promise<void>;

  // --- Content model ---
  /** Normalised user-editable content (no server metadata), structurally comparable. */
  contentOf(entity: L | S): C;
  contentEquals(a: C, b: C): boolean;
  /** Three-way merge: fields changed only locally win, only on the server win, on both keep the server value. */
  merge(base: C | null, local: C, server: C): MergeOutcome<C>;
  /** Local representation of a server entity (drops computed fields and the tombstone marker). */
  fromServer(server: S): L;
  /** Local copy after a merge: the server entity's metadata with the merged content. */
  withContent(server: S, merged: C, local: L): L;
  /** The entity without workspace-bound sync state (revision, updatedAt…), used when leaving a workspace. */
  withoutServerState(entity: L): L;
  /**
   * Entities (in collections earlier in SYNCED_COLLECTIONS) the server must
   * already know before this one is uploaded, e.g. the client an invoice
   * references. The engine uploads pending ones first.
   */
  dependencies?(entity: L): { collection: CollectionName; id: string }[];
  /** Order in which all local entities are queued when joining a workspace (default: as listed). */
  uploadOrder?(entities: L[]): L[];
}

/**
 * Field-by-field three-way merge used by the descriptors (the rule documented
 * in AGENT_API.md and AGENTS.md). Without a base (never synced from this
 * browser) every differing field is a conflict.
 */
export function mergeFields<C extends object>(
  fields: readonly (keyof C & string)[],
  equals: (field: keyof C & string, a: C, b: C) => boolean,
  base: C | null,
  local: C,
  server: C,
): MergeOutcome<C> & { localFields: (keyof C & string)[] } {
  const merged = structuredClone(server);
  const localFields: (keyof C & string)[] = [];
  const conflicts: (keyof C & string)[] = [];
  for (const field of fields) {
    if (equals(field, local, server)) continue;
    const localChanged = base === null || !equals(field, local, base);
    const serverChanged = base === null || !equals(field, server, base);
    if (localChanged && !serverChanged) {
      merged[field] = structuredClone(local[field]);
      localFields.push(field);
    } else if (localChanged && serverChanged) {
      conflicts.push(field);
    }
  }
  return { merged, localFields, conflicts };
}

/** Sync metadata of a server entity, for updating a local copy that keeps its own content. */
export function serverMeta(server: ServerEntity): Pick<LocalEntity, 'revision' | 'updatedAt' | 'createdAt' | 'createdBy' | 'updatedBy'> {
  return {
    revision: server.revision,
    updatedAt: server.updatedAt,
    createdAt: server.createdAt,
    createdBy: server.createdBy,
    updatedBy: server.updatedBy,
  };
}
