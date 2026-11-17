/**
 * Client (customer) domain types shared by the browser app and the API
 * Worker. A client is an address-book entry that invoices can be filled from;
 * invoices keep their own snapshot of the client's name, address and email
 * (an invoice is a document), plus an optional `clientId` reference.
 */
import type { Actor } from './invoice';

export interface Client {
  /** UUID, unique per workspace. */
  id: string;
  name: string;
  email: string;
  address: string;
  /** ISO 4217 code used for new invoices for this client (null/absent: workspace default). */
  defaultCurrency?: string | null;
  /** Tax rate in percent for new invoices for this client (null/absent: workspace default). */
  defaultTaxRate?: number | null;
  /** New invoices are due this many days after the issue date (null/absent: no due date). */
  paymentTermsDays?: number | null;
  /** Private notes about the client (never printed on invoices). */
  notes?: string;
  createdAt: string;
  /** Last change: set locally on edits, replaced by the server's clock once synced. */
  updatedAt: string;
  /** Archived clients are hidden from the invoice client picker but kept. */
  archivedAt?: string | null;

  // --- Optional fields set by the API server (absent on purely local clients) ---
  deletedAt?: string | null;
  revision?: number;
  createdBy?: Actor;
  updatedBy?: Actor;
}

/** What a person edits in the client form. */
export interface ClientFormData {
  name: string;
  email: string;
  address: string;
  defaultCurrency?: string | null;
  defaultTaxRate?: number | null;
  paymentTermsDays?: number | null;
  notes?: string;
}

/** Bounds shared by the client form and the API. */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 1000,
  notes: 5000,
  /** paymentTermsDays: 0-3650 (ten years). */
  maxPaymentTermsDays: 3650,
} as const;

/** Lower-cased, whitespace-collapsed name + email: the identity used to detect duplicates. */
export function clientDedupeKey(c: { name?: string; email?: string; toName?: string; toEmail?: string }): string {
  const norm = (s: string | undefined) => (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(c.name ?? c.toName)}\u0000${norm(c.email ?? c.toEmail)}`;
}

/** `issueDate` (YYYY-MM-DD) + `days`, as YYYY-MM-DD (UTC calendar arithmetic). */
export function addDaysIso(issueDate: string, days: number): string {
  const t = Date.parse(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
