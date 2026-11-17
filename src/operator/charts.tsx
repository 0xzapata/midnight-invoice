import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface BarDatum {
  key: string | number;
  label: string;
  value: number;
  /** Optional extra line in the tooltip. */
  detail?: string;
}

/**
 * Single-series bar chart: hand-rolled SVG bars (stretched to the container)
 * with HTML labels, one recessive baseline, max-value gridline and a hover /
 * focus tooltip. Colour comes from the theme's primary token, so it follows
 * light and dark mode. The chart title names the series (no legend needed).
 */
export function BarChart({
  data,
  label,
  height = 140,
  format = (v: number) => String(v),
  tone = 'primary',
}: {
  data: BarDatum[];
  label: string;
  height?: number;
  format?: (v: number) => string;
  tone?: 'primary' | 'destructive';
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const gap = 2;
  const W = n * 10;
  const barW = 10 - gap;
  const summary = `${label}: ${data.length} points, max ${format(max)}`;
  const fill = tone === 'primary' ? 'hsl(var(--primary))' : 'hsl(var(--destructive))';
  const tickIdx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const a = active === null ? null : data[active];

  return (
    <figure className="relative" aria-label={summary}>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">{format(max)}</span>
      </div>
      <div className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden="true" />
        <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={summary}>
          {data.map((d, i) => {
            const h = d.value === 0 ? 0 : Math.max(1.5, (d.value / max) * 100);
            return (
              <g key={d.key}>
                {/* Hit target: full column height, wider than the mark. */}
                <rect
                  x={i * 10}
                  y={0}
                  width={10}
                  height={100}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
                <rect
                  x={i * 10 + gap / 2}
                  y={100 - h}
                  width={barW}
                  height={h}
                  rx={0}
                  fill={fill}
                  opacity={active === null || active === i ? 1 : 0.45}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border" aria-hidden="true" />
        {a && active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{ left: `${((active + 0.5) / n) * 100}%`, top: `${Math.max(0, 100 - (a.value / max) * 100)}%` }}
          >
            <span className="font-medium tabular-nums">{format(a.value)}</span>
            <span className="ml-1.5 text-muted-foreground">{a.label}</span>
            {a.detail && <div className="text-muted-foreground">{a.detail}</div>}
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted-foreground" aria-hidden="true">
        {tickIdx.map((i) => (
          <span
            key={i}
            className={cn('absolute whitespace-nowrap', i === 0 ? 'left-0' : i === n - 1 ? 'right-0' : '-translate-x-1/2')}
            style={i !== 0 && i !== n - 1 ? { left: `${((i + 0.5) / n) * 100}%` } : undefined}
          >
            {data[i]?.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal proportion bars (funnels, breakdowns), labelled directly. */
export function HBars({ rows, format = (v: number) => String(v) }: { rows: { label: string; value: number; tone?: 'primary' | 'muted' | 'destructive' }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(7rem,9rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2.5 bg-secondary" aria-hidden="true">
            <span
              className={cn('block h-full', r.tone === 'destructive' ? 'bg-destructive' : r.tone === 'muted' ? 'bg-muted-foreground/50' : 'bg-primary')}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-foreground">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
