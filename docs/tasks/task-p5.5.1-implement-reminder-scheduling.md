# Task: Implement Reminder Scheduling

**Task ID**: P5.5.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Backend

---

## Problem Statement
Users need automatic reminder emails sent for overdue invoices at specific intervals (7, 14, 30 days overdue) to encourage payment without manual follow-up.

---

## Objective
Implement automated reminder scheduling:
- Daily cron job to check for overdue invoices
- Send reminders at 7, 14, and 30 days overdue
- Track reminder history to avoid duplicates
- Support manual reminder sending
- Allow custom reminder messages

---

## Implementation Plan

### 1. Create Scheduled Reminder Job
Create `convex/scheduler.ts`:

```typescript
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

const REMINDER_SCHEDULE = [7, 14, 30]; // Days overdue to send reminders

export const checkOverdueInvoices = internalAction({
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    // Find all unpaid invoices with due dates in the past
    const overdueInvoices = await ctx.runQuery(internal.invoices.getOverdueInvoices, {
      asOf: now,
    });
    
    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.floor((now - invoice.dueDate) / oneDayMs);
      
      // Check if this is a reminder day
      if (!REMINDER_SCHEDULE.includes(daysOverdue)) {
        continue;
      }
      
      // Check if reminder already sent for this interval
      const reminderSent = await ctx.runQuery(internal.emails.checkReminderSent, {
        invoiceId: invoice._id,
        daysOverdue,
      });
      
      if (reminderSent) {
        continue;
      }
      
      // Determine reminder type based on days overdue
      let reminderType: 'friendly' | 'firm' | 'final' = 'friendly';
      if (daysOverdue >= 30) reminderType = 'final';
      else if (daysOverdue >= 14) reminderType = 'firm';
      
      // Send reminder
      await ctx.runAction(internal.emails.sendReminderEmail, {
        invoiceId: invoice._id,
        daysOverdue,
        reminderType,
      });
    }
  },
});
```

### 2. Create Send Reminder Action
Add to `convex/emails.ts`:

```typescript
export const sendReminderEmail = internalAction({
  args: {
    invoiceId: v.id("invoices"),
    daysOverdue: v.number(),
    reminderType: v.union(
      v.literal("friendly"),
      v.literal("firm"),
      v.literal("final")
    ),
    customMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.runQuery(internal.invoices.getInvoiceInternal, {
      invoiceId: args.invoiceId,
    });
    
    if (!invoice) throw new Error("Invoice not found");
    
    const user = await ctx.runQuery(internal.users.getUserInternal, {
      userId: invoice.userId,
    });
    
    // Import ReminderEmail component
    const { ReminderEmail } = await import('../src/emails/ReminderEmail');
    
    const emailComponent = ReminderEmail({
      invoice,
      fromName: user?.name || invoice.fromName,
      fromEmail: process.env.RESEND_FROM_EMAIL!,
      daysOverdue: args.daysOverdue,
      reminderType: args.reminderType,
      customMessage: args.customMessage,
    });
    
    const html = await render(emailComponent);
    
    const subject = args.reminderType === 'final'
      ? `FINAL NOTICE: Invoice ${invoice.invoiceNumber} - Action Required`
      : args.reminderType === 'firm'
      ? `Reminder: Invoice ${invoice.invoiceNumber} is ${args.daysOverdue} Days Overdue`
      : `Friendly Reminder: Invoice ${invoice.invoiceNumber}`;
    
    const { data, error } = await resend.emails.send({
      from: `${user?.name || invoice.fromName} <${process.env.RESEND_FROM_EMAIL!}>`,
      to: invoice.toEmail,
      subject,
      html,
      tags: [
        { name: 'invoice_id', value: args.invoiceId },
        { name: 'email_type', value: 'reminder' },
        { name: 'days_overdue', value: String(args.daysOverdue) },
      ],
    });
    
    // Log as reminder
    await ctx.runMutation(internal.emails.createEmailLog, {
      invoiceId: args.invoiceId,
      userId: invoice.userId,
      to: invoice.toEmail,
      subject,
      message: args.customMessage || '',
      templateUsed: 'ReminderEmail',
      resendId: data?.id,
      status: error ? 'failed' : 'queued',
      isReminder: true,
    });
    
    // Update invoice reminder tracking
    await ctx.runMutation(internal.invoices.updateReminderTracking, {
      invoiceId: args.invoiceId,
      daysOverdue: args.daysOverdue,
    });
    
    if (error) {
      throw new Error(`Failed to send reminder: ${error.message}`);
    }
    
    return { success: true };
  },
});
```

### 3. Create Manual Reminder Mutation
Add for frontend use:

```typescript
export const sendManualReminder = mutation({
  args: {
    invoiceId: v.id("invoices"),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    if (!invoice.dueDate) {
      throw new Error("Invoice has no due date");
    }
    
    const daysOverdue = Math.floor(
      (Date.now() - invoice.dueDate) / (24 * 60 * 60 * 1000)
    );
    
    if (daysOverdue < 1) {
      throw new Error("Invoice is not yet overdue");
    }
    
    let reminderType: 'friendly' | 'firm' | 'final' = 'friendly';
    if (daysOverdue >= 30) reminderType = 'final';
    else if (daysOverdue >= 14) reminderType = 'firm';
    
    await ctx.scheduler.runAfter(0, internal.emails.sendReminderEmail, {
      invoiceId: args.invoiceId,
      daysOverdue,
      reminderType,
      customMessage: args.message,
    });
    
    return { success: true };
  },
});
```

### 4. Schedule Cron Job
Add to `convex/crons.ts`:

```typescript
import { cronJobs } from "convex/server";

const crons = cronJobs();

// Run daily at 9 AM to check for overdue invoices
crons.daily(
  "check overdue invoices",
  { hourUTC: 9, minuteUTC: 0 },
  internal.scheduler.checkOverdueInvoices,
);

export default crons;
```

### 5. Add Reminder Tracking to Invoice
Update invoice tracking:

```typescript
export const updateReminderTracking = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    daysOverdue: v.number(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return;
    
    await ctx.db.patch(args.invoiceId, {
      lastReminderSentAt: Date.now(),
      reminderCount: (invoice.reminderCount || 0) + 1,
      lastReminderDaysOverdue: args.daysOverdue,
    });
  },
});
```

---

## File Structure

```
convex/
├── scheduler.ts              # Cron job and scheduling
├── emails.ts                 # Reminder email actions
├── invoices.ts               # Overdue queries and tracking
├── crons.ts                  # Cron configuration
└── schema.ts                 # Reminder fields on invoices
```

---

## Dependencies

- P5.3.2 (Webhook handler for tracking)
- P5.2.2 (ReminderEmail template)
- P1.2.3 (emailLogs table)
- Convex scheduler

---

## Acceptance Criteria

- [ ] Daily cron job scheduled at 9 AM UTC
- [ ] Automatic reminders at 7, 14, and 30 days overdue
- [ ] Reminder type determined by days overdue (friendly/firm/final)
- [ ] Duplicate prevention (no multiple reminders for same interval)
- [ ] Manual reminder mutation for instant sending
- [ ] Reminder logged as `isReminder: true` in emailLogs
- [ ] Invoice reminder count and timestamp updated
- [ ] Tags include `email_type: reminder` and `days_overdue`
- [ ] Error handling for invoices without due dates
- [ ] Authorization checks on manual reminders

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
