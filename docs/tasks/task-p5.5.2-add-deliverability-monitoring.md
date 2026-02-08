# Task: Add Email Deliverability Monitoring

**Task ID**: P5.5.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Low  
**Effort**: Small (1 day)  
**Component**: Analytics

---

## Problem Statement
We need visibility into email deliverability metrics to ensure emails reach inboxes and identify issues early.

---

## Objective
Implement deliverability monitoring:
- Track delivery rates, bounce rates, and spam complaints
- Create dashboard for email metrics
- Alert on deliverability issues
- Export reports

---

## Implementation Plan

### 1. Create Deliverability Queries
Add to `convex/analytics.ts`:

```typescript
import { query } from './_generated/server';
import { v } from 'convex/values';

export const getEmailDeliverabilityStats = query({
  args: {
    period: v.optional(v.union(
      v.literal("7d"),
      v.literal("30d"),
      v.literal("90d")
    )),
  },
  handler: async (ctx, args) => {
    const days = args.period === "90d" ? 90 : args.period === "30d" ? 30 : 7;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    
    const emails = await ctx.db.query("emailLogs")
      .withIndex("by_user")
      .filter(q => q.gte(q.field("sentAt"), since))
      .collect();
    
    const total = emails.length;
    const delivered = emails.filter(e => 
      ['delivered', 'opened', 'clicked'].includes(e.status)
    ).length;
    const bounced = emails.filter(e => e.status === 'bounced').length;
    const complained = emails.filter(e => e.status === 'complained').length;
    const opened = emails.filter(e => 
      ['opened', 'clicked'].includes(e.status)
    ).length;
    const clicked = emails.filter(e => e.status === 'clicked').length;
    
    return {
      total,
      delivered,
      bounced,
      complained,
      opened,
      clicked,
      deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
      bounceRate: total > 0 ? (bounced / total) * 100 : 0,
      complaintRate: total > 0 ? (complained / total) * 100 : 0,
      openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
      clickRate: delivered > 0 ? (clicked / delivered) * 100 : 0,
      period: args.period || "7d",
    };
  },
});

export const getEmailStatsByTemplate = query({
  args: {},
  handler: async (ctx) => {
    const emails = await ctx.db.query("emailLogs").collect();
    
    const stats = emails.reduce((acc, email) => {
      const template = email.templateUsed || 'unknown';
      if (!acc[template]) {
        acc[template] = { total: 0, opened: 0, clicked: 0 };
      }
      acc[template].total++;
      if (email.status === 'opened' || email.status === 'clicked') {
        acc[template].opened++;
      }
      if (email.status === 'clicked') {
        acc[template].clicked++;
      }
      return acc;
    }, {} as Record<string, { total: number; opened: number; clicked: number }>);
    
    return Object.entries(stats).map(([template, data]) => ({
      template,
      ...data,
      openRate: data.total > 0 ? (data.opened / data.total) * 100 : 0,
    }));
  },
});

export const getRecentBounces = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("emailLogs")
      .withIndex("by_status", q => q.eq("status", "bounced"))
      .order("desc")
      .take(args.limit || 10);
  },
});

export const getRecentComplaints = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("emailLogs")
      .withIndex("by_status", q => q.eq("status", "complained"))
      .order("desc")
      .take(args.limit || 10);
  },
});
```

### 2. Create Deliverability Dashboard Component
Create `src/components/analytics/EmailDeliverabilityDashboard.tsx`:

```typescript
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, TrendingUp, TrendingDown } from 'lucide-react';

const THRESHOLDS = {
  deliveryRate: { good: 95, warning: 90 },
  bounceRate: { good: 2, warning: 5 },
  complaintRate: { good: 0.1, warning: 0.3 },
};

function MetricCard({ 
  title, 
  value, 
  suffix = '',
  thresholds 
}: { 
  title: string; 
  value: number; 
  suffix?: string;
  thresholds?: { good: number; warning: number };
}) {
  let status: 'good' | 'warning' | 'bad' = 'good';
  
  if (thresholds) {
    if (title.includes('Rate') && !title.includes('bounce') && !title.includes('complaint')) {
      // Higher is better
      if (value < thresholds.warning) status = 'bad';
      else if (value < thresholds.good) status = 'warning';
    } else {
      // Lower is better
      if (value > thresholds.warning) status = 'bad';
      else if (value > thresholds.good) status = 'warning';
    }
  }
  
  const colors = {
    good: 'text-green-600',
    warning: 'text-yellow-600',
    bad: 'text-red-600',
  };
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${thresholds ? colors[status] : ''}`}>
          {value.toFixed(1)}{suffix}
        </div>
      </CardContent>
    </Card>
  );
}

