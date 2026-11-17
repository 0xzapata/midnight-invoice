import type { Invoice } from '@/types/invoice';
import type { DefaultSettings } from '../../shared/settings';
import type { Client } from '../../shared/types/client';
import type { InvoiceTemplate, TemplateLineItem } from '../../shared/types/template';
import { isCollectionName, type CollectionName } from '@/lib/sync/collectionNames';
import { localToday, normalizeStatusFields } from '../../shared/invoice-status';

/**
 * Current schema version for invoices.
 * Increment this when making breaking changes to the Invoice type.
 */
export const CURRENT_INVOICE_VERSION = 2;

/**
 * Current schema version for settings.
 * Increment this when making breaking changes to the DefaultSettings type.
 */
export const CURRENT_SETTINGS_VERSION = 1;

/**
 * Invoice store persisted state shape.
 */
export interface InvoicePersistedState {
    invoices: Invoice[];
    drafts: Record<string, unknown>;
}

/**
 * Settings store persisted state shape.
 */
export interface SettingsPersistedState {
    settings: DefaultSettings;
}

/**
 * Migrates invoice store data from one version to the next.
 * 
 * @param persistedState - The state loaded from localStorage
 * @param version - The version number of the persisted state
 * @returns The migrated state compatible with the current version
 * 
 * @example
 * // Automatic migration when loading from localStorage
 * // Version 0 (unversioned) -> Version 1: stamps invoices with version
 * // Version 1 -> Version 2: adds status fields (missing status = 'draft', see shared/invoice-status.ts)
 */
export function migrateInvoiceStore(
    persistedState: unknown,
    version: number
): InvoicePersistedState {
    let state = persistedState as InvoicePersistedState;

    // Version 0 -> 1: Add version field to existing invoices
    if (version === 0) {
        const migratedInvoices = (state.invoices || []).map((invoice) => ({
            ...invoice,
            version: 1,
        }));

        state = {
            ...state,
            invoices: migratedInvoices,
            drafts: state.drafts || {},
        };
    }

    // Version 1 -> 2: invoice status. Invoices saved before statuses existed
    // become drafts (claiming "sent" would report old, long-paid invoices with a
    // past due date as overdue); the user marks them sent or paid.
    if (version <= 1) {
        const today = localToday();
        state = {
            ...state,
            invoices: (state.invoices || []).map((invoice) => ({
                ...invoice,
                ...normalizeStatusFields(invoice, today),
                version: 2,
            })),
            drafts: state.drafts || {},
        };
    }

    // Future migrations would go here:
    // if (version === 2) { ... migrate to v3 ... }

    return state;
}

/**
 * Migrates settings store data from one version to the next.
 * 
 * @param persistedState - The state loaded from localStorage
 * @param version - The version number of the persisted state
 * @returns The migrated state compatible with the current version
 */
export function migrateSettingsStore(
    persistedState: unknown,
    version: number
): SettingsPersistedState {
    const state = persistedState as SettingsPersistedState;

    // Version 0 -> 1: No changes needed, just ensure structure is correct
    if (version === 0) {
        return {
            settings: {
                fromName: state.settings?.fromName || '',
                fromEmail: state.settings?.fromEmail || '',
                fromAddress: state.settings?.fromAddress || '',
                paymentDetails: state.settings?.paymentDetails || '',
                notes: state.settings?.notes || '',
                taxRate: state.settings?.taxRate ?? 0,
                currency: state.settings?.currency || 'USD',
            },
        };
    }

    // Future migrations would go here

    return state;
}

/**
 * Current schema version for the cloud sync store (`cloud-sync-storage`).
 * Increment this when changing the persisted shape of useCloudStore.
 *
 * v2: one delta cursor per synced collection (`cursors`, was `cursor` for
 * invoices); queue entries name their collection and entity (`collection`,
 * `entityId`, `label`; were `invoiceId`, `invoiceNumber`).
 */
export const CURRENT_CLOUD_VERSION = 2;

/** A queued local change waiting to be sent to the server, oldest first. */
export interface PendingOp {
    /** Unique id of this queue entry. */
    opId: string;
    type: 'upsert' | 'delete' | 'settings';
    /** For upsert/delete: which synced collection. */
    collection?: CollectionName;
    /** For upsert/delete: the entity's id. */
    entityId?: string;
    /** Delete only: the server revision the deleted copy had (undefined if never uploaded). */
    baseRevision?: number;
    /** Delete only: for messages after the local copy is gone (e.g. the invoice number). */
    label?: string;
    /** Bumped whenever a newer local change is coalesced into this entry. */
    seq: number;
    /** Upsert queued by a bulk upload (joining a workspace): its batch id, so the server logs one summary entry. */
    bulkUpload?: string;
    attempts: number;
    /** Epoch ms before which the entry must not be retried (backoff / Retry-After). */
    notBefore: number;
}

