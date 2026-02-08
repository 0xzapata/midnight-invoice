# Task: Add Template Fields to Invoices

**Task ID**: P4.1.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
Invoices need to track which template was used during creation and store a snapshot of the template configuration at the time of creation. This ensures invoices maintain their appearance even if the template is later modified.

---

## Objective
Add template-related fields to the `invoices` table to:
- Reference the template used (`templateId`)
- Store a snapshot of template configuration (`templateConfig`)
- Support invoice rendering with historical template settings

---

## Implementation Plan

### 1. Update Invoices Table Schema
Add the following fields to the `invoices` table in `convex/schema.ts`:

```typescript
invoices: defineTable({
  // ... existing fields ...
  
  // Template reference
  templateId: v.optional(v.id("templates")),
  
  // Template config snapshot (at time of creation)
  templateConfig: v.optional(v.object({
    primaryColor: v.string(),
    secondaryColor: v.string(),
    fontFamily: v.string(),
    layout: v.string(),
  })),
})
.index("by_template", ["templateId"])
```

### 2. Create Migration Strategy
- Existing invoices will have `null` for template fields
- Default template will be used for new invoices if none specified
- Update invoice creation logic to populate these fields

### 3. Update TypeScript Types
Ensure `Invoice` type in the frontend includes optional template fields.

---

## File Structure

```
convex/
└── schema.ts          # Add template fields to invoices table
src/
└── types/
    └── invoice.ts     # Update Invoice type definition
```

---

## Dependencies

- P4.1.1 (Templates table must exist first)

---

## Acceptance Criteria

- [ ] `templateId` field added to invoices table as optional ID reference
- [ ] `templateConfig` snapshot object added with color, font, and layout fields
- [ ] Index created for querying invoices by template
- [ ] TypeScript `Invoice` type updated with optional template fields
- [ ] Existing invoices continue to work without template data
- [ ] Schema migration runs successfully

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
