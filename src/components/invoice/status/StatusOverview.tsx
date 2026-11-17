import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/invoice-utils';
import { cn } from '@/lib/utils';
import type { InvoiceSummary, SummaryBucket } from '../../../../shared/invoice-status';
import { STATUS_FILTERS, type StatusFilter } from './useInvoiceStatus';

type TileKey = 'outstanding' | 'overdue' | 'paidThisMonth';

const TILES: { key: TileKey; label: string; filter: StatusFilter; accent: string }[] = [
  { key: 'outstanding', label: 'Outstanding', filter: 'outstanding', accent: 'text-blue-700 dark:text-blue-400' },
  { key: 'overdue', label: 'Overdue', filter: 'overdue', accent: 'text-red-700 dark:text-red-400' },
  { key: 'paidThisMonth', label: 'Paid this month', filter: 'paid', accent: 'text-green-700 dark:text-green-400' },
];

/**
 * Compact totals at the top of the dashboard, computed from the local store
 * (works offline and without cloud sync). One line per currency when more
 * than one is in use; amounts are never added across currencies.
 */
export function TotalsStrip({
  summary,
  onSelect,
  className,
}: {
  summary: InvoiceSummary;
  onSelect?: (filter: StatusFilter) => void;
  className?: string;
}) {
  if (summary.currencies.length === 0) return null;
  // Show currencies that have something in these tiles; fall back to the most used one.
  const relevant = summary.currencies.filter((c) => TILES.some((t) => c[t.key].count > 0));
  const shown = relevant.length > 0 ? relevant : summary.currencies.slice(0, 1);
  return (
    <section aria-label="Totals" className={cn('grid grid-cols-1 divide-y divide-border border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0', className)}>
      {TILES.map((tile) => {
        const count = shown.reduce((n, c) => n + c[tile.key].count, 0);
        return (
          <Tile key={tile.key} label={tile.label} count={count} onClick={onSelect ? () => onSelect(tile.filter) : undefined}>
            {shown.map((c) => (
              <Amount key={c.currency} bucket={c[tile.key]} currency={c.currency} accent={tile.accent} />
            ))}
          </Tile>
        );
      })}
    </section>
  );
}

function Tile({ label, count, onClick, children }: { label: string; count: number; onClick?: () => void; children: ReactNode }) {
  const body = (
    <>
      <span className="flex items-baseline gap-2 text-[11px] uppercase leading-tight tracking-wider text-muted-foreground sm:justify-between">
        <span>{label}</span>{' '}
        <span className="font-mono tabular-nums">
          {count}
          <span className="sr-only"> invoice{count === 1 ? '' : 's'}</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-col items-end gap-0.5 sm:mt-1.5 sm:items-stretch">{children}</span>
    </>
  );
  // Phones: one row per tile (label left, amount right); sm+: three columns.
  const base = 'flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left sm:flex-col sm:items-stretch sm:justify-start sm:gap-0 sm:p-4';
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, 'transition-colors hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset')}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}

function Amount({ bucket, currency, accent }: { bucket: SummaryBucket; currency: string; accent: string }) {
  return (
    <span title={formatCurrency(bucket.total, currency)} className={cn('truncate font-mono text-sm font-medium tabular-nums sm:text-base', bucket.count > 0 ? accent : 'text-muted-foreground')}>
      {formatCurrency(bucket.total, currency)}
    </span>
  );
}

/** All / Draft / Outstanding / Overdue / Paid, with counts. */
export function StatusFilterChips({
  value,
  counts,
  onChange,
  className,
}: {
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (filter: StatusFilter) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Filter invoices by status" className={cn('flex flex-wrap gap-2', className)}>
      {STATUS_FILTERS.map(({ value: filter, label }) => {
        const active = filter === value;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              filter === 'overdue' && counts.overdue > 0 && !active && 'text-red-700 dark:text-red-400',
            )}
          >
            {label}{' '}
            <span className="font-mono tabular-nums opacity-80">
              {counts[filter]}
              <span className="sr-only"> invoices</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
