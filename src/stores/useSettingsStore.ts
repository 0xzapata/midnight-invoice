import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Default settings for invoice forms.
 * These values can be applied to new invoices via "Use Defaults" button.
 */
export interface DefaultSettings {
    fromName: string;
    fromEmail: string;
    fromAddress: string;
    paymentDetails: string;
    notes: string;
    taxRate: number;
    currency: string;
}

interface SettingsState {
    settings: DefaultSettings;
    updateSettings: (settings: Partial<DefaultSettings>) => void;
    resetSettings: () => void;
}

const defaultSettings: DefaultSettings = {
    fromName: '',
    fromEmail: '',
    fromAddress: '',
    paymentDetails: '',
    notes: '',
    taxRate: 0,
    currency: 'USD',
};

/**
 * Zustand store for user settings with localStorage persistence.
 * Stores default values for invoice fields that can be applied via "Use Defaults".
 */
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
        }
    )
);
