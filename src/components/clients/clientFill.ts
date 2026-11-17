/**
 * How a saved client fills an invoice form. Same precedence as the API
 * (AGENT_API.md "Billing a saved client"): the client's name, address and
 * email replace the Bill To fields (picking a client is an explicit choice);
 * its default currency, tax rate and payment terms only fill fields the user
 * has not changed in this form, so nothing they typed is overwritten.
 */
import { addDaysIso, clientDedupeKey, type Client } from '../../../shared/types/client';
import type { InvoiceFormData } from '@/types/invoice';

/** Which of the defaultable fields the user already changed in this form. */
export interface TouchedFields {
  currency: boolean;
  taxRate: boolean;
  dueDate: boolean;
}

export function clientFillPatch(client: Client, values: InvoiceFormData, touched: TouchedFields): Partial<InvoiceFormData> {
  const patch: Partial<InvoiceFormData> = {
    clientId: client.id,
    toName: client.name,
    toAddress: client.address,
    toEmail: client.email,
  };
  if (client.defaultCurrency && !touched.currency) patch.currency = client.defaultCurrency;
  if (client.defaultTaxRate != null && !touched.taxRate) patch.taxRate = client.defaultTaxRate;
  if (client.paymentTermsDays != null && !touched.dueDate && !values.dueDate && values.issueDate) {
    patch.dueDate = addDaysIso(values.issueDate, client.paymentTermsDays);
  }
  return patch;
}

export type BillToState =
  /** Nothing typed yet. */
  | { kind: 'empty' }
  /** Linked to a saved client and the Bill To matches it. */
  | { kind: 'linked'; client: Client }
  /** Linked, but name/email/address were edited: offer "Update client". */
  | { kind: 'changed'; client: Client }
  /** Not linked, but a saved client has the same name + email: offer to link it. */
  | { kind: 'matches'; client: Client }
  /** Not linked and new: offer "Save as client". */
  | { kind: 'new' };

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();

export function billToState(values: Pick<InvoiceFormData, 'clientId' | 'toName' | 'toEmail' | 'toAddress'>, clients: Client[]): BillToState {
  const linked = values.clientId ? clients.find((c) => c.id === values.clientId) : undefined;
  if (linked) {
    const unchanged = same(linked.name, values.toName) && same(linked.email, values.toEmail) && same(linked.address, values.toAddress);
    return unchanged ? { kind: 'linked', client: linked } : { kind: 'changed', client: linked };
  }
  if (!values.toName?.trim()) return { kind: 'empty' };
  const key = clientDedupeKey(values);
  const match = clients.find((c) => clientDedupeKey(c) === key);
  return match ? { kind: 'matches', client: match } : { kind: 'new' };
}

/** A complete new-invoice draft billed to `client` ("New invoice for this client"). */
export function newInvoiceDraftForClient(client: Client, invoiceNumber: string, today = new Date().toISOString().slice(0, 10)): InvoiceFormData {
  return {
    invoiceNumber,
    invoiceName: '',
    issueDate: today,
    dueDate: client.paymentTermsDays != null ? addDaysIso(today, client.paymentTermsDays) : '',
    fromName: '',
    fromAddress: '',
    fromEmail: '',
    toName: client.name,
    toAddress: client.address,
    toEmail: client.email,
    lineItems: [{ id: crypto.randomUUID(), description: '', quantity: 1, price: 0 }],
    taxRate: client.defaultTaxRate ?? 0,
    notes: '',
    paymentDetails: '',
    currency: client.defaultCurrency || 'USD',
    clientId: client.id,
  };
}
