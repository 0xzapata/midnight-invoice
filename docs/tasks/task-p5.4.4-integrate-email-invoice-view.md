# Task: Integrate Email Sending into Invoice View

**Task ID**: P5.4.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
The invoice detail and list views need to integrate email functionality so users can send invoices and see email status without navigating away.

---

## Objective
Integrate email components into the invoice view:
- Add Send button to invoice detail page
- Show email status badge in invoice list and detail
- Display email history in invoice detail
- Add quick send action in invoice list row actions

---

## Implementation Plan

### 1. Update InvoiceDetail Page
Update `src/pages/InvoiceDetail.tsx`:

```typescript
import { useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Send, Download, Edit, Trash2 } from 'lucide-react';
import { SendEmailModal } from '@/components/emails/SendEmailModal';
import { EmailHistory } from '@/components/emails/EmailHistory';
import { EmailStatusBadge } from '@/components/emails/EmailStatusBadge';
import { useSendEmailModal } from '@/hooks/useSendEmailModal';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const invoice = useQuery(api.invoices.getInvoice, { invoiceId: id! });
  const { isOpen, selectedInvoice, openModal, closeModal } = useSendEmailModal();
  
  if (!invoice) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Invoice {invoice.invoiceNumber}</h1>
          <div className="flex items-center gap-3 mt-2">
            <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
              {invoice.status}
            </Badge>
            <EmailStatusBadge invoiceId={invoice._id} />
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => openModal(invoice)}
          >
            <Send className="w-4 h-4 mr-2" />
            Send Invoice
          </Button>
          
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
          
          <Button variant="outline" size="icon">
            <Edit className="w-4 h-4" />
          </Button>
          
          <Button variant="outline" size="icon" className="text-destructive">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Invoice Preview */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <InvoicePDF data={invoice} />
            </CardContent>
          </Card>
        </div>
        
        {/* Sidebar */}
        <div className="space-y-6">
          {/* Invoice Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoice Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">From</p>
                <p className="font-medium">{invoice.fromName}</p>
                <p className="text-sm">{invoice.fromEmail}</p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground">To</p>
                <p className="font-medium">{invoice.toName}</p>
                <p className="text-sm">{invoice.toEmail}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Issue Date</p>
                  <p className="font-medium">{invoice.issueDate}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium">{invoice.dueDate || 'On Receipt'}</p>
                </div>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="text-2xl font-bold">
                  ${invoice.total.toFixed(2)} {invoice.currency}
                </p>
              </div>
            </CardContent>
          </Card>
          
          {/* Email History */}
          <EmailHistory invoiceId={invoice._id} />
        </div>
      </div>
      
      {/* Send Email Modal */}
      <SendEmailModal
        invoice={invoice}
        isOpen={isOpen}
        onClose={closeModal}
        onSent={() => {
          // Refresh invoice data
        }}
      />
    </div>
  );
}
```

### 2. Update InvoiceList
Update `src/components/invoices/InvoiceList.tsx`:

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, MoreHorizontal, FileText } from 'lucide-react';
import { EmailStatusIcon } from '@/components/emails/EmailStatusBadge';
import { useSendEmailModal } from '@/hooks/useSendEmailModal';
import { SendEmailModal } from '@/components/emails/SendEmailModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';

export function InvoiceList() {
  const invoices = useQuery(api.invoices.listInvoices);
  const { isOpen, selectedInvoice, openModal, closeModal } = useSendEmailModal();
  
  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices?.map(invoice => (
              <TableRow key={invoice._id}>
                <TableCell>
                  <Link 
                    to={`/invoice/${invoice._id}`}
                    className="font-medium hover:underline"
                  >
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{invoice.toName}</p>
                    <p className="text-sm text-muted-foreground">{invoice.toEmail}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p>{invoice.issueDate}</p>
                    <p className="text-sm text-muted-foreground">
                      Due: {invoice.dueDate || 'On Receipt'}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  ${invoice.total.toFixed(2)}
                </TableCell>
                <TableCell>
                  <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
                    {invoice.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <EmailStatusIcon invoiceId={invoice._id} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openModal(invoice)}
                      title="Send Invoice"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/invoice/${invoice._id}`}>
                            <FileText className="w-4 h-4 mr-2" />
                            View Details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openModal(invoice)}>
                          <Send className="w-4 h-4 mr-2" />
                          Send Email
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {selectedInvoice && (
        <SendEmailModal
          invoice={selectedInvoice}
          isOpen={isOpen}
          onClose={closeModal}
        />
      )}
    </>
  );
}
```

---

## File Structure

```
src/
├── pages/
│   └── InvoiceDetail.tsx           # Updated with email integration
├── components/
│   ├── invoices/
│   │   └── InvoiceList.tsx         # Updated with email actions
│   └── emails/
│       ├── SendEmailModal.tsx      # From P5.4.1
│       ├── EmailStatusBadge.tsx    # From P5.4.2
│       └── EmailHistory.tsx        # From P5.4.3
├── hooks/
│   └── useSendEmailModal.ts        # Modal state hook
```

---

## Dependencies

- P5.4.1 (SendEmailModal)
- P5.4.2 (EmailStatusBadge)
- P5.4.3 (EmailHistory)
- Existing InvoiceDetail and InvoiceList components

---

## Acceptance Criteria

- [ ] Send Invoice button added to InvoiceDetail header
- [ ] Email status badge displayed next to invoice status
- [ ] EmailHistory component in sidebar of InvoiceDetail
- [ ] Email status icon in InvoiceList table
- [ ] Quick send button in InvoiceList row actions
- [ ] Send action in row dropdown menu
- [ ] Modal opens with correct invoice data
- [ ] Invoice list refreshes after email sent
- [ ] Proper layout on desktop (2-column) and mobile (stacked)
- [ ] All email-related components integrated seamlessly

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
