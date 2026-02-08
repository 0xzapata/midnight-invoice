# Task: Add Templates Table to Schema

**Task ID**: P4.1.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
Currently, all invoices in Midnight Invoice use the same default layout. To support multiple invoice templates, we need a database table to store template configurations including colors, fonts, layouts, and metadata.

---

## Objective
Create a `templates` table in the Convex schema that supports:
- Template identity (name, description, category)
- Ownership (system defaults, user-created, team templates)
- Configuration (colors, typography, layout, features)
- Assets (thumbnail URLs, logo file references)
- Usage tracking and metadata

---

## Implementation Plan

### 1. Update Schema Definition
Add the `templates` table to `convex/schema.ts` with the following fields:

```typescript
templates: defineTable({
  // Identity
  name: v.string(),
  description: v.optional(v.string()),
  category: v.union(
    v.literal("business"),
    v.literal("creative"),
    v.literal("minimal"),
    v.literal("modern"),
    v.literal("classic")
  ),
  
  // Ownership
  isDefault: v.boolean(),
  userId: v.optional(v.string()),
  teamId: v.optional(v.id("teams")),
  
  // Template configuration
  config: v.object({
    primaryColor: v.string(),
    secondaryColor: v.string(),
    backgroundColor: v.optional(v.string()),
    textColor: v.optional(v.string()),
    fontFamily: v.union(
      v.literal("inter"),
      v.literal("playfair"),
      v.literal("roboto"),
      v.literal("opensans")
    ),
    headingWeight: v.optional(v.union(v.literal("normal"), v.literal("bold"))),
    layout: v.union(
      v.literal("standard"),
      v.literal("centered"),
      v.literal("sidebar"),
      v.literal("minimal")
    ),
    showLogo: v.boolean(),
    showInvoiceName: v.boolean(),
    showDueDate: v.boolean(),
    showPaymentDetails: v.boolean(),
    showNotes: v.boolean(),
  }),
  
  // Assets
  thumbnailUrl: v.optional(v.string()),
  logoFileId: v.optional(v.id("files")),
  
  // Metadata
  isActive: v.boolean(),
  usageCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_category", ["category"])
.index("by_user", ["userId"])
.index("by_team", ["teamId"])
.index("by_default", ["isDefault"])
```

### 2. Add Database Indexes
Create indexes for efficient querying by category, user, team, and default status.

### 3. Run Schema Migration
Execute `npx convex dev` to apply schema changes to the development environment.

---

## File Structure

```
convex/
└── schema.ts          # Add templates table definition
```

---

## Dependencies

- P1.2.2 (Template table foundation from Phase 1)

---

## Acceptance Criteria

- [ ] `templates` table is defined in `convex/schema.ts`
- [ ] All required fields are properly typed with Convex validators
- [ ] Indexes are created for common query patterns
- [ ] Schema compiles without errors
- [ ] Migration runs successfully in development environment
- [ ] TypeScript types are generated correctly

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
