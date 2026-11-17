/**
 * Invoice domain types shared by the browser app (src/) and the API Worker
 * (server/, worker/). `src/types/invoice.ts` re-exports this module, so
 * existing `@/types/invoice` imports keep working.
 */

import type { InvoiceStatus } from '../invoice-status';

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  price: number;
}

/**
 * Who made a change. `user` = the workspace owner (workspace token, i.e. the
 * browser app); `agent` = an approved AI agent acting with its own API key.
 */
export interface Actor {
  type: 'user' | 'agent';
  agentId?: string;
  agentName?: string;
}

export interface Invoice {
  version?: number;
  id: string;
  invoiceNumber: string;
  invoiceName?: string;
  issueDate: string;
  dueDate?: string;
  fromName: string;
  fromAddress: string;
  fromEmail: string;
  toName: string;
  toAddress: string;
  toEmail: string;
  lineItems: LineItem[];
  taxRate: number;
  notes: string;
  paymentDetails: string;
  currency: string;
  createdAt: string;
  /** The saved client this invoice was billed to (to* fields are a snapshot; editing the client never changes them). */
  clientId?: string;
  /** The template this invoice was created from (a reference only: the invoice is a snapshot, template edits never change it). */
  templateId?: string;

  // --- Status (shared/invoice-status.ts). Absent on invoices saved before statuses existed = draft. ---
  status?: InvoiceStatus;
  /** Date marked sent (YYYY-MM-DD). */
  sentAt?: string | null;
  /** Date paid (YYYY-MM-DD); set iff status is paid. */
  paidAt?: string | null;

  // --- Optional fields set by the API server (absent on purely local invoices) ---
  /** ISO timestamp of the last server-side write. */
  updatedAt?: string;
  /** ISO timestamp of the soft delete; only present on tombstones. */
  deletedAt?: string | null;
  /** Server revision, incremented on every write (also sent as the ETag). */
  revision?: number;
  createdBy?: Actor;
  updatedBy?: Actor;
}

export interface InvoiceFormData {
  invoiceNumber: string;
  invoiceName?: string;
  issueDate: string;
  dueDate?: string;
  fromName: string;
  fromAddress: string;
  fromEmail: string;
  toName: string;
  toAddress: string;
  toEmail: string;
  lineItems: LineItem[];
  taxRate: number;
  notes: string;
  paymentDetails: string;
  currency: string;
  /** See Invoice.clientId. */
  clientId?: string;
  /** See Invoice.templateId. */
  templateId?: string;
}
