/**
 * Invoice template domain types shared by the browser app and the API
 * Worker. A template is a reusable blueprint (line items, terms, notes, an
 * optional default client). Creating an invoice from it copies its values
 * into an ordinary, independent invoice (a snapshot: later template edits
 * never change that invoice), which records the optional `templateId`.
 *
 * "Not set" values fall through to the client's defaults and then the
 * workspace settings: `null` for taxRate / currency / paymentTermsDays /
 * clientId, and "" for the text fields.
 */
import type { Actor, LineItem } from './invoice';
import { addDaysIso } from './client';
import { mergePlaceholderReports, resolvePlaceholders, type PlaceholderContext, type PlaceholderResult } from '../template-placeholders';

export interface TemplateLineItem {
  id: string;
  /** May contain placeholders, e.g. "Retainer {{month_name}} {{year}}". */
  description: string;
  quantity: number;
  price: number;
}

export interface InvoiceTemplate {
  /** UUID, unique per workspace. */
  id: string;
  name: string;
  /** What the template is for (shown in the app and to agents; never printed). */
  description: string;
  /** Saved client new invoices are billed to by default (null: none). */
  clientId: string | null;
  lineItems: TemplateLineItem[];
  /** Percent (null: client default, then workspace setting). */
  taxRate: number | null;
  /** ISO 4217 code (null: client default, then workspace setting). */
  currency: string | null;
  /** Printed notes; may contain placeholders ("": workspace default notes). */
  notes: string;
  /** Payment instructions ("": workspace default). */
  paymentDetails: string;
  /** Due date = issue date + this many days (null: client terms, else none). */
  paymentTermsDays: number | null;
  /** Invoice name; may contain placeholders ("": the app's usual naming). */
  invoiceNamePattern: string;
  createdAt: string;
  /** Last change: set locally on edits, replaced by the server's clock once synced. */
  updatedAt: string;
  /** Archived templates are hidden from the "New from template" pickers but kept. */
  archivedAt: string | null;

  // --- Optional fields set by the API server (absent on purely local templates) ---
  deletedAt?: string | null;
  revision?: number;
  createdBy?: Actor;
  updatedBy?: Actor;
}

/** What a person edits in the template form. */
export type TemplateFormData = Pick<
  InvoiceTemplate,
  'name' | 'description' | 'clientId' | 'lineItems' | 'taxRate' | 'currency' | 'notes' | 'paymentDetails' | 'paymentTermsDays' | 'invoiceNamePattern'
>;

/** Bounds shared by the template form and the API (text limits match invoices). */
export const TEMPLATE_LIMITS = {
  name: 200,
  description: 1000,
  invoiceNamePattern: 200,
  lineDescription: 1000,
  maxLineItems: 200,
  notes: 5000,
  paymentDetails: 5000,
  maxPaymentTermsDays: 3650,
} as const;

/** Invoice fields a template supplies. Only what the template sets is present. */
export interface TemplateInvoiceFields {
  invoiceName?: string;
  lineItems: LineItem[];
  notes?: string;
  paymentDetails?: string;
  taxRate?: number;
  currency?: string;
  dueDate?: string;
  clientId?: string;
}

export type TemplateApplication = {
  fields: TemplateInvoiceFields;
} & Pick<PlaceholderResult, 'unknown' | 'unresolved'>;

/**
 * The invoice fields `template` supplies for an invoice issued on
 * `ctx.issueDate`, with placeholders resolved in the invoice name, line
 * descriptions and notes. Line items get fresh ids (`newId`), so the invoice
 * shares nothing with the template. Pure apart from `newId`.
 *
 * Callers layer the precedence on top: explicit values > these fields >
 * client defaults > workspace settings.
 */
export function invoiceFieldsFromTemplate(
  template: Pick<InvoiceTemplate, 'clientId' | 'lineItems' | 'taxRate' | 'currency' | 'notes' | 'paymentDetails' | 'paymentTermsDays' | 'invoiceNamePattern'>,
  ctx: PlaceholderContext,
  newId: () => string,
): TemplateApplication {
  const reports: Pick<PlaceholderResult, 'unknown' | 'unresolved'>[] = [];
  const resolve = (text: string) => {
    const r = resolvePlaceholders(text, ctx);
    reports.push(r);
    return r.text;
  };
  const fields: TemplateInvoiceFields = {
    lineItems: template.lineItems.map((li) => ({ id: newId(), description: resolve(li.description), quantity: li.quantity, price: li.price })),
  };
  if (template.invoiceNamePattern.trim()) fields.invoiceName = resolve(template.invoiceNamePattern.trim());
  if (template.notes) fields.notes = resolve(template.notes);
  if (template.paymentDetails) fields.paymentDetails = template.paymentDetails;
  if (template.taxRate != null) fields.taxRate = template.taxRate;
  if (template.currency) fields.currency = template.currency;
  if (template.paymentTermsDays != null && ctx.issueDate) fields.dueDate = addDaysIso(ctx.issueDate, template.paymentTermsDays);
  if (template.clientId) fields.clientId = template.clientId;
  return { fields, ...mergePlaceholderReports(reports) };
}
