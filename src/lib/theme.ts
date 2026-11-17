/**
 * Light/dark theme of the app (and of the invoice preview and PDF, see
 * src/components/invoice/invoiceTheme.ts). Stored in localStorage under
 * THEME_STORAGE_KEY as 'light' or 'dark' and applied as the `dark` class on
 * <html>: before the first paint by the inline script in index.html, then by
 * next-themes (AppThemeProvider). New visitors get dark.
 */
export const THEME_STORAGE_KEY = 'theme';
export const THEMES = ['light', 'dark'] as const;
export type AppTheme = (typeof THEMES)[number];
export const DEFAULT_THEME: AppTheme = 'dark';
