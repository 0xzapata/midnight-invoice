import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, KeyRound, LayoutDashboard, LogOut, Menu, Rocket, ScrollText, SlidersHorizontal, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import type { SessionResponse } from '../../shared/operator';
import { operatorApi } from './api';

const NAV = [
  { to: '/operator', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/operator/telemetry', label: 'Telemetry', icon: Activity },
  { to: '/operator/users', label: 'Users', icon: Users },
  { to: '/operator/settings', label: 'Settings', icon: SlidersHorizontal },
  { to: '/operator/deployments', label: 'Deployments', icon: Rocket },
  { to: '/operator/audit', label: 'Audit log', icon: ScrollText },
  { to: '/operator/security', label: 'Operators & security', icon: KeyRound },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Operator console" className="space-y-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function OperatorLayout({ session }: { session: SessionResponse }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const logout = useMutation({ mutationFn: operatorApi.logout, onSettled: () => queryClient.invalidateQueries({ queryKey: ['operator'] }) });
  const brand = (
    <p className="whitespace-nowrap font-mono text-xs tracking-widest text-muted-foreground">
      MIDNIGHT <span className="text-foreground">OPERATOR</span>
    </p>
  );
  const footer = (
    <div className="space-y-2 border-t border-sidebar-border pt-3">
      <p className="truncate px-3 text-xs text-muted-foreground" title={session.operator?.email}>
        {session.operator?.email}
      </p>
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => logout.mutate()}>
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 flex h-screen flex-col justify-between p-3">
          <div className="space-y-6">
            <div className="flex h-8 items-center px-3">{brand}</div>
            <Nav />
          </div>
          {footer}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open navigation">
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col justify-between bg-sidebar p-3">
                <div className="space-y-6">
                  <SheetTitle className="px-3 pt-1">{brand}</SheetTitle>
                  <Nav onNavigate={() => setOpen(false)} />
                </div>
                {footer}
              </SheetContent>
            </Sheet>
            {brand}
          </div>
          <p className="hidden text-xs text-muted-foreground lg:block">Private back-office · metadata only, never invoice contents</p>
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
