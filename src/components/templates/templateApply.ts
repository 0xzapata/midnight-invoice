/**
 * How a template fills an invoice in the app. Same precedence as the API
 * (AGENT_API.md "Creating an invoice from a template"):
 *
 *   what the user typed / chose → template → client defaults → settings
 *
 * The template's own values come from the shared invoiceFieldsFromTemplate
 * (placeholders resolved against the invoice's issue date), so the app and
 * POST /templates/:id/instantiate produce the same invoice.
 */
import { addDaysIso, type Client } from '../../../shared/types/client';
import { invoiceFieldsFromTemplate, type InvoiceTemplate } from '../../../shared/types/template';
import type { DefaultSettings } from '../../../shared/settings';
import type { InvoiceFormData, LineItem } from '@/types/invoice';

export interface PlaceholderReport {
  unknown: string[];
  unresolved: string[];
}

const lineIsBlank = (li: LineItem) => !li.description.trim() && !li.price;

/** True when nothing a template would set has been typed yet (a fresh invoice form). */
export function isPristineForTemplate(values: InvoiceFormData): boolean {
  return (
    values.lineItems.every(lineIsBlank) &&
    !values.notes.trim() &&
    !values.invoiceName?.trim() &&
    !values.toName.trim() &&
    !values.clientId &&
    !values.templateId
  );
}

/**
 * A complete new-invoice draft from `template` ("New from template" on the
 * dashboard and the Templates page). The template's client (if it still
 * exists and is not archived) fills Bill To; then the template, the client's
 * defaults and the settings fill the rest, in that order.
 */
export function newInvoiceDraftFromTemplate(
  template: InvoiceTemplate,
  opts: { clients: Client[]; settings: DefaultSettings; invoiceNumber: string; today: string },
): { draft: InvoiceFormData; report: PlaceholderReport } {
  const client = template.clientId ? opts.clients.find((c) => c.id === template.clientId) : undefined;
  const { fields, unknown, unresolved } = invoiceFieldsFromTemplate(
    template,
    { issueDate: opts.today, clientName: client?.name, invoiceNumber: opts.invoiceNumber },
    () => crypto.randomUUID(),
  );
  const s = opts.settings;
  const dueDate = fields.dueDate ?? (client?.paymentTermsDays != null ? addDaysIso(opts.today, client.paymentTermsDays) : '');
  const draft: InvoiceFormData = {
    invoiceNumber: opts.invoiceNumber,
    invoiceName: fields.invoiceName ?? '',
    issueDate: opts.today,
    dueDate,
    fromName: s.fromName,
    fromAddress: s.fromAddress,
    fromEmail: s.fromEmail,
    toName: client?.name ?? '',
    toAddress: client?.address ?? '',
    toEmail: client?.email ?? '',
    lineItems: fields.lineItems.length ? fields.lineItems : [{ id: crypto.randomUUID(), description: '', quantity: 1, price: 0 }],
    taxRate: fields.taxRate ?? client?.defaultTaxRate ?? s.taxRate ?? 0,
    notes: fields.notes ?? '',
    paymentDetails: fields.paymentDetails ?? s.paymentDetails,
    currency: fields.currency ?? client?.defaultCurrency ?? s.currency ?? 'USD',
    templateId: template.id,
  };
  if (client) draft.clientId = client.id;
  return { draft, report: { unknown, unresolved } };
}

export type ApplyMode = 'replace' | 'merge';

/**
 * The form changes that apply `template` to an invoice being edited.
 *
 * - `replace`: the template's line items, invoice name and notes replace the
 *   form's; its client, currency, tax rate and terms replace the form's
 *   where the template sets them. Fields the template does not set are kept.
 * - `merge` (never overwrites anything typed): the template's lines are
 *   added after the non-blank lines; name, notes, Bill To and due date are
 *   filled only when empty; currency and tax rate only when the user has not
 *   changed them (`touched`).
 *
 * Placeholders are resolved against the form's issue date, the (resulting)
 * Bill To name and the invoice number.
 */
