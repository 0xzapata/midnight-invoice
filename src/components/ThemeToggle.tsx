import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DEFAULT_THEME } from '@/lib/theme';

/** Switches between light and dark (state lives in AppThemeProvider). */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme ?? DEFAULT_THEME;
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  // Own provider: the toggle also sits in page headers rendered outside App's provider (e.g. in tests).
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9 shrink-0"
            aria-label={label}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
