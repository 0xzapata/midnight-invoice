import { Fragment } from 'react';
import { Link } from 'react-router';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Bot, Cog, User } from 'lucide-react';
import type { ActivityEntry } from '../../../shared/activity';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { cn } from '@/lib/utils';
import { describeEntry } from './describe';

/** "You" or the agent's name, as a chip (agent names render as plain text). */
export function ActorChip({ entry }: { entry: Pick<ActivityEntry, 'actor'> }) {
  const a = entry.actor;
  const Icon = a.type === 'agent' ? Bot : a.type === 'user' ? User : Cog;
  return (
    <span
      className={cn(
        'inline-flex max-w-[14rem] items-center gap-1 border px-1.5 py-0.5 align-[1px] text-[11px] font-medium leading-none',
        a.type === 'agent' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-secondary text-foreground',
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{a.type === 'agent' ? a.agentName || 'Agent' : a.type === 'user' ? 'You' : 'System'}</span>
    </span>
  );
}

/** The entity of an entry: a link while it still exists in this browser, else its label marked as deleted. */
function EntityTarget({ entry, label, isSelf }: { entry: ActivityEntry; label: string; isSelf?: boolean }) {
  const entity = entry.entity;
  const invoiceExists = useInvoiceStore((s) => (entity?.type === 'invoice' ? s.invoices.some((i) => i.id === entity.id) : false));
  const clientExists = useClientStore((s) => (entity?.type === 'client' ? s.clients.some((c) => c.id === entity.id) : false));
  const strong = 'font-medium text-foreground';
  if (!entity || isSelf) return <span className={strong}>{label}</span>;
  const deletedHere = entry.action === 'invoice.deleted' || entry.action === 'client.deleted';
  if (entity.type === 'invoice' || entity.type === 'client') {
    const exists = entity.type === 'invoice' ? invoiceExists : clientExists;
    if (exists && !deletedHere) {
      return (
        <Link
          to={entity.type === 'invoice' ? `/invoice/${entity.id}` : '/clients'}
          className={cn(strong, 'underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring')}
        >
          {label}
        </Link>
      );
    }
    return (
      <span className={strong} title={`This ${entity.type} no longer exists`}>
        {label}
        {!deletedHere && <span className="text-xs font-normal text-muted-foreground"> (deleted)</span>}
      </span>
    );
  }
  if (entity.type === 'agent') {
    return (
      <Link to={`/activity?agent=${encodeURIComponent(entity.id)}`} className={cn(strong, 'underline decoration-border underline-offset-2 hover:decoration-foreground')}>
        {label}
      </Link>
    );
  }
  return <span className={strong}>{label}</span>;
}

function ActivityItem({ entry, compact, selfEntityId }: { entry: ActivityEntry; compact?: boolean; selfEntityId?: string }) {
  const d = describeEntry(entry);
  const time = parseISO(entry.time);
  const meta = [...d.details];
  if (entry.source === 'mcp') meta.push(entry.tool ? `via MCP · ${entry.tool}` : 'via MCP');
  else if (entry.source === 'rest' && entry.actor.type === 'agent') meta.push('via API');
  return (
    <li className={cn('flex gap-3', compact ? 'py-2' : 'py-3')}>
      <time dateTime={entry.time} title={format(time, 'PPpp')} className="w-11 shrink-0 pt-0.5 font-code text-xs text-muted-foreground tabular-nums">
        {format(time, 'HH:mm')}
      </time>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          <ActorChip entry={entry} />{' '}
          {d.parts.map((part, i) => (typeof part === 'string' ? <Fragment key={i}>{part}</Fragment> : <EntityTarget key={i} entry={entry} label={d.targetLabel ?? ''} isSelf={!!selfEntityId && entry.entity?.id === selfEntityId} />))}
        </p>
        {meta.length > 0 && <p className="text-xs text-muted-foreground/80 [overflow-wrap:anywhere]">{meta.join(' · ')}</p>}
      </div>
    </li>
  );
}

function dayLabel(day: Date): string {
  if (isToday(day)) return 'Today';
  if (isYesterday(day)) return 'Yesterday';
  return format(day, 'EEEE, MMM d, yyyy');
}

/** Entries grouped by local day, newest first. `compact` drops day headings' spacing for embedded lists. */
export function ActivityTimeline({
  entries,
  compact = false,
  label = 'Activity',
  selfEntityId,
}: {
  entries: ActivityEntry[];
  compact?: boolean;
  label?: string;
  /** The page's own entity (e.g. the invoice being viewed): shown without a link. */
  selfEntityId?: string;
}) {
  const groups: { key: string; day: Date; items: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const day = parseISO(entry.time);
    const key = format(day, 'yyyy-MM-dd');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(entry);
    else groups.push({ key, day, items: [entry] });
  }
  return (
    <div className={compact ? 'space-y-2' : 'space-y-6'} aria-label={label}>
      {groups.map((g) => (
        <section key={g.key} aria-label={dayLabel(g.day)}>
          <h4 className={cn('font-mono text-xs uppercase tracking-wider text-muted-foreground', compact ? 'mb-0.5' : 'mb-1 border-b border-border pb-2')}>{dayLabel(g.day)}</h4>
          <ol className={cn(!compact && 'divide-y divide-border/60')}>
            {g.items.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} compact={compact} selfEntityId={selfEntityId} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
