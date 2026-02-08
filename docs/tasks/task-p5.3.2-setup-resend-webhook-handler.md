# Task: Setup Resend Webhook Handler

**Task ID**: P5.3.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Backend

---

## Problem Statement
We need to receive and process webhook events from Resend to track email delivery status (delivered, opened, bounced, etc.) and keep the email logs updated in real-time.

---

## Objective
Implement a Convex HTTP action that:
- Receives webhook events from Resend
- Verifies webhook signatures for security
- Updates email status in the database
- Handles all Resend event types
- Returns appropriate HTTP responses

---

## Implementation Plan

### 1. Create Webhook Handler
Create/update `convex/emails.ts`:

```typescript
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { createHmac } from 'crypto';

// Webhook event types from Resend
type ResendWebhookEvent = 
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked';

interface ResendWebhookPayload {
  type: ResendWebhookEvent;
  created_at: string;
  data: {
    id: string;
    object: 'email';
    created_at: string;
    to: string[];
    from: string;
    subject: string;
    // ... other fields
  };
}

export const handleWebhook = httpAction(async (ctx, request) => {
  // 1. Get signature from headers
  const signature = request.headers.get('x-resend-signature');
  
  if (!signature) {
    return new Response('Missing signature', { status: 401 });
  }
  
  // 2. Get raw body
  const payload = await request.text();
  
  // 3. Verify signature
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('RESEND_WEBHOOK_SECRET not configured');
    return new Response('Webhook secret not configured', { status: 500 });
  }
  
  const expectedSignature = createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    console.error('Invalid webhook signature');
    return new Response('Invalid signature', { status: 401 });
  }
  
  // 4. Parse payload
  let event: ResendWebhookPayload;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    return new Response('Invalid JSON', { status: 400 });
  }
  
  // 5. Process event
  const resendId = event.data.id;
  
  try {
    switch (event.type) {
      case 'email.sent':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'sent',
          sentAt: new Date(event.data.created_at).getTime(),
        });
        break;
        
      case 'email.delivered':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'delivered',
          deliveredAt: Date.now(),
        });
        
        // Also update invoice status
        await ctx.runMutation(internal.invoices.updateEmailStatusByResendId, {
          resendId,
          status: 'delivered',
        });
        break;
        
      case 'email.opened':
        await ctx.runMutation(internal.emails.updateEmailOpened, {
          resendId,
          openedAt: Date.now(),
        });
        
        // Update invoice to opened
        await ctx.runMutation(internal.invoices.updateEmailStatusByResendId, {
          resendId,
          status: 'opened',
        });
        break;
        
      case 'email.clicked':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'clicked',
          clickedAt: Date.now(),
        });
        break;
        
      case 'email.bounced':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'bounced',
          bouncedAt: Date.now(),
        });
        break;
        
      case 'email.complained':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'complained',
          complainedAt: Date.now(),
        });
        break;
        
      case 'email.delivery_delayed':
        await ctx.runMutation(internal.emails.updateEmailStatus, {
          resendId,
          status: 'delivery_delayed',
        });
        break;
        
      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response('Internal error', { status: 500 });
  }
});
```

### 2. Create Status Update Mutations
```typescript
export const updateEmailStatus = internalMutation({
  args: {
    resendId: v.string(),
    status: v.string(),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    bouncedAt: v.optional(v.number()),
    complainedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.query("emailLogs")
      .withIndex("by_resend_id", q => q.eq("resendId", args.resendId))
      .first();
    
    if (!email) {
      console.error(`Email with resendId ${args.resendId} not found`);
      return;
    }
    
    const updates: Partial<typeof args> = { status: args.status };
    if (args.sentAt) updates.sentAt = args.sentAt;
    if (args.deliveredAt) updates.deliveredAt = args.deliveredAt;
    if (args.bouncedAt) updates.bouncedAt = args.bouncedAt;
    if (args.complainedAt) updates.complainedAt = args.complainedAt;
    if (args.clickedAt) updates.clickedAt = args.clickedAt;
    
    await ctx.db.patch(email._id, updates);
  },
});

export const updateEmailOpened = internalMutation({
  args: {
    resendId: v.string(),
    openedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.query("emailLogs")
      .withIndex("by_resend_id", q => q.eq("resendId", args.resendId))
      .first();
    
    if (!email) return;
    
    const openCount = (email.openCount || 0) + 1;
    
    await ctx.db.patch(email._id, {
      status: 'opened',
      openedAt: args.openedAt,
      openCount,
    });
  },
});
```

### 3. Configure Webhook in Resend
1. Go to Resend dashboard → Webhooks
2. Add webhook endpoint: `https://your-app.convex.site/api/emails/webhook`
3. Select events: sent, delivered, opened, clicked, bounced, complained, delivery_delayed
4. Save webhook secret to environment variables

---

## File Structure

```
convex/
├── emails.ts               # Webhook handler and mutations
├── invoices.ts             # Invoice status updates
└── schema.ts               # Indexes on emailLogs
```

---

## Dependencies

- P5.3.1 (sendInvoiceEmail action - needs resendId stored)
- P1.2.3 (emailLogs table)
- Resend webhook secret

---

## Acceptance Criteria

- [ ] HTTP action created at `/api/emails/webhook` endpoint
- [ ] Webhook signature verification implemented
- [ ] All Resend event types handled:
  - `email.sent`
  - `email.delivered`
  - `email.opened`
  - `email.clicked`
  - `email.bounced`
  - `email.complained`
  - `email.delivery_delayed`
- [ ] Email status updated in database for each event
- [ ] Invoice status synced with email status
- [ ] Open count incremented on each open event
- [ ] Proper error handling and logging
- [ ] Returns 200 OK for successful processing
- [ ] Returns 401 for invalid signatures
- [ ] Webhook configured in Resend dashboard

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