export function EmailDeliverabilityDashboard() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d');
  const stats = useQuery(api.analytics.getEmailDeliverabilityStats, { period });
  const templateStats = useQuery(api.analytics.getEmailStatsByTemplate);
  const recentBounces = useQuery(api.analytics.getRecentBounces, { limit: 5 });
  
  if (!stats) return <div>Loading...</div>;
  
  const hasIssues = stats.bounceRate > THRESHOLDS.bounceRate.warning || 
                    stats.complaintRate > THRESHOLDS.complaintRate.warning;
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Email Deliverability</h2>
        
        <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <TabsList>
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="90d">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      
      {hasIssues && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Deliverability Issues Detected</AlertTitle>
          <AlertDescription>
            Your bounce rate or complaint rate is above recommended thresholds. 
            Review recent bounces and complaints below.
          </AlertDescription>
        </Alert>
      )}
      
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard title="Total Sent" value={stats.total} />
        <MetricCard 
          title="Delivery Rate" 
          value={stats.deliveryRate} 
          suffix="%"
          thresholds={THRESHOLDS.deliveryRate}
        />
        <MetricCard 
          title="Bounce Rate" 
          value={stats.bounceRate} 
          suffix="%"
          thresholds={THRESHOLDS.bounceRate}
        />
        <MetricCard 
          title="Complaint Rate" 
          value={stats.complaintRate} 
          suffix="%"
          thresholds={THRESHOLDS.complaintRate}
        />
        <MetricCard title="Open Rate" value={stats.openRate} suffix="%" />
        <MetricCard title="Click Rate" value={stats.clickRate} suffix="%" />
      </div>
      
      {/* Template Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Performance by Template</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Clicked</TableHead>
                <TableHead>Open Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templateStats?.map(template => (
                <TableRow key={template.template}>
                  <TableCell>{template.template}</TableCell>
                  <TableCell>{template.total}</TableCell>
                  <TableCell>{template.opened}</TableCell>
                  <TableCell>{template.clicked}</TableCell>
                  <TableCell>{template.openRate.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {/* Recent Issues */}
      {recentBounces && recentBounces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Recent Bounces</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recentBounces.map(bounce => (
                <li key={bounce._id} className="text-sm">
                  <span className="font-medium">{bounce.to}</span>
                  {' - '}
                  <span className="text-muted-foreground">
                    {new Date(bounce.sentAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

### 3. Add Index for Status Queries
Update `convex/schema.ts`:

```typescript
emailLogs: defineTable({
  // ... existing fields ...
})
.index("by_status", ["status", "sentAt"]),
```

---

## File Structure

```
src/
├── components/
│   └── analytics/
│       └── EmailDeliverabilityDashboard.tsx
├── components/
│   └── ui/
│       └── alert.tsx
convex/
├── analytics.ts              # Deliverability queries
└── schema.ts                 # Status index on emailLogs
```

---

## Dependencies

- P5.3.2 (Webhook handler for status updates)
- P3.2.1 (Analytics infrastructure from Phase 3)

---

## Acceptance Criteria

- [ ] `getEmailDeliverabilityStats` query with period filtering
- [ ] Key metrics: delivery rate, bounce rate, complaint rate, open rate, click rate
- [ ] Threshold-based color coding (green/yellow/red)
- [ ] Template performance breakdown
- [ ] Recent bounces and complaints list
- [ ] Alert banner when metrics exceed thresholds
- [ ] Period selection (7d, 30d, 90d)
- [ ] Dashboard component with responsive grid
- [ ] Index on emailLogs by status for efficient queries

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
