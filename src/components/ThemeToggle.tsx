import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage first, default to 'dark'
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme | null;
      return stored || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    
    if (theme === 'dark') {
      document.body.classList.add('dark');
      root.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
      root.classList.remove('dark');
    }
    
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-9 w-9"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      </TooltipContent>
    </Tooltip>
  );
}
