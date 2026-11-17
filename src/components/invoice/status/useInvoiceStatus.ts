import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Invoice } from '@/types/invoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import {
  bucketOf,
  localToday,
  STATUS_LABELS,
  summarizeInvoices,
  type StatusAction,
  type StatusBucket,
} from '../../../../shared/invoice-status';

/**
 * The user's local calendar date, refreshed every minute so "overdue"
 * flips at local midnight without a reload.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localToday());
  useEffect(() => {
    const timer = setInterval(() => setToday(localToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

/** "3 days overdue" / "1 day overdue". */
export function overdueLabel(days: number): string {
  return `${days} day${days === 1 ? '' : 's'} overdue`;
}

export type StatusFilter = 'all' | Exclude<StatusBucket, 'void'>;

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

/** Dashboard view of the local invoices: buckets, counts, filtered list and totals. Works offline. */
export function useInvoiceStatusView(invoices: Invoice[], filter: StatusFilter) {
  const today = useToday();
  return useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: invoices.length, draft: 0, outstanding: 0, overdue: 0, paid: 0 };
    for (const invoice of invoices) {
      const bucket = bucketOf(invoice, today);
      if (bucket !== 'void') counts[bucket] += 1;
    }
    const filtered = filter === 'all' ? invoices : invoices.filter((inv) => bucketOf(inv, today) === filter);
    return { today, counts, filtered, summary: summarizeInvoices(invoices, today, { oldestOverdueLimit: 0 }) };
  }, [invoices, filter, today]);
}

const DONE_MESSAGES: Record<StatusAction, string> = {
  mark_sent: 'marked as sent',
  mark_paid: 'marked as paid',
  void: 'voided',
  reopen: 'reopened',
};

/** Runs a status action through the store (shared transition rules) and tells the user. */
export function useStatusAction() {
  const setInvoiceStatus = useInvoiceStore((s) => s.setInvoiceStatus);
  return (invoice: Pick<Invoice, 'id' | 'invoiceNumber'>, action: StatusAction) => {
    const result = setInvoiceStatus(invoice.id, action);
    if (result.ok === false) {
      toast.error(`${invoice.invoiceNumber} was not changed`, { description: result.message });
      return;
    }
    const label = STATUS_LABELS[result.fields.status];
    toast.success(`${invoice.invoiceNumber} ${DONE_MESSAGES[action]}`, { description: `Status: ${label}` });
  };
}
