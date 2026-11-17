import { useState } from 'react';
import { Link } from 'react-router';
import { Bot, FileStack, History, Menu, Repeat, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const LINKS = [
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/templates', label: 'Templates', icon: FileStack },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/activity', label: 'Activity', icon: History },
] as const;

/**
 * Secondary navigation of the dashboard header. From `sm` the pages are
 * separate links (labels from `xl`); on phones they collapse into one menu so
 * the header fits at 320 px next to sync status and "New Invoice".
 */
export function HeaderNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Pages" className="hidden items-center gap-1 sm:flex xl:gap-2">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <Button key={to} variant="ghost" size="sm" asChild className="px-2 font-mono xl:px-3">
            <Link to={to} viewTransition title={label}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only xl:not-sr-only">{label}</span>
            </Link>
          </Button>
        ))}
      </nav>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 sm:hidden" aria-label="Pages menu">
            <Menu className="w-4 h-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          <nav aria-label="Pages">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                viewTransition
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </PopoverContent>
      </Popover>
    </>
  );
}
