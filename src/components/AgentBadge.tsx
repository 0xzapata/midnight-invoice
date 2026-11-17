import { Bot } from 'lucide-react';
import type { Invoice } from '@/types/invoice';
import { agentAttribution } from '@/lib/sync/attribution';
import { cn } from '@/lib/utils';

/** Small chip attributing an invoice to the AI agent that created or last edited it. Agent names render as plain text. */
export function AgentBadge({ invoice, className }: { invoice: Pick<Invoice, 'createdBy' | 'updatedBy'>; className?: string }) {
  const attribution = agentAttribution(invoice);
  if (!attribution) return null;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary',
        className,
      )}
      title={`${attribution.verb === 'by' ? 'Created' : 'Last edited'} by the agent “${attribution.name}”`}
    >
      <Bot className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {attribution.verb} {attribution.name}
      </span>
    </span>
  );
}

/** One-line provenance for the invoice view: which agent created / last edited it, and when. */
export function InvoiceAttribution({ invoice }: { invoice: Pick<Invoice, 'createdBy' | 'updatedBy' | 'updatedAt'> }) {
  const created = invoice.createdBy?.type === 'agent' ? invoice.createdBy.agentName || 'an agent' : null;
  const edited = invoice.updatedBy?.type === 'agent' ? invoice.updatedBy.agentName || 'an agent' : null;
  if (!created && !edited) return null;
  let when = '';
  if (invoice.updatedAt) {
    const d = new Date(invoice.updatedAt);
    if (!Number.isNaN(d.getTime())) when = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  const parts: string[] = [];
  if (created) parts.push(`Created by the agent “${created}”`);
  if (edited) parts.push(`${created ? 'last edited' : 'Last edited'} by the agent “${edited}”${when ? ` on ${when}` : ''}`);
  else if (invoice.updatedBy?.type === 'user' && created) parts.push(`last edited by you${when ? ` on ${when}` : ''}`);
  return (
    <p className="mb-4 flex items-start justify-center gap-1.5 text-xs text-muted-foreground print:hidden">
      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>{parts.join(' · ')}</span>
    </p>
  );
}
