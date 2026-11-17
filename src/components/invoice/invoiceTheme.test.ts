import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_INVOICE_THEME, INVOICE_PALETTES, hslTripletToRgb, isInvoiceTheme, resolveDocumentInvoiceTheme } from './invoiceTheme';

// Token parity with src/index.css is checked in server/pdf-preview-parity.test.ts (needs file access).

describe('invoice palette shared by preview and PDF', () => {
  it('converts the tokens to the sRGB colours the browser computes for the preview', () => {
    // Values read with getComputedStyle from the running app's .invoice-preview.
    expect(INVOICE_PALETTES.dark).toEqual({
      background: '#0f0f0f', // rgb(15, 15, 15)
      text: '#f2f2f2', // rgb(242, 242, 242)
      muted: '#8c8c8c', // rgb(140, 140, 140)
      border: '#292929', // rgb(41, 41, 41)
      borderSubtle: '#1c1c1c', // border/50 over the card
      accent: '#10b77f', // rgb(16, 183, 127)
    });
    expect(INVOICE_PALETTES.light).toMatchObject({ background: '#ffffff', text: '#0d0d0d', muted: '#737373', border: '#e6e6e6', accent: '#10b77f' });
    expect(hslTripletToRgb('0 0% 100%')).toEqual([255, 255, 255]);
  });

  it('defaults to dark, the look the app ships with', () => {
    expect(DEFAULT_INVOICE_THEME).toBe('dark');
  });

  it('validates theme names', () => {
    expect(isInvoiceTheme('light')).toBe(true);
    expect(isInvoiceTheme('dark')).toBe(true);
    expect(isInvoiceTheme('sepia')).toBe(false);
    expect(isInvoiceTheme(undefined)).toBe(false);
  });
});

describe('resolveDocumentInvoiceTheme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('follows the .dark class the theme toggle sets on <html>/<body>', () => {
    document.body.classList.add('dark');
    expect(resolveDocumentInvoiceTheme()).toBe('dark');
    document.body.classList.remove('dark');
    expect(resolveDocumentInvoiceTheme()).toBe('light');
    document.documentElement.classList.add('dark');
    expect(resolveDocumentInvoiceTheme()).toBe('dark');
  });

  it('uses the closest .dark ancestor of a mounted preview', () => {
    document.body.innerHTML = '<div class="dark"><div class="invoice-preview"></div></div>';
    expect(resolveDocumentInvoiceTheme()).toBe('dark');
    document.body.innerHTML = '<div><div class="invoice-preview"></div></div>';
    expect(resolveDocumentInvoiceTheme()).toBe('light');
  });
});
