import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY } from '@/lib/theme';

/**
 * Applies the stored theme on every route (mounted once in App.tsx), keeps
 * tabs in sync and lets ThemeToggle and the toaster read it. index.html applies
 * the same stored value before the first paint, so pages never flash dark.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      storageKey={THEME_STORAGE_KEY}
      defaultTheme={DEFAULT_THEME}
      themes={[...THEMES]}
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
