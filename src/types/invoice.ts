export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  price: number;
}

export interface Invoice {
  version?: number;
  id: string;
  invoiceNumber: string;
  invoiceName?: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
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
}