/**
 * Cloud sync store persisted state shape. The workspace token is a bearer
 * secret held only here (localStorage) and sent only to same-origin /api.
 */
export interface CloudPersistedState {
    workspace: { id: string; createdAt: string } | null;
    token: string | null;
    /** Set when the server rejected the token (workspace deleted elsewhere). Local data is kept. */
    disconnectedReason: 'token_rejected' | null;
    /** Per collection: `syncedAt` of the last complete pull, used as `updated_since`. */
    cursors: Partial<Record<CollectionName, string>>;
    queue: PendingOp[];
    /**
     * Last content both this browser and the server agreed on (base for
     * three-way merges), keyed by `syncKey(collection, id)`.
     */
    bases: Record<string, unknown>;
    /** Entities the server refused (e.g. validation), with the reason, keyed by `syncKey`; they stay local-only until edited. */
    syncErrors: Record<string, string>;
}

export const EMPTY_CLOUD_STATE: CloudPersistedState = {
    workspace: null,
    token: null,
    disconnectedReason: null,
    cursors: {},
    queue: [],
    bases: {},
    syncErrors: {},
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeQueue(queue: unknown): PendingOp[] {
    if (!Array.isArray(queue)) return [];
    return queue.flatMap((raw): PendingOp[] => {
        if (!isRecord(raw)) return [];
        const type = raw.type;
        if (type !== 'upsert' && type !== 'delete' && type !== 'settings') return [];
        // v1 entries are invoice entries with `invoiceId` / `invoiceNumber`.
        const collection = raw.collection === undefined && typeof raw.invoiceId === 'string' ? 'invoices' : raw.collection;
        const entityId = typeof raw.entityId === 'string' ? raw.entityId : typeof raw.invoiceId === 'string' ? raw.invoiceId : undefined;
        const label = typeof raw.label === 'string' ? raw.label : typeof raw.invoiceNumber === 'string' ? raw.invoiceNumber : undefined;
        // Entries without an id, or for collections this version does not know (written by a newer app), are dropped.
        if (type !== 'settings' && (!isCollectionName(collection) || entityId === undefined)) return [];
        return [{
            opId: typeof raw.opId === 'string' ? raw.opId : crypto.randomUUID(),
            type,
            collection: type === 'settings' ? undefined : (collection as CollectionName),
            entityId: type === 'settings' ? undefined : entityId,
            baseRevision: typeof raw.baseRevision === 'number' ? raw.baseRevision : undefined,
            label,
            seq: typeof raw.seq === 'number' ? raw.seq : 0,
            attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
            // Retry promptly after a reload.
            notBefore: 0,
        }];
    });
}

function sanitizeCursors(state: Record<string, unknown>): Partial<Record<CollectionName, string>> {
    const cursors: Partial<Record<CollectionName, string>> = {};
    if (isRecord(state.cursors)) {
        for (const [name, value] of Object.entries(state.cursors)) {
            if (isCollectionName(name) && typeof value === 'string') cursors[name] = value;
        }
    } else if (typeof state.cursor === 'string') {
        // v1: the single cursor was the invoice feed's.
        cursors.invoices = state.cursor;
    }
    return cursors;
}

/**
 * Migrates the cloud sync store. Any version (or anything malformed) is
 * normalised field by field so a corrupt entry never breaks app start: bad
 * queue entries are dropped, and the queue, cursors and merge bases are only
 * kept together with a token (they are meaningless without a workspace).
 * Version 1 data (one invoice cursor, invoice-only queue entries) becomes
 * version 2.
 */
export function migrateCloudStore(persistedState: unknown, _version: number): CloudPersistedState {
    const state = isRecord(persistedState) ? persistedState : {};
    const ws = isRecord(state.workspace) && typeof state.workspace.id === 'string'
        ? { id: state.workspace.id, createdAt: typeof state.workspace.createdAt === 'string' ? state.workspace.createdAt : '' }
        : null;
    const token = typeof state.token === 'string' && state.token.length > 0 ? state.token : null;

    return {
        workspace: ws,
        token,
        disconnectedReason: state.disconnectedReason === 'token_rejected' ? 'token_rejected' : null,
        cursors: token ? sanitizeCursors(state) : {},
        queue: token ? sanitizeQueue(state.queue) : [],
        bases: token && isRecord(state.bases) ? state.bases : {},
        syncErrors: isRecord(state.syncErrors)
            ? Object.fromEntries(Object.entries(state.syncErrors).filter(([, v]) => typeof v === 'string')) as Record<string, string>
            : {},
    };
}

/**
 * Current schema version for the client store (`client-storage`).
 * Increment this when making breaking changes to the Client type.
 */
export const CURRENT_CLIENT_VERSION = 1;

/** Client store persisted state shape. */
export interface ClientPersistedState {
    clients: Client[];
}

const optString = (v: unknown) => (typeof v === 'string' ? v : undefined);
const optNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Migrates the client store. Every version is normalised entry by entry so a
 * corrupt entry never breaks app start: entries without an id or name (and
 * duplicate ids) are dropped, missing strings become "", malformed optional
 * defaults become null. Sync metadata (revision, attribution) is kept.
 */
export function migrateClientStore(persistedState: unknown, _version: number): ClientPersistedState {
    const state = isRecord(persistedState) ? persistedState : {};
    const raw = Array.isArray(state.clients) ? state.clients : [];
    const seen = new Set<string>();
    const clients = raw.flatMap((c): Client[] => {
        if (!isRecord(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || seen.has(c.id)) return [];
        seen.add(c.id);
        const createdAt = optString(c.createdAt) ?? new Date(0).toISOString();
        const client: Client = {
            id: c.id,
            name: c.name,
            email: optString(c.email) ?? '',
            address: optString(c.address) ?? '',
            defaultCurrency: optString(c.defaultCurrency) ?? null,
            defaultTaxRate: optNumber(c.defaultTaxRate),
            paymentTermsDays: optNumber(c.paymentTermsDays),
            notes: optString(c.notes) ?? '',
            createdAt,
            updatedAt: optString(c.updatedAt) ?? createdAt,
            archivedAt: optString(c.archivedAt) ?? null,
        };
        if (typeof c.revision === 'number') client.revision = c.revision;
        if (isRecord(c.createdBy)) client.createdBy = c.createdBy as unknown as Client['createdBy'];
        if (isRecord(c.updatedBy)) client.updatedBy = c.updatedBy as unknown as Client['updatedBy'];
        return [client];
    });
    return { clients };
}

/**
 * Current schema version for the template store (`template-storage`).
 * Increment this when making breaking changes to the InvoiceTemplate type.
 */
export const CURRENT_TEMPLATE_VERSION = 1;

/** Template store persisted state shape. */
export interface TemplatePersistedState {
    templates: InvoiceTemplate[];
}

const finiteOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Migrates the template store. Like migrateClientStore, every version is
 * normalised entry by entry so a corrupt entry never breaks app start:
 * entries without an id or name (and duplicate ids) are dropped, malformed
 * line items are dropped, missing strings become "", malformed optional
 * values become null. Sync metadata (revision, attribution) is kept.
 */
export function migrateTemplateStore(persistedState: unknown, _version: number): TemplatePersistedState {
    const state = isRecord(persistedState) ? persistedState : {};
    const raw = Array.isArray(state.templates) ? state.templates : [];
    const seen = new Set<string>();
    const templates = raw.flatMap((t): InvoiceTemplate[] => {
        if (!isRecord(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || seen.has(t.id)) return [];
        seen.add(t.id);
        const lineIds = new Set<string>();
        const lineItems = (Array.isArray(t.lineItems) ? t.lineItems : []).flatMap((li): TemplateLineItem[] => {
            if (!isRecord(li) || typeof li.description !== 'string') return [];
            const id = typeof li.id === 'string' && !lineIds.has(li.id) ? li.id : crypto.randomUUID();
            lineIds.add(id);
            return [{ id, description: li.description, quantity: finiteOrNull(li.quantity) ?? 1, price: finiteOrNull(li.price) ?? 0 }];
        });
        const createdAt = optString(t.createdAt) ?? new Date(0).toISOString();
        const template: InvoiceTemplate = {
            id: t.id,
            name: t.name,
            description: optString(t.description) ?? '',
            clientId: optString(t.clientId) ?? null,
            lineItems,
            taxRate: finiteOrNull(t.taxRate),
            currency: optString(t.currency) || null,
            notes: optString(t.notes) ?? '',
            paymentDetails: optString(t.paymentDetails) ?? '',
            paymentTermsDays: finiteOrNull(t.paymentTermsDays),
            invoiceNamePattern: optString(t.invoiceNamePattern) ?? '',
            createdAt,
            updatedAt: optString(t.updatedAt) ?? createdAt,
            archivedAt: optString(t.archivedAt) ?? null,
        };
        if (typeof t.revision === 'number') template.revision = t.revision;
        if (isRecord(t.createdBy)) template.createdBy = t.createdBy as unknown as InvoiceTemplate['createdBy'];
        if (isRecord(t.updatedBy)) template.updatedBy = t.updatedBy as unknown as InvoiceTemplate['updatedBy'];
        return [template];
    });
    return { templates };
}
