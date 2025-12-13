import { Invoice } from '@/types/invoice';
import { DefaultSettings } from '@/stores/useSettingsStore';

/**
 * Current schema version for invoices.
 * Increment this when making breaking changes to the Invoice type.
 */
export const CURRENT_INVOICE_VERSION = 1;

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
 */
export function migrateInvoiceStore(
    persistedState: unknown,
    version: number
): InvoicePersistedState {
    const state = persistedState as InvoicePersistedState;

    // Version 0 -> 1: Add version field to existing invoices
    if (version === 0) {
        const migratedInvoices = (state.invoices || []).map((invoice) => ({
            ...invoice,
            version: 1,
        }));

        return {
            ...state,
            invoices: migratedInvoices,
            drafts: state.drafts || {},
        };
    }

    // Future migrations would go here:
    // if (version === 1) { ... migrate to v2 ... }

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