export function templateFormPatch(
  template: InvoiceTemplate,
  values: InvoiceFormData,
  opts: { clients: Client[]; mode: ApplyMode; touched: { currency: boolean; taxRate: boolean }; today: string },
): { patch: Partial<InvoiceFormData>; report: PlaceholderReport } {
  const replace = opts.mode === 'replace';
  const templateClient = template.clientId ? opts.clients.find((c) => c.id === template.clientId) : undefined;
  const useClient = templateClient && (replace || (!values.toName.trim() && !values.clientId));
  const issueDate = values.issueDate || opts.today;
  const clientName = useClient ? templateClient.name : values.toName;
  const { fields, unknown, unresolved } = invoiceFieldsFromTemplate(
    template,
    { issueDate, clientName, invoiceNumber: values.invoiceNumber },
    () => crypto.randomUUID(),
  );

  const patch: Partial<InvoiceFormData> = { templateId: template.id };
  if (replace) {
    if (fields.lineItems.length) patch.lineItems = fields.lineItems;
    if (fields.invoiceName !== undefined) patch.invoiceName = fields.invoiceName;
    if (fields.notes !== undefined) patch.notes = fields.notes;
    if (fields.paymentDetails !== undefined) patch.paymentDetails = fields.paymentDetails;
    if (fields.dueDate !== undefined) patch.dueDate = fields.dueDate;
    if (fields.currency !== undefined) patch.currency = fields.currency;
    if (fields.taxRate !== undefined) patch.taxRate = fields.taxRate;
  } else {
    const kept = values.lineItems.filter((li) => !lineIsBlank(li));
    if (fields.lineItems.length) patch.lineItems = [...kept, ...fields.lineItems];
    if (fields.invoiceName !== undefined && !values.invoiceName?.trim()) patch.invoiceName = fields.invoiceName;
    if (fields.notes !== undefined && !values.notes.trim()) patch.notes = fields.notes;
    if (fields.paymentDetails !== undefined && !values.paymentDetails.trim()) patch.paymentDetails = fields.paymentDetails;
    if (fields.dueDate !== undefined && !values.dueDate) patch.dueDate = fields.dueDate;
    if (fields.currency !== undefined && !opts.touched.currency) patch.currency = fields.currency;
    if (fields.taxRate !== undefined && !opts.touched.taxRate) patch.taxRate = fields.taxRate;
  }
  if (useClient) {
    patch.clientId = templateClient.id;
    patch.toName = templateClient.name;
    patch.toAddress = templateClient.address;
    patch.toEmail = templateClient.email;
    // The client's defaults fill what the template leaves open.
    if (patch.currency === undefined && templateClient.defaultCurrency && (replace || !opts.touched.currency)) patch.currency = templateClient.defaultCurrency;
    if (patch.taxRate === undefined && templateClient.defaultTaxRate != null && (replace || !opts.touched.taxRate)) patch.taxRate = templateClient.defaultTaxRate;
    if (patch.dueDate === undefined && templateClient.paymentTermsDays != null && (replace || !values.dueDate)) {
      patch.dueDate = addDaysIso(issueDate, templateClient.paymentTermsDays);
    }
  }
  return { patch, report: { unknown, unresolved } };
}

/** One sentence for a toast about placeholders that were left in the text, or null. */
export function describePlaceholderReport(report: PlaceholderReport): string | null {
  const parts: string[] = [];
  if (report.unresolved.length) parts.push(`no value for ${report.unresolved.map((n) => `{{${n}}}`).join(', ')}`);
  if (report.unknown.length) parts.push(`unknown ${report.unknown.map((n) => `{{${n}}}`).join(', ')}`);
  return parts.length ? `Left as typed: ${parts.join('; ')}.` : null;
}
