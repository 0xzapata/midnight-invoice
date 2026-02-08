# Task: Build EmailHistory Component

**Task ID**: P5.4.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
Users need to see a history of all emails sent for an invoice, including reminders, to track communication and follow up appropriately.

---

## Objective
Build an `EmailHistory` component that:
- Shows a timeline of all emails sent for an invoice
- Displays email type (initial, reminder), recipient, status, and timestamps
- Supports expanding for more details
- Shows reminder indicators

---

## Implementation Plan

### 1. Create EmailHistory Component
Create `src/components/emails/EmailHistory.tsx`:

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, 
  Check, 
  Eye, 
  XCircle, 
  Clock,
  RotateCcw,
  AlertTriangle,
  MessageSquare,
  Repeat
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EmailHistoryProps {
  invoiceId: string;
}

type EmailStatus = 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed';

interface EmailLog {
  _id: string;
  to: string;
  subject: string;
  message: string;
  status: EmailStatus;
  isReminder: boolean;
  sentAt: number;
  deliveredAt?: number;
  openedAt?: number;
  openCount?: number;
  templateUsed: string;
}

const STATUS_ICONS: Record<EmailStatus, typeof Send> = {
  queued: Clock,
  sent: Send,
  delivered: Check,
  opened: Eye,
  clicked: Check,
  bounced: XCircle,
  complained: AlertTriangle,
  failed: XCircle,
};

const STATUS_COLORS: Record<EmailStatus, string> = {
  queued: 'text-yellow-500',
  sent: 'text-blue-500',
  delivered: 'text-green-500',
  opened: 'text-purple-500',
  clicked: 'text-cyan-500',
  bounced: 'text-red-500',
  complained: 'text-red-600',
  failed: 'text-red-500',
};

const STATUS_LABELS: Record<EmailStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  complained: 'Complained',
  failed: 'Failed',
};

function EmailHistoryItem({ email, index, total }: { 
  email: EmailLog; 
  index: number;
  total: number;
}) {
  const StatusIcon = STATUS_ICONS[email.status];
  const isLast = index === total - 1;
  
  return (
    <div className="relative flex gap-4 pb-8 last:pb-0">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border" />
      )}
      
      {/* Icon */}
      <div className={cn(
        "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-background",
        email.status === 'delivered' && "border-green-500",
        email.status === 'opened' && "border-purple-500",
        email.status === 'bounced' && "border-red-500",
        email.status === 'failed' && "border-red-500",
        email.status === 'sent' && "border-blue-500",
      )}>
        <StatusIcon className={cn("h-4 w-4", STATUS_COLORS[email.status])} />
      </div>
      
      {/* Content */}
      <div className="flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {email.isReminder ? 'Reminder' : 'Invoice'} Email
              </span>
              {email.isReminder && (
                <Badge variant="secondary" className="text-xs">
                  <Repeat className="w-3 h-3 mr-1" />
                  Reminder
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              To: {email.to}
            </p>
          </div>
          <div className="text-right">
            <Badge variant="outline" className={STATUS_COLORS[email.status]}>
              {STATUS_LABELS[email.status]}
            </Badge>
            {email.openCount && email.openCount > 1 && (
              <p className="text-xs text-muted-foreground mt-1">
                Opened {email.openCount} times
              </p>
            )}
          </div>
        </div>
        
        {/* Subject */}
        <p className="text-sm font-medium">{email.subject}</p>
        
        {/* Timestamps */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span title={format(email.sentAt, 'PPpp')}>
            {formatDistanceToNow(email.sentAt, { addSuffix: true })}
          </span>
          
          {email.deliveredAt && (
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3" />
              Delivered
            </span>
          )}
          
          {email.openedAt && (
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              Opened {formatDistanceToNow(email.openedAt, { addSuffix: true })}
            </span>
          )}
        </div>
        
        {/* Message preview (if exists) */}
        {email.message && (
          <div className="mt-2 p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
              <MessageSquare className="w-3 h-3" />
              Custom message:
            </p>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {email.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function EmailHistory({ invoiceId }: EmailHistoryProps) {
  const emailLogs = useQuery(api.emails.getEmailLogsForInvoice, { invoiceId });
  
  if (!emailLogs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 bg-muted rounded" />
                  <div className="h-3 w-1/2 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (emailLogs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Send className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No emails sent yet</p>
            <p className="text-sm">Send this invoice to see the history here</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Email History</CardTitle>
        <Badge variant="secondary">{emailLogs.length} sent</Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {emailLogs.map((email, index) => (
              <EmailHistoryItem
                key={email._id}
                email={email as EmailLog}
                index={index}
                total={emailLogs.length}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
```

### 2. Install date-fns
```bash
npm install date-fns
```

---

## File Structure

```
src/
├── components/
│   └── emails/
│       ├── EmailHistory.tsx        # Email timeline component
│       └── EmailStatusBadge.tsx    # From P5.4.2
├── components/
│   └── ui/
│       ├── card.tsx                # shadcn card
│       ├── scroll-area.tsx         # shadcn scroll-area
│       └── badge.tsx               # shadcn badge
```

---

## Dependencies

- P5.4.2 (EmailStatusBadge component)
- date-fns for date formatting
- Convex query for email logs

---

## Acceptance Criteria

- [ ] `EmailHistory` displays timeline of all emails
- [ ] Visual timeline with connecting lines between events
- [ ] Icons for each email status type
- [ ] Reminder emails marked with badge
- [ ] Email subject and recipient displayed
- [ ] Timestamps with relative time (e.g., "2 hours ago")
- [ ] Delivery and open status shown with icons
- [ ] Custom message preview expandable
- [ ] Empty state when no emails sent
- [ ] Loading skeleton while fetching
- [ ] Scroll area for long histories
- [ ] Email count badge in header

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
