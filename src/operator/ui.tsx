/* eslint-disable react-refresh/only-export-components -- small shared module of console primitives and formatters */
import { useId, useState, type ReactNode } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const card = 'rounded-lg border border-border bg-card';

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn(card, 'p-4 sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && <h2 className="text-sm font-medium text-foreground">{title}</h2>}
            {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warn' | 'bad' }) {
  return (
    <div className={cn(card, 'p-4')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground',
          tone === 'warn' && 'text-yellow-500',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        tone === 'default' && 'bg-secondary text-muted-foreground',
        tone === 'good' && 'bg-primary/10 text-primary',
        tone === 'warn' && 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        tone === 'bad' && 'bg-destructive/10 text-destructive',
        tone === 'info' && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      )}
    >
      {children}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-input bg-secondary',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-background shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative -mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
export const th = 'border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground first:pl-4 sm:first:pl-3';
export const td = 'border-b border-border/60 px-3 py-2.5 align-top text-foreground first:pl-4 sm:first:pl-3';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export const fmtNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en').format(n));
export const fmtPercent = (r: number) => (r === 0 ? '0%' : r < 0.001 ? '<0.1%' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
export const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
export const fmtBytes = (b: number | null | undefined) => {
  if (b === null || b === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
export const fmtAgo = (t: number | string | null | undefined) => {
  if (t === null || t === undefined) return 'never';
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDistanceToNowStrict(d, { addSuffix: true });
};
export const fmtDateTime = (t: number | string | null | undefined) => {
  if (t === null || t === undefined) return '—';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
};

// ---------------------------------------------------------------------------
// Recovery key (shown exactly once)
// ---------------------------------------------------------------------------

export function RecoveryKeyPanel({ recoveryKey, onConfirmed, confirmLabel = 'Continue', busy }: { recoveryKey: string; onConfirmed: () => void; confirmLabel?: string; busy?: boolean }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = useId();
  const download = () => {
    const blob = new Blob(
      [
        `Midnight Invoice operator console - encryption recovery key\n\n${recoveryKey}\n\nCreated: ${new Date().toISOString()}\n` +
          'Keep this offline. It decrypts every secret setting. It is never shown again.\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'midnight-invoice-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-foreground">
        <p className="font-medium">Save this recovery key now. It is shown only once.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You need it if INITIAL_PASSWORD changes without a re-wrap, if ENCRYPTION_KEY is lost, or to enable hardened mode.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code data-testid="recovery-key" className="block min-w-0 flex-1 select-all break-all border border-border bg-secondary px-3 py-2 font-code text-sm text-foreground">
          {recoveryKey}
        </code>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(recoveryKey);
              setCopied(true);
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download aria-hidden="true" />
            Download
          </Button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <label htmlFor={id} className="text-sm text-foreground">
          I have saved the recovery key somewhere safe.
        </label>
      </div>
      <Button type="button" disabled={!saved || busy} onClick={onConfirmed}>
        {confirmLabel}
      </Button>
    </div>
  );
}
