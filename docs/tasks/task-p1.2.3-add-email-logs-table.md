# Task: Add Email Logs Table

**Task ID**: P1.2.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
The database schema lacks a table to track email sending history and delivery status, preventing users from knowing if their invoices were delivered and opened.

---

## Objective
Add an `emailLogs` table to the Convex schema to store email sending records and track delivery status.

---

## Implementation Plan

### 1. Update Schema Definition
Edit `convex/schema.ts` to add the email logs table:

```typescript
export default defineSchema({
  // ... existing tables ...
  
  emailLogs: defineTable({
    // Relationships
    invoiceId: v.id("invoices"),
    userId: v.string(),
    teamId: v.optional(v.id("teams")),
    
    // Email details
    to: v.string(),
    subject: v.string(),
    message: v.string(),
    templateUsed: v.string(),
    
    // Resend tracking
    resendId: v.optional(v.string()),
    
    // Status tracking
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("bounced"),
      v.literal("complained"),
      v.literal("failed")
    ),
    
    // Timestamps
    sentAt: v.number(),
    deliveredAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    openCount: v.optional(v.number()),
    
    // Metadata
    isReminder: v.boolean(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
  .index("by_invoice", ["invoiceId"])
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_resend_id", ["resendId"]),
});
```

### 2. Update Invoices Table
Add email status tracking to invoices:

```typescript
invoices: defineTable({
  // ... existing fields ...
  emailStatus: v.optional(v.union(
    v.literal("not_sent"),
    v.literal("sent"),
    v.literal("delivered"),
    v.literal("opened")
  )),
  lastReminderSentAt: v.optional(v.number()),
  reminderCount: v.optional(v.number()),
}),
```

### 3. Add Scheduled Reminders Table
For reminder scheduling functionality:

```typescript
scheduledReminders: defineTable({
  invoiceId: v.id("invoices"),
  scheduledFor: v.number(),
  executed: v.boolean(),
})
.index("by_execution", ["executed", "scheduledFor"]),
```

### 4. Generate Types
Run Convex type generation:
```bash
npx convex dev
```

### 5. Verify Schema
- Check generated types in `convex/_generated/`
- Verify indexes are correctly defined

---

## File Structure

```
convex/
├── schema.ts (updated)
├── _generated/
│   ├── dataModel.ts (regenerated)
│   └── ...
```

---

## Dependencies

- Convex CLI configured and running
- P1.1.4: Resend account setup (for understanding webhook data)

---

## Acceptance Criteria

- [ ] `emailLogs` table added to Convex schema with all fields
- [ ] Indexes created for efficient queries (by_invoice, by_user, by_status, by_resend_id)
- [ ] Email status fields added to `invoices` table
- [ ] `scheduledReminders` table added for reminder functionality
- [ ] Types regenerated successfully
- [ ] Schema validates without errors
- [ ] Documentation updated with schema changes

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
- Related Task: [P1.1.4](./task-p1.1.4-setup-resend-account.md)
- Convex Schema Docs: https://docs.convex.dev/database/schemas

---

## Notes

- `resendId` links to Resend's internal email ID for webhook matching
- Status enum covers the full email lifecycle
- `ipAddress` and `userAgent` captured for security/auditing
- `scheduledReminders` enables cron-based reminder sending
- Consider adding `attachments` field if tracking attachment metadata
