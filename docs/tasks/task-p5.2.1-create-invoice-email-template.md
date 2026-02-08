# Task: Create InvoiceEmail Template

**Task ID**: P5.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Email

---

## Problem Statement
We need a professional, responsive HTML email template for sending invoices to clients. The email should display key invoice information and include the PDF attachment.

---

## Objective
Create an `InvoiceEmail` React Email template that:
- Displays professionally across email clients
- Shows key invoice details (number, amount, due date)
- Supports custom personalized messages
- Includes a prominent payment button (if payment link available)
- Has clean, branded styling
- Renders correctly in major email clients (Gmail, Outlook, Apple Mail)

---

## Implementation Plan

### 1. Create InvoiceEmail Component
Create `src/emails/InvoiceEmail.tsx`:

```typescript
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Link,
  Row,
  Column,
} from '@react-email/components';
import { Invoice } from '@/types/invoice';

interface InvoiceEmailProps {
  invoice: Invoice;
  customMessage?: string;
  fromName: string;
  fromEmail: string;
  paymentLink?: string;
  viewInvoiceUrl?: string;
}

export function InvoiceEmail({
  invoice,
  customMessage,
  fromName,
  fromEmail,
  paymentLink,
  viewInvoiceUrl,
}: InvoiceEmailProps) {
  const total = invoice.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0
  ) * (1 + (invoice.taxRate || 0) / 100);

  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: invoice.currency || 'USD',
  }).format(total);

  const dueDateText = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'On Receipt';

  return (
    <Html>
      <Head />
      <Preview>
        Invoice {invoice.invoiceNumber} from {fromName} - {formattedTotal}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={brand}>{fromName}</Text>
          </Section>

          {/* Custom Message */}
          {customMessage && (
            <Section style={messageSection}>
              <Text style={messageText}>{customMessage}</Text>
            </Section>
          )}

          {/* Invoice Details */}
          <Section style={invoiceSection}>
            <Text style={invoiceTitle}>Invoice {invoice.invoiceNumber}</Text>

            <Row style={detailRow}>
              <Column style={detailLabel}>Amount Due:</Column>
              <Column style={detailValue}>{formattedTotal}</Column>
            </Row>

            <Row style={detailRow}>
              <Column style={detailLabel}>Due Date:</Column>
              <Column style={detailValue}>{dueDateText}</Column>
            </Row>

            <Row style={detailRow}>
              <Column style={detailLabel}>Billed To:</Column>
              <Column style={detailValue}>{invoice.toName}</Column>
            </Row>
          </Section>

          {/* Payment Button */}
          {paymentLink && (
            <Section style={buttonSection}>
              <Button href={paymentLink} style={paymentButton}>
                Pay Invoice
              </Button>
            </Section>
          )}

          {/* View Online */}
          {viewInvoiceUrl && (
            <Section style={viewOnlineSection}>
              <Text style={viewOnlineText}>
                Or{' '}
                <Link href={viewInvoiceUrl} style={link}>
                  view your invoice online
                </Link>
              </Text>
            </Section>
          )}

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Please find the detailed invoice attached as a PDF.
            </Text>
            <Text style={footerText}>
              If you have any questions, reply to this email or contact{' '}
              <Link href={`mailto:${fromEmail}`} style={link}>
                {fromEmail}
              </Link>
            </Text>
            <Text style={copyright}>
              © {new Date().getFullYear()} {fromName}. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '600px',
};

const header = {
  marginBottom: '32px',
};

const brand = {
  fontSize: '20px',
  fontWeight: '600',
  color: '#1e3a5f',
  margin: '0',
};

const messageSection = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '32px',
};

const messageText = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0',
};

const invoiceSection = {
  marginBottom: '32px',
};

const invoiceTitle = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#111827',
  margin: '0 0 24px 0',
};

const detailRow = {
  marginBottom: '12px',
};

const detailLabel = {
  width: '40%',
  fontSize: '14px',
  color: '#6b7280',
};

const detailValue = {
  width: '60%',
  fontSize: '14px',
  fontWeight: '600',
  color: '#111827',
};

const buttonSection = {
  textAlign: 'center' as const,
  marginBottom: '24px',
};

const paymentButton = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '16px 32px',
  borderRadius: '6px',
  margin: '0 auto',
};

const viewOnlineSection = {
  textAlign: 'center' as const,
  marginBottom: '32px',
};

const viewOnlineText = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0',
};

const link = {
  color: '#3b82f6',
  textDecoration: 'underline',
};

const divider = {
  borderColor: '#e5e7eb',
  margin: '32px 0',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 12px 0',
  lineHeight: '1.5',
};

const copyright = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '24px 0 0 0',
};

export default InvoiceEmail;
```

### 2. Test Email Rendering
Test in React Email dev server:
```bash
npm run email:dev
```

### 3. Email Client Compatibility
Test email renders correctly in:
- Gmail (web and mobile)
- Outlook (web and desktop)
- Apple Mail
- Yahoo Mail

---

## File Structure

```
src/
├── emails/
│   ├── InvoiceEmail.tsx      # Main invoice email template
│   └── components/
│       └── EmailLayout.tsx   # (optional shared layout)
└── types/
    └── invoice.ts            # Invoice type definition
```

---

## Dependencies

- P5.1.2 (Resend and React Email installed)
- @react-email/components

---

## Acceptance Criteria

- [ ] `InvoiceEmail` component created with all required props
- [ ] Email displays invoice number, amount, due date, and recipient
- [ ] Custom message section conditionally rendered
- [ ] Payment button displayed when paymentLink provided
- [ ] "View online" link displayed when viewInvoiceUrl provided
- [ ] Professional styling with proper spacing
- [ ] Dark text on light background for readability
- [ ] Properly formatted currency based on invoice currency
- [ ] Renders correctly in React Email dev server
- [ ] Email client compatibility verified

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
