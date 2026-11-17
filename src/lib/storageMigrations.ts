import type { Invoice } from '@/types/invoice';
import type { DefaultSettings } from '../../shared/settings';
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
 */
export const CURRENT_CLOUD_VERSION = 1;

/** A queued local change waiting to be sent to the server, oldest first. */
export interface PendingOp {
    /** Unique id of this queue entry. */
    opId: string;
    type: 'upsert' | 'delete' | 'settings';
    /** For upsert/delete. */
    invoiceId?: string;
    /** Delete only: the server revision the deleted copy had (undefined if never uploaded). */
    baseRevision?: number;
    /** Delete only: for messages after the local copy is gone. */
    invoiceNumber?: string;
    /** Bumped whenever a newer local change is coalesced into this entry. */
    seq: number;
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
    /** `syncedAt` of the last complete pull, used as `updated_since`. */
    cursor: string | null;
    queue: PendingOp[];
    /** Last content both this browser and the server agreed on, per invoice id (base for three-way merges). */
    bases: Record<string, unknown>;
    /** Invoices the server refused (e.g. validation), with the reason; they stay local-only until edited. */
    syncErrors: Record<string, string>;
}

export const EMPTY_CLOUD_STATE: CloudPersistedState = {
    workspace: null,
    token: null,
    disconnectedReason: null,
    cursor: null,
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
        if (type !== 'settings' && typeof raw.invoiceId !== 'string') return [];
        return [{
            opId: typeof raw.opId === 'string' ? raw.opId : crypto.randomUUID(),
            type,
            invoiceId: typeof raw.invoiceId === 'string' ? raw.invoiceId : undefined,
            baseRevision: typeof raw.baseRevision === 'number' ? raw.baseRevision : undefined,
            invoiceNumber: typeof raw.invoiceNumber === 'string' ? raw.invoiceNumber : undefined,
            seq: typeof raw.seq === 'number' ? raw.seq : 0,
            attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
            // Retry promptly after a reload.
            notBefore: 0,
        }];
    });
}

/**
 * Migrates the cloud sync store. Version 0 (or anything malformed) is
 * normalised field by field so a corrupt entry never breaks app start: bad
 * queue entries are dropped, and the queue, cursor and merge bases are only
 * kept together with a token (they are meaningless without a workspace).
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
        cursor: token && typeof state.cursor === 'string' ? state.cursor : null,
        queue: token ? sanitizeQueue(state.queue) : [],
        bases: token && isRecord(state.bases) ? state.bases : {},
        syncErrors: isRecord(state.syncErrors)
            ? Object.fromEntries(Object.entries(state.syncErrors).filter(([, v]) => typeof v === 'string')) as Record<string, string>
            : {},
    };
}
