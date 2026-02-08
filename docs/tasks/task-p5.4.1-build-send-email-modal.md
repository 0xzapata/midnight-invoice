# Task: Build SendEmailModal Component

**Task ID**: P5.4.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Users need a modal interface to compose and preview emails before sending invoices. The modal should allow editing recipient, subject, and message while showing a preview of the email.

---

## Objective
Build a `SendEmailModal` component that:
- Provides a compose interface for invoice emails
- Pre-fills recipient with client's email
- Shows editable subject and custom message fields
- Displays real-time email preview
- Has send and cancel actions with loading states

---

## Implementation Plan

### 1. Create SendEmailModal Component
Create `src/components/emails/SendEmailModal.tsx`:

```typescript
import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Invoice } from '@/types/invoice';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Eye, Loader2 } from 'lucide-react';
import { InvoiceEmail } from '@/emails/InvoiceEmail';
import { render } from '@react-email/render';
import { useToast } from '@/hooks/use-toast';

interface SendEmailModalProps {
  invoice: Invoice;
  isOpen: boolean;
  onClose: () => void;
  onSent?: () => void;
}

const DEFAULT_MESSAGE = `Dear {{clientName}},

Please find attached the invoice for our recent work together.

If you have any questions, please don't hesitate to reach out.

Best regards,
{{senderName}}`;

export function SendEmailModal({ invoice, isOpen, onClose, onSent }: SendEmailModalProps) {
  const { toast } = useToast();
  const sendEmail = useMutation(api.emails.sendInvoiceEmail);
  
  const [to, setTo] = useState(invoice.toEmail || '');
  const [subject, setSubject] = useState(
    `Invoice ${invoice.invoiceNumber} from ${invoice.fromName}`
  );
  const [message, setMessage] = useState(
    DEFAULT_MESSAGE
      .replace('{{clientName}}', invoice.toName)
      .replace('{{senderName}}', invoice.fromName)
  );
  const [includePdf, setIncludePdf] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  
  const handlePreview = async () => {
    const emailComponent = InvoiceEmail({
      invoice,
      customMessage: message,
      fromName: invoice.fromName,
      fromEmail: invoice.fromEmail,
    });
    const html = await render(emailComponent);
    setPreviewHtml(html);
  };
  
  const handleSend = async () => {
    if (!to) {
      toast({
        title: 'Recipient required',
        description: 'Please enter a recipient email address.',
        variant: 'destructive',
      });
      return;
    }
    
    if (!subject) {
      toast({
        title: 'Subject required',
        description: 'Please enter a subject line.',
        variant: 'destructive',
      });
      return;
    }
    
    setIsSending(true);
    
    try {
      const result = await sendEmail({
        invoiceId: invoice._id,
        to,
        subject,
        message,
        includePdf,
      });
      
      if (result.success) {
        toast({
          title: 'Email sent!',
          description: `Invoice sent to ${to}`,
        });
        onSent?.();
        onClose();
      } else {
        toast({
          title: 'Failed to send',
          description: result.error || 'Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Invoice</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="compose" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="compose">Compose</TabsTrigger>
            <TabsTrigger value="preview" onClick={handlePreview}>
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="compose" className="space-y-4 mt-4">
            {/* Recipient */}
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@example.com"
              />
            </div>
            
            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Invoice #001 from Your Company"
              />
            </div>
            
            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a personal message..."
                rows={6}
              />
              <p className="text-xs text-muted-foreground">
                {message.length} characters
              </p>
            </div>
            
            {/* Options */}
            <div className="flex items-center space-x-2">
              <Switch
                id="includePdf"
                checked={includePdf}
                onCheckedChange={setIncludePdf}
              />
              <Label htmlFor="includePdf" className="cursor-pointer">
                Attach PDF invoice
              </Label>
            </div>
          </TabsContent>
          
          <TabsContent value="preview" className="mt-4">
            {previewHtml ? (
              <div 
                className="border rounded-lg overflow-hidden"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
                style={{ maxHeight: '400px', overflow: 'auto' }}
              />
            ) : (
              <div className="text-center text-muted-foreground py-12">
                Click Preview to see email
              </div>
            )}
          </TabsContent>
        </Tabs>
        
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSend} 
            disabled={isSending || !to || !subject}
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 2. Create Hook for Modal State
Create `src/hooks/useSendEmailModal.ts`:

```typescript
import { useState, useCallback } from 'react';
import { Invoice } from '@/types/invoice';

export function useSendEmailModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  
  const openModal = useCallback((invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsOpen(true);
  }, []);
  
  const closeModal = useCallback(() => {
    setIsOpen(false);
    setSelectedInvoice(null);
  }, []);
  
  return {
    isOpen,
    selectedInvoice,
    openModal,
    closeModal,
  };
}
```

---

## File Structure

```
src/
├── components/
│   └── emails/
│       ├── SendEmailModal.tsx      # Main modal component
│       └── index.ts                # Barrel export
├── hooks/
│   └── useSendEmailModal.ts        # Modal state hook
├── components/
│   └── ui/
│       ├── dialog.tsx              # shadcn dialog
│       ├── tabs.tsx                # shadcn tabs
│       └── switch.tsx              # shadcn switch
```

---

## Dependencies

- P5.3.1 (sendInvoiceEmail mutation)
- P5.2.1 (InvoiceEmail template)
- @react-email/render for preview

---

## Acceptance Criteria

- [ ] `SendEmailModal` with compose and preview tabs
- [ ] To field pre-filled with invoice's toEmail
- [ ] Subject field pre-filled with invoice number and sender name
- [ ] Message textarea with default template
- [ ] Include PDF toggle (default on)
- [ ] Real-time character count for message
- [ ] HTML preview rendered using React Email
- [ ] Form validation (required fields)
- [ ] Loading state during send
- [ ] Success/error toast notifications
- [ ] Modal closes on successful send
- [ ] useSendEmailModal hook for state management

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
