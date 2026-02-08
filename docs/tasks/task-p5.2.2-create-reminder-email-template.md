# Task: Create ReminderEmail Template

**Task ID**: P5.2.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Email

---

## Problem Statement
Users need to send professional reminder emails for overdue invoices. The reminder should be firm but polite, and encourage prompt payment.

---

## Objective
Create a `ReminderEmail` React Email template that:
- Has a professional, firm but polite tone
- Clearly states the overdue status and days overdue
- Shows the invoice details and amount
- Includes a prominent payment button
- Offers payment plan or contact options for disputes

---

## Implementation Plan

### 1. Create ReminderEmail Component
Create `src/emails/ReminderEmail.tsx`:

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

type ReminderType = 'friendly' | 'firm' | 'final';

interface ReminderEmailProps {
  invoice: Invoice;
  fromName: string;
  fromEmail: string;
  daysOverdue: number;
  reminderType: ReminderType;
  paymentLink?: string;
  customMessage?: string;
}

const REMINDER_COPY: Record<ReminderType, { subject: string; tone: string; urgency: string }> = {
  friendly: {
    subject: 'Friendly Reminder: Invoice {invoiceNumber} Due',
    tone: 'Just a friendly reminder that the following invoice is now {daysOverdue} days overdue. If you\'ve already sent payment, please disregard this message.',
    urgency: 'When you have a moment, please submit your payment using the button below.',
  },
  firm: {
    subject: 'Reminder: Invoice {invoiceNumber} is {daysOverdue} Days Overdue',
    tone: 'This is a reminder that invoice {invoiceNumber} for {amount} is now {daysOverdue} days overdue. Please prioritize this payment.',
    urgency: 'Please submit your payment as soon as possible to avoid any late fees.',
  },
  final: {
    subject: 'FINAL NOTICE: Invoice {invoiceNumber} - Action Required',
    tone: 'Despite our previous reminders, invoice {invoiceNumber} for {amount} remains unpaid and is now {daysOverdue} days overdue. This is our final notice before escalating this matter.',
    urgency: 'Immediate payment is required to avoid further action. Please pay now using the button below.',
  },
};

export function ReminderEmail({
  invoice,
  fromName,
  fromEmail,
  daysOverdue,
  reminderType,
  paymentLink,
  customMessage,
}: ReminderEmailProps) {
  const copy = REMINDER_COPY[reminderType];
  
  const total = invoice.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0
  ) * (1 + (invoice.taxRate || 0) / 100);

  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: invoice.currency || 'USD',
  }).format(total);

  const subject = copy.subject
    .replace('{invoiceNumber}', invoice.invoiceNumber);

  const toneText = copy.tone
    .replace('{invoiceNumber}', invoice.invoiceNumber)
    .replace('{amount}', formattedTotal)
    .replace('{daysOverdue}', String(daysOverdue));

  const buttonColor = reminderType === 'final' ? '#dc2626' : '#000000';
  const buttonText = reminderType === 'final' ? 'Pay Immediately' : 'Pay Invoice';

  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={brand}>{fromName}</Text>
          </Section>

          {/* Reminder Banner */}
          <Section style={{
            ...reminderBanner,
            backgroundColor: reminderType === 'final' ? '#fef2f2' : '#fffbeb',
            borderColor: reminderType === 'final' ? '#fecaca' : '#fde68a',
          }}>
            <Text style={{
              ...reminderTitle,
              color: reminderType === 'final' ? '#dc2626' : '#d97706',
            }}>
              {reminderType === 'friendly' && '⏰ Friendly Reminder'}
              {reminderType === 'firm' && '⚠️ Payment Overdue'}
              {reminderType === 'final' && '🚨 Final Notice'}
            </Text>
            <Text style={reminderSubtitle}>
              Invoice {invoice.invoiceNumber} is {daysOverdue} days overdue
            </Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Text style={greeting}>Dear {invoice.toName},</Text>
            
            <Text style={bodyText}>{toneText}</Text>

            {customMessage && (
              <Section style={customMessageSection}>
                <Text style={bodyText}>{customMessage}</Text>
              </Section>
            )}
          </Section>

          {/* Invoice Summary */}
          <Section style={invoiceSection}>
            <Text style={sectionTitle}>Invoice Summary</Text>
            
            <Row style={detailRow}>
              <Column style={detailLabel}>Invoice Number:</Column>
              <Column style={detailValue}>{invoice.invoiceNumber}</Column>
            </Row>
            
            <Row style={detailRow}>
              <Column style={detailLabel}>Amount Due:</Column>
              <Column style={{ ...detailValue, color: buttonColor }}>
                {formattedTotal}
              </Column>
            </Row>
            
            <Row style={detailRow}>
              <Column style={detailLabel}>Original Due Date:</Column>
              <Column style={detailValue}>
                {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}
              </Column>
            </Row>
            
            <Row style={detailRow}>
              <Column style={detailLabel}>Days Overdue:</Column>
              <Column style={{ ...detailValue, color: buttonColor }}>
                {daysOverdue} days
              </Column>
            </Row>
          </Section>

          {/* Call to Action */}
          <Section style={ctaSection}>
            <Text style={urgencyText}>{copy.urgency}</Text>
            
            {paymentLink && (
              <Button href={paymentLink} style={{ ...paymentButton, backgroundColor: buttonColor }}>
                {buttonText}
              </Button>
            )}
          </Section>

          {/* Payment Options */}
          <Section style={paymentOptionsSection}>
            <Text style={paymentOptionsTitle}>Having trouble paying?</Text>
            <Text style={bodyText}>
              If you're experiencing financial difficulties or believe this invoice is incorrect, 
              please{' '}
              <Link href={`mailto:${fromEmail}?subject=Regarding Invoice ${invoice.invoiceNumber}`} style={link}>
                contact us
              </Link>{' '}
              to discuss payment options.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              This reminder was sent from {fromName}. If you have questions, 
              reply to this email or contact us at{' '}
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

