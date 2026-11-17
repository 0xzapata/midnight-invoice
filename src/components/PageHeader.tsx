import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SyncStatusIndicator } from '@/components/sync/SyncStatusIndicator';

interface PageHeaderProps {
  title: string;
  /** Where the back arrow goes (default: dashboard). */
  backTo?: string;
  actions?: ReactNode;
}

/** Sticky page header in the same style as the invoice pages, with sync status and theme toggle. */
export function PageHeader({ title, backTo = '/', actions }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
      <div className="container flex h-14 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(backTo, { viewTransition: true })} className="h-8 w-8 shrink-0">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Back</span>
          </Button>
          <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {actions}
          <SyncStatusIndicator />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
