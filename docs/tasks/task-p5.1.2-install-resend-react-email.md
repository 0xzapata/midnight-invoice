# Task: Install Resend SDK and React Email

**Task ID**: P5.1.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
We need to install the necessary npm packages to send emails via Resend and create type-safe React Email templates.

---

## Objective
Install and configure:
- Resend SDK for email sending
- React Email for template creation
- @react-email/components for email UI components
- @react-email/render for HTML rendering

---

## Implementation Plan

### 1. Install Dependencies
```bash
# Core Resend SDK
npm install resend

# React Email
npm install react-email @react-email/components @react-email/render

# Additional email utilities (optional)
npm install @react-email/tailwind
```

### 2. Configure React Email
Create `react-email.config.js`:

```javascript
/** @type {import('react-email').Config} */
module.exports = {
  dir: 'src/emails',
  outDir: 'dist/emails',
  // Optional: Tailwind configuration
  tailwind: {
    theme: {
      extend: {
        colors: {
          brand: '#1e3a5f',
        },
      },
    },
  },
};
```

### 3. Create Email Directory Structure
```
src/
├── emails/
│   ├── InvoiceEmail.tsx      # Invoice email template
│   ├── ReminderEmail.tsx     # Reminder email template
│   ├── components/
│   │   ├── EmailLayout.tsx   # Shared email layout
│   │   ├── EmailFooter.tsx   # Shared footer
│   │   └── EmailButton.tsx   # Styled button component
│   └── styles/
│       └── email-styles.ts   # Shared email styles
```

### 4. Create Email Utilities
Create `src/lib/email/utils.ts`:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export { resend };

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'invoices@midnight-invoice.com';
export const FROM_NAME = process.env.RESEND_FROM_NAME || 'Midnight Invoice';

export function getFromHeader(): string {
  return `${FROM_NAME} <${FROM_EMAIL}>`;
}

// Helper to generate email subject
export function generateInvoiceSubject(invoiceNumber: string, fromName: string): string {
  return `Invoice ${invoiceNumber} from ${fromName}`;
}

// Helper to generate reminder subject
export function generateReminderSubject(invoiceNumber: string, daysOverdue: number): string {
  return `Reminder: Invoice ${invoiceNumber} is ${daysOverdue} days overdue`;
}
```

### 5. Add Scripts to package.json
```json
{
  "scripts": {
    "email:dev": "email dev",
    "email:build": "email build",
    "email:export": "email export"
  }
}
```

### 6. Test Installation
Create a test email component:

```typescript
// src/emails/TestEmail.tsx
import { Html, Head, Preview, Body, Container, Text } from '@react-email/components';

export function TestEmail() {
  return (
    <Html>
      <Head />
      <Preview>Test email from Midnight Invoice</Preview>
      <Body style={{ backgroundColor: '#f6f9fc' }}>
        <Container>
          <Text>Hello from Midnight Invoice!</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

Run the email dev server:
```bash
npm run email:dev
```

Verify the email preview opens at http://localhost:3000

---

## File Structure

```
src/
├── emails/
│   ├── TestEmail.tsx         # Test component
│   ├── InvoiceEmail.tsx      # (created in P5.2.1)
│   ├── ReminderEmail.tsx     # (created in P5.2.2)
│   └── components/           # Shared email components
├── lib/
│   └── email/
│       └── utils.ts          # Email utilities
├── convex/
│   └── emails.ts             # Backend email actions (from P5.3.1)
react-email.config.js         # React Email configuration
package.json                  # Updated with scripts
```

---

## Dependencies

- P5.1.1 (Domain verification complete)
- Node.js 18+ for Resend SDK

---

## Acceptance Criteria

- [ ] `resend` package installed
- [ ] `react-email` and related packages installed
- [ ] `react-email.config.js` created with proper configuration
- [ ] `src/emails/` directory structure created
- [ ] Email utilities file with Resend client initialization
- [ ] `email:dev` script added to package.json
- [ ] Test email renders correctly in dev server
- [ ] No TypeScript errors in email components

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
- React Email Docs: https://react.email/
