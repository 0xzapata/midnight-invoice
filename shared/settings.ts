/**
 * Default sender settings, shared by the browser store (useSettingsStore) and
 * the API (`GET/PUT /api/v1/settings`).
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

export const DEFAULT_SETTINGS: DefaultSettings = {
    fromName: '',
    fromEmail: '',
    fromAddress: '',
    paymentDetails: '',
    notes: '',
    taxRate: 0,
    currency: 'USD',
};
