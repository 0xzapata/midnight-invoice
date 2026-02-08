# Task: Build EmailStatusBadge Component

**Task ID**: P5.4.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
Users need to quickly see the email delivery status of their invoices at a glance. Different statuses (sent, delivered, opened, bounced) should have distinct visual indicators.

---

## Objective
Build an `EmailStatusBadge` component that:
- Displays current email status with appropriate icon and color
- Shows detailed information on hover (timestamps, open count)
- Handles all email status states
- Is compact and fits in invoice list and detail views

---

## Implementation Plan

### 1. Create EmailStatusBadge Component
Create `src/components/emails/EmailStatusBadge.tsx`:

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Send,
  Check,
  CheckCheck,
  Eye,
  XCircle,
  AlertTriangle,
  Clock,
  Mail,
} from 'lucide-react';

type EmailStatus = 'not_sent' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed';

interface EmailStatusBadgeProps {
  invoiceId: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const STATUS_CONFIG: Record<EmailStatus, {
  label: string;
  icon: typeof Send;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  color: string;
  description: string;
}> = {
  not_sent: {
    label: 'Not Sent',
    icon: Mail,
    variant: 'secondary',
    color: '#6b7280',
    description: 'Invoice has not been sent yet',
  },
  queued: {
    label: 'Queued',
    icon: Clock,
    variant: 'secondary',
    color: '#f59e0b',
    description: 'Email is queued for sending',
  },
  sent: {
    label: 'Sent',
    icon: Send,
    variant: 'default',
    color: '#3b82f6',
    description: 'Email has been sent',
  },
  delivered: {
    label: 'Delivered',
    icon: Check,
    variant: 'default',
    color: '#22c55e',
    description: 'Email delivered to recipient inbox',
  },
  opened: {
    label: 'Opened',
    icon: Eye,
    variant: 'default',
    color: '#8b5cf6',
    description: 'Email has been opened by recipient',
  },
  clicked: {
    label: 'Clicked',
    icon: CheckCheck,
    variant: 'default',
    color: '#06b6d4',
    description: 'Links in email have been clicked',
  },
  bounced: {
    label: 'Bounced',
    icon: XCircle,
    variant: 'destructive',
    color: '#ef4444',
    description: 'Email bounced - invalid address',
  },
  complained: {
    label: 'Complained',
    icon: AlertTriangle,
    variant: 'destructive',
    color: '#dc2626',
    description: 'Recipient marked as spam',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    variant: 'destructive',
    color: '#dc2626',
    description: 'Email failed to send',
  },
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EmailStatusBadge({ 
  invoiceId, 
  showLabel = true,
  size = 'md' 
}: EmailStatusBadgeProps) {
  const emailLogs = useQuery(api.emails.getEmailLogsForInvoice, { invoiceId });
  
  if (!emailLogs || emailLogs.length === 0) {
    const config = STATUS_CONFIG.not_sent;
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="w-3 h-3" />
        {showLabel && config.label}
      </Badge>
    );
  }
  
  // Get most recent email status
  const latestEmail = emailLogs[0];
  const status = (latestEmail.status as EmailStatus) || 'sent';
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
    lg: 'text-base px-3 py-1',
  };
  
  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={config.variant} 
            className={`gap-1.5 cursor-help ${sizeClasses[size]}`}
            style={{ backgroundColor: config.variant === 'default' ? config.color : undefined }}
          >
            <Icon className={iconSizes[size]} />
            {showLabel && config.label}
            {status === 'opened' && latestEmail.openCount && latestEmail.openCount > 1 && (
              <span className="ml-1 opacity-75">({latestEmail.openCount})</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">{config.description}</p>
            
            {latestEmail.sentAt && (
              <p className="text-xs text-muted-foreground">
                Sent: {formatDate(latestEmail.sentAt)}
              </p>
            )}
            
            {latestEmail.deliveredAt && (
              <p className="text-xs text-muted-foreground">
                Delivered: {formatDate(latestEmail.deliveredAt)}
              </p>
            )}
            
            {latestEmail.openedAt && (
              <p className="text-xs text-muted-foreground">
                Opened: {formatDate(latestEmail.openedAt)}
                {latestEmail.openCount && latestEmail.openCount > 1 && (
                  <span> ({latestEmail.openCount} times)</span>
                )}
              </p>
            )}
            
            {latestEmail.to && (
              <p className="text-xs text-muted-foreground">
                To: {latestEmail.to}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Compact version for tables
export function EmailStatusIcon({ invoiceId }: { invoiceId: string }) {
  return <EmailStatusBadge invoiceId={invoiceId} showLabel={false} size="sm" />;
}
```

### 2. Create Convex Query
Add to `convex/emails.ts`:

```typescript
export const getEmailLogsForInvoice = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const logs = await ctx.db.query("emailLogs")
      .withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId))
      .order("desc")
      .take(5);
    
    return logs;
  },
});
```

### 3. Create Invoice Status Badge Variant
Create `src/components/invoices/InvoiceStatusWithEmail.tsx`:

```typescript
import { Invoice } from '@/types/invoice';
import { Badge } from '@/components/ui/badge';
import { EmailStatusBadge } from '@/components/emails/EmailStatusBadge';

interface InvoiceStatusWithEmailProps {
  invoice: Invoice;
}

export function InvoiceStatusWithEmail({ invoice }: InvoiceStatusWithEmailProps) {
  return (
    <div className="flex items-center gap-2">
      {/* Invoice Status */}
      <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
        {invoice.status}
      </Badge>
      
      {/* Email Status */}
      <EmailStatusBadge invoiceId={invoice._id} />
    </div>
  );
}
```

---

## File Structure

```
src/
├── components/
│   ├── emails/
│   │   ├── EmailStatusBadge.tsx           # Main badge component
│   │   └── index.ts                       # Barrel export
│   └── invoices/
│       └── InvoiceStatusWithEmail.tsx     # Combined status display
├── components/
│   └── ui/
│       ├── badge.tsx                      # shadcn badge
│       └── tooltip.tsx                    # shadcn tooltip
convex/
└── emails.ts                              # getEmailLogsForInvoice query
```

---

## Dependencies

- P5.3.2 (Webhook handler - email status updates)
- P1.2.3 (emailLogs table)
- lucide-react for icons

---

## Acceptance Criteria

- [ ] `EmailStatusBadge` displays status with appropriate icon
- [ ] All 9 email statuses supported with distinct colors
- [ ] Tooltip shows detailed status info on hover
- [ ] Sent/delivered/opened timestamps displayed in tooltip
- [ ] Open count shown for opened emails
- [ ] Compact `EmailStatusIcon` variant for tables
- [ ] Size variants (sm, md, lg)
- [ ] Color coding: gray (not sent), blue (sent), green (delivered), purple (opened), red (errors)
- [ ] Integrates with email logs query
- [ ] Shows recipient email in tooltip

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
