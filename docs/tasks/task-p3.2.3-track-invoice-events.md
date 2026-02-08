# Task: Track Invoice Lifecycle Events

**Task ID**: P3.2.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Invoice creation is our core value metric. We need to track the complete invoice lifecycle to understand user engagement and identify drop-off points.

---

## Objective
Implement comprehensive tracking for invoice CRUD operations: creation, viewing, editing, deletion, and PDF downloads.

---

## Implementation Plan

### 1. Identify Invoice Event Locations
Locate invoice handling in:
- Invoice creation form
- Invoice view page
- Invoice list/dashboard
- PDF generation/download

### 2. Track Invoice Creation
```typescript
track('invoice_created', {
  invoice_id: string,        // Hashed/anon
  item_count: number,
  currency: string,
  has_due_date: boolean,
  tax_rate: number,
  team_id?: string,          // Hashed
  template_used?: string,
  has_logo: boolean,
});
```

### 3. Track Invoice Updates
```typescript
track('invoice_updated', {
  invoice_id: string,
  fields_changed: string[],
  status_before: string,
  status_after: string,
});
```

### 4. Track Invoice Viewing
```typescript
track('invoice_viewed', {
  invoice_id: string,
  view_source: 'dashboard' | 'direct_link' | 'email',
});
```

### 5. Track Invoice Downloads
```typescript
track('invoice_downloaded', {
  invoice_id: string,
  file_size_kb: number,
  format: 'pdf',
});
```

### 6. Track Invoice Deletion
```typescript
track('invoice_deleted', {
  invoice_id: string,
  invoice_age_days: number,
  was_sent: boolean,
});
```

### 7. Update User Properties
Update user properties in PostHog:
```typescript
posthog.people.set({
  invoice_count_all_time: number,
  last_invoice_created_at: string,
});
```

---

## File Structure

```
src/
  components/
    invoice/
      InvoiceForm.tsx      # Track create/update
      InvoiceViewer.tsx    # Track view
      InvoicePDF.tsx       # Track download
  pages/
    CreateInvoice.tsx      # Track creation flow
    ViewInvoice.tsx        # Track views
```

---

## Dependencies

- P3.2.1 (useAnalytics hook implemented)

---

## Acceptance Criteria

- [ ] `invoice_created` event tracked with all relevant properties
- [ ] `invoice_updated` event tracked with fields changed
- [ ] `invoice_viewed` event tracked with view source
- [ ] `invoice_downloaded` event tracked with file size
- [ ] `invoice_deleted` event tracked
- [ ] User properties updated with invoice count
- [ ] No invoice content (client names, amounts) in events
- [ ] Invoice IDs hashed/anonymized
- [ ] Events visible in analytics dashboards

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
