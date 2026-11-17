import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CURRENT_SETTINGS_VERSION, migrateSettingsStore } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS, type DefaultSettings } from '../../shared/settings';

/**
 * Default settings for invoice forms.
 * These values can be applied to new invoices via "Use Defaults" button.
 * The type is shared with the API server (shared/settings.ts).
 */
export type { DefaultSettings };

interface SettingsState {
    settings: DefaultSettings;
    updateSettings: (settings: Partial<DefaultSettings>) => void;
    resetSettings: () => void;
}

const defaultSettings: DefaultSettings = DEFAULT_SETTINGS;

/**
 * Zustand store for user settings with localStorage persistence.
 * Stores default values for invoice fields that can be applied via "Use Defaults".
 */

/**
 * Check if user has configured any meaningful settings.
 * Ignores default currency 'USD' since it's a system default, not a user choice.
 */
export function hasConfiguredSettings(settings: DefaultSettings): boolean {
    return !!(
        settings.fromName ||
        settings.fromEmail ||
        settings.fromAddress ||
        settings.paymentDetails ||
        settings.notes ||
        settings.taxRate
    );
}


export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            settings: defaultSettings,

            updateSettings: (newSettings) =>
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                })),

            resetSettings: () =>
                set({ settings: defaultSettings }),
        }),
        {
            name: 'settings-storage',
            version: CURRENT_SETTINGS_VERSION,
            migrate: migrateSettingsStore,
        }
    )
);
