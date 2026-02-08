# Task: Implement sendInvoiceEmail Action

**Task ID**: P5.3.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Backend

---

## Problem Statement
Users need a backend action to send invoices via email with PDF attachments. The action should handle email rendering, PDF generation, and delivery through Resend.

---

## Objective
Implement a Convex action that:
- Authenticates the user
- Generates the invoice PDF
- Renders the email HTML using React Email
- Sends via Resend API with attachment
- Logs the email to the database
- Updates invoice status

---

## Implementation Plan

### 1. Create sendInvoiceEmail Action
Create/update `convex/emails.ts`:

```typescript
import { action, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { InvoiceEmail } from '../src/emails/InvoiceEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendInvoiceEmail = action({
  args: {
    invoiceId: v.id("invoices"),
    to: v.string(),
    subject: v.optional(v.string()),
    message: v.optional(v.string()),
    includePdf: v.optional(v.boolean()),
    paymentLink: v.optional(v.string()),
  },
  returns: v.promise(v.object({
    success: v.boolean(),
    emailLogId: v.optional(v.id("emailLogs")),
    error: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    
    // 2. Get invoice data
    const invoice = await ctx.runQuery(internal.invoices.getInvoiceInternal, {
      invoiceId: args.invoiceId,
    });
    
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    
    if (invoice.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized: You can only send your own invoices");
    }
    
    // 3. Get user profile for sender info
    const user = await ctx.runQuery(internal.users.getUserInternal, {
      userId: identity.tokenIdentifier,
    });
    
    const fromName = user?.name || invoice.fromName;
    const fromEmail = process.env.RESEND_FROM_EMAIL!;
    
    // 4. Generate PDF if requested
    let attachments;
    if (args.includePdf !== false) {
      const pdfBlob = await ctx.runAction(internal.invoices.generateInvoicePDF, {
        invoiceId: args.invoiceId,
      });
      
      // Convert blob to base64
      const buffer = Buffer.from(await pdfBlob.arrayBuffer());
      const base64Content = buffer.toString('base64');
      
      attachments = [{
        filename: `Invoice-${invoice.invoiceNumber}.pdf`,
        content: base64Content,
      }];
    }
    
    // 5. Render email HTML
    const emailComponent = InvoiceEmail({
      invoice,
      customMessage: args.message,
      fromName,
      fromEmail,
      paymentLink: args.paymentLink,
    });
    
    const html = await render(emailComponent);
    
    // 6. Send via Resend
    const subject = args.subject || `Invoice ${invoice.invoiceNumber} from ${fromName}`;
    
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: args.to,
      subject,
      html,
      attachments,
      tags: [
        { name: 'invoice_id', value: args.invoiceId },
        { name: 'user_id', value: identity.tokenIdentifier },
        { name: 'email_type', value: 'invoice' },
      ],
    });
    
    // 7. Log email to database
    const emailLogId = await ctx.runMutation(internal.emails.createEmailLog, {
      invoiceId: args.invoiceId,
      userId: identity.tokenIdentifier,
      to: args.to,
      subject,
      message: args.message || '',
      templateUsed: 'InvoiceEmail',
      resendId: data?.id,
      status: error ? 'failed' : 'queued',
      isReminder: false,
    });
    
    // 8. Update invoice status if successful
    if (!error && data) {
      await ctx.runMutation(internal.invoices.updateEmailStatus, {
        invoiceId: args.invoiceId,
        status: 'sent',
      });
    }
    
    if (error) {
      return {
        success: false,
        emailLogId,
        error: error.message,
      };
    }
    
    return {
      success: true,
      emailLogId,
    };
  },
});
```

### 2. Create Email Logging Mutation
```typescript
export const createEmailLog = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    userId: v.string(),
    to: v.string(),
    subject: v.string(),
    message: v.string(),
    templateUsed: v.string(),
    resendId: v.optional(v.string()),
    status: v.string(),
    isReminder: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailLogs", {
      ...args,
      sentAt: Date.now(),
    });
  },
});
```

### 3. Add Rate Limiting
Implement basic rate limiting to prevent abuse:

```typescript
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_EMAILS_PER_HOUR = 50;

async function checkRateLimit(ctx: ActionCtx, userId: string): Promise<boolean> {
  const recentEmails = await ctx.runQuery(internal.emails.countRecentEmails, {
    userId,
    since: Date.now() - RATE_LIMIT_WINDOW,
  });
  
  return recentEmails < MAX_EMAILS_PER_HOUR;
}
```

---

## File Structure

```
convex/
├── emails.ts               # Email actions and mutations
├── invoices.ts             # PDF generation action
└── schema.ts               # emailLogs table
src/
└── emails/
    └── InvoiceEmail.tsx    # Email template
```

---

## Dependencies

- P5.2.1 (InvoiceEmail template)
- P4.2.4 (Invoice PDF generation)
- P2.3.1 (Logo integration for PDFs)
- Resend SDK configured

---

## Acceptance Criteria

- [ ] `sendInvoiceEmail` action created with proper args validation
- [ ] User authentication verified before sending
- [ ] Invoice ownership verified
- [ ] PDF generated and attached (when includePdf is true)
- [ ] Email HTML rendered using React Email
- [ ] Email sent via Resend API with proper tags
- [ ] Email logged to database with all metadata
- [ ] Invoice status updated to 'sent' on success
- [ ] Error handling with descriptive messages
- [ ] Rate limiting implemented (50 emails/hour)
- [ ] Returns success status and emailLogId

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
