import type { Invoice } from '@/types/invoice';

/** "by <agent>" (created by an agent) or "edited by <agent>" (last changed by one); null for the user's own invoices. */
export function agentAttribution(invoice: Pick<Invoice, 'createdBy' | 'updatedBy'>): { verb: 'by' | 'edited by'; name: string } | null {
  if (invoice.createdBy?.type === 'agent') return { verb: 'by', name: invoice.createdBy.agentName || 'an agent' };
  if (invoice.updatedBy?.type === 'agent') return { verb: 'edited by', name: invoice.updatedBy.agentName || 'an agent' };
  return null;
}
