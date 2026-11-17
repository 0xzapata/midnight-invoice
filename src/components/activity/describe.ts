/**
 * Plain-language sentences for activity entries ("Billing Assistant marked
 * INV-0007 as paid"). Pure functions; the timeline renders the parts and
 * turns the target into a link. Unknown action codes (from newer servers or
 * features) get a generic sentence instead of failing.
 */
import type { ActivityEntry } from '../../../shared/activity';
import { STATUS_LABELS } from '../../../shared/invoice-status';
import { FIELD_LABELS } from '@/lib/sync/fields';
import { SCOPE_SHORT } from '@/components/agents/scopes';

export type SentencePart = string | { target: true };

export interface DescribedEntry {
  /** "You", the agent's name, or "System". */
  actor: string;
  /** Sentence after the actor; `{ target: true }` marks where the entity label goes. */
  parts: SentencePart[];
  /** Text for the target (label snapshot or a fallback). */
  targetLabel: string | null;
  /** Secondary lines: changed fields, permissions… */
  details: string[];
}

const CLIENT_FIELDS: Record<string, string> = {
  name: 'name',
  email: 'email',
  address: 'address',
  defaultCurrency: 'default currency',
  defaultTaxRate: 'default tax rate',
  paymentTermsDays: 'payment terms',
  notes: 'private notes',
  archivedAt: 'archived',
};

const SETTINGS_FIELDS: Record<string, string> = {
  fromName: 'your name',
  fromEmail: 'your email',
  fromAddress: 'your address',
  paymentDetails: 'payment details',
  notes: 'default notes',
  taxRate: 'default tax rate',
  currency: 'default currency',
};

const INVOICE_FIELDS: Record<string, string> = { ...FIELD_LABELS, sentAt: 'sent date', paidAt: 'payment date' };

/** "dueDate" → "due date" for fields no map knows. */
const humanize = (field: string) => field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();

export function fieldLabel(entityType: string | undefined, field: string): string {
  const map = entityType === 'client' ? CLIENT_FIELDS : entityType === 'settings' ? SETTINGS_FIELDS : INVOICE_FIELDS;
  return map[field] ?? humanize(field);
}

export function actorName(entry: Pick<ActivityEntry, 'actor'>): string {
  if (entry.actor.type === 'user') return 'You';
  if (entry.actor.type === 'agent') return entry.actor.agentName || 'An agent';
  return 'System';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function statusPhrase(to: string): SentencePart[] {
  if (to === 'void') return ['voided ', { target: true }];
  if (to === 'draft') return ['moved ', { target: true }, ' back to draft'];
  return ['marked ', { target: true }, ` as ${STATUS_LABELS[to as keyof typeof STATUS_LABELS]?.toLowerCase() ?? to}`];
}

export function describeEntry(entry: ActivityEntry): DescribedEntry {
  const actor = actorName(entry);
  const c = entry.changes ?? {};
  const type = entry.entity?.type;
  const details: string[] = [];
  const fieldNames = (c.fields ?? []).map((f) => fieldLabel(type, f));
  if (fieldNames.length) details.push(`Changed ${listJoin(fieldNames)}`);
  const scopes = (c.scopes ?? []).map((s) => SCOPE_SHORT[s] ?? s);
  let targetLabel = entry.entity?.label ?? null;
  let parts: SentencePart[];

  switch (entry.action) {
    case 'invoice.created':
      parts = c.status ? ['created ', { target: true }, ` as ${c.status.to}`] : ['created ', { target: true }];
      break;
    case 'invoice.updated':
      parts = ['edited ', { target: true }];
      break;
    case 'invoice.status_changed':
      parts = statusPhrase(c.status?.to ?? 'sent');
      if (c.status?.from) details.unshift(`Was ${c.status.from}`);
      break;
    case 'invoice.deleted':
      parts = ['deleted ', { target: true }];
      break;
    case 'invoice.pdf_downloaded':
      parts = ['downloaded the PDF of ', { target: true }];
      break;
    case 'client.created':
      parts = ['added the client ', { target: true }];
      break;
    case 'client.updated':
      parts = ['edited the client ', { target: true }];
      break;
    case 'client.archived':
      parts = ['archived the client ', { target: true }];
      break;
    case 'client.unarchived':
      parts = ['restored the archived client ', { target: true }];
      break;
    case 'client.deleted':
      parts = ['deleted the client ', { target: true }];
      break;
    case 'settings.updated':
      parts = ['changed the default settings'];
      targetLabel = null;
      break;
    case 'agent.approved':
      parts = ['approved the agent ', { target: true }];
      if (scopes.length) details.push(`Permissions: ${scopes.join(', ')}`);
      break;
    case 'agent.denied':
      parts = ['denied the agent ', { target: true }];
      break;
    case 'agent.registered':
      parts = ['connected and received its API key'];
      targetLabel = null;
      if (scopes.length) details.push(`Permissions: ${scopes.join(', ')}`);
      break;
    case 'agent.revoked':
      parts = ['revoked access for ', { target: true }];
      break;
    case 'agent.revoked_key_used':
      parts = ['tried to use its revoked key (refused)'];
      targetLabel = null;
      break;
    case 'sync.bulk_upload': {
      const counts = c.counts ?? {};
      const items = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => plural(n, k === 'invoices' ? 'invoice' : k === 'clients' ? 'client' : k.replace(/s$/, '')));
      parts = [`uploaded ${items.length ? listJoin(items) : 'local data'} to the cloud workspace`];
      targetLabel = null;
      break;
    }
    default:
      parts = entry.entity ? [`${entry.action} on `, { target: true }] : [entry.action];
  }
  if (parts.some((p) => typeof p !== 'string') && !targetLabel) {
    targetLabel = entry.entity?.type === 'invoice' ? 'an invoice' : entry.entity?.type === 'client' ? 'a client' : entry.entity?.type === 'agent' || entry.entity?.type === 'agent_registration' ? 'an agent' : 'an item';
  }
  if (c.theme && entry.action === 'invoice.pdf_downloaded') details.push(`${c.theme === 'light' ? 'Light' : 'Dark'} theme`);
  return { actor, parts, targetLabel, details };
}

/** The sentence without its subject ("marked INV-0007 as paid"). */
export function predicateOf(entry: ActivityEntry): string {
  const d = describeEntry(entry);
  return d.parts.map((p) => (typeof p === 'string' ? p : d.targetLabel)).join('');
}

/** The whole sentence as plain text (for tests, titles and screen readers). */
export function sentenceOf(entry: ActivityEntry): string {
  return `${actorName(entry)} ${predicateOf(entry)}`;
}

export function sourceLabel(entry: Pick<ActivityEntry, 'source' | 'tool'>): string | null {
  if (entry.source === 'mcp') return entry.tool ? `MCP · ${entry.tool}` : 'MCP';
  if (entry.source === 'rest') return null;
  return 'System';
}