// Styles (shared with InvoiceEmail, can be imported)
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
  marginBottom: '24px',
};

const brand = {
  fontSize: '20px',
  fontWeight: '600',
  color: '#1e3a5f',
  margin: '0',
};

const reminderBanner = {
  borderRadius: '8px',
  border: '1px solid',
  padding: '20px',
  textAlign: 'center' as const,
  marginBottom: '32px',
};

const reminderTitle = {
  fontSize: '18px',
  fontWeight: 'bold',
  margin: '0 0 8px 0',
};

const reminderSubtitle = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0',
};

const contentSection = {
  marginBottom: '32px',
};

const greeting = {
  fontSize: '16px',
  color: '#111827',
  margin: '0 0 16px 0',
};

const bodyText = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px 0',
};

const customMessageSection = {
  backgroundColor: '#f9fafb',
  borderRadius: '6px',
  padding: '16px',
  marginTop: '16px',
};

const invoiceSection = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '32px',
};

const sectionTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#111827',
  margin: '0 0 16px 0',
};

const detailRow = {
  marginBottom: '12px',
};

const detailLabel = {
  width: '50%',
  fontSize: '14px',
  color: '#6b7280',
};

const detailValue = {
  width: '50%',
  fontSize: '14px',
  fontWeight: '600',
  color: '#111827',
};

const ctaSection = {
  textAlign: 'center' as const,
  marginBottom: '32px',
};

const urgencyText = {
  fontSize: '14px',
  color: '#374151',
  margin: '0 0 20px 0',
};

const paymentButton = {
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

const paymentOptionsSection = {
  marginBottom: '32px',
};

const paymentOptionsTitle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#111827',
  margin: '0 0 8px 0',
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

export default ReminderEmail;
```

### 2. Test Different Reminder Types
Verify rendering for:
- Friendly reminder (1-7 days overdue)
- Firm reminder (8-30 days overdue)
- Final notice (30+ days overdue)

---

## File Structure

```
src/
└── emails/
    ├── InvoiceEmail.tsx      # From P5.2.1
    ├── ReminderEmail.tsx     # NEW
    └── components/
        └── (shared components)
```

---

## Dependencies

- P5.2.1 (InvoiceEmail template for reference)
- @react-email/components

---

## Acceptance Criteria

- [ ] `ReminderEmail` component with three reminder types
- [ ] Dynamic subject line based on reminder type
- [ ] Overdue banner with appropriate color coding (yellow/orange/red)
- [ ] Invoice summary with key details
- [ ] Personalized greeting with client name
- [ ] Tone-appropriate message body
- [ ] Prominent payment button with type-appropriate styling
- [ ] "Having trouble paying?" section for payment options
- [ ] Contact link for disputes or payment plans
- [ ] Properly styled for all major email clients

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
