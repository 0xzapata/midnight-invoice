import { describe, it, expect, beforeEach } from 'vitest';
import { hasConfiguredSettings, DefaultSettings } from './useSettingsStore';

describe('hasConfiguredSettings', () => {
    const emptySettings: DefaultSettings = {
        fromName: '',
        fromEmail: '',
        fromAddress: '',
        paymentDetails: '',
        notes: '',
        taxRate: 0,
        currency: 'USD',
    };

    it('returns false when all settings are empty/default', () => {
        expect(hasConfiguredSettings(emptySettings)).toBe(false);
    });

    it('returns false when only default currency is set', () => {
        const settings: DefaultSettings = { ...emptySettings, currency: 'USD' };
        expect(hasConfiguredSettings(settings)).toBe(false);
    });

    it('returns true when fromName is set', () => {
        const settings: DefaultSettings = { ...emptySettings, fromName: 'John Doe' };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when fromEmail is set', () => {
        const settings: DefaultSettings = { ...emptySettings, fromEmail: 'john@example.com' };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when fromAddress is set', () => {
        const settings: DefaultSettings = { ...emptySettings, fromAddress: '123 Main St' };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when paymentDetails is set', () => {
        const settings: DefaultSettings = { ...emptySettings, paymentDetails: 'Bank: XYZ' };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when notes is set', () => {
        const settings: DefaultSettings = { ...emptySettings, notes: 'Thank you!' };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when taxRate is set to non-zero', () => {
        const settings: DefaultSettings = { ...emptySettings, taxRate: 10 };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('returns true when multiple fields are set', () => {
        const settings: DefaultSettings = {
            ...emptySettings,
            fromName: 'John Doe',
            fromEmail: 'john@example.com',
            taxRate: 15,
        };
        expect(hasConfiguredSettings(settings)).toBe(true);
    });

    it('ignores non-default currency when other fields are empty', () => {
        // Even if user changes currency, no banner should appear if nothing else is set
        // This test confirms currency alone doesn't trigger hasConfiguredSettings
        const settings: DefaultSettings = { ...emptySettings, currency: 'EUR' };
        expect(hasConfiguredSettings(settings)).toBe(false);
    });
});
