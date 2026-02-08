# Task: Add Templates Table to Schema

**Task ID**: P1.2.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
The database schema lacks a table to store invoice templates, preventing users from saving and reusing custom invoice designs.

---

## Objective
Add a `templates` table to the Convex schema to store template configurations and metadata.

---

## Implementation Plan

### 1. Update Schema Definition
Edit `convex/schema.ts` to add the templates table:

```typescript
export default defineSchema({
  // ... existing tables ...
  
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
    isDefault: v.boolean(), // System templates
    userId: v.optional(v.string()), // Custom templates
    teamId: v.optional(v.id("teams")), // Team templates
    
    // Template configuration
    config: v.object({
      // Colors
      primaryColor: v.string(), // hex
      secondaryColor: v.string(), // hex
      backgroundColor: v.optional(v.string()), // hex
      textColor: v.optional(v.string()), // hex
      
      // Typography
      fontFamily: v.union(
        v.literal("inter"),
        v.literal("playfair"),
        v.literal("roboto"),
        v.literal("opensans")
      ),
      headingWeight: v.optional(v.union(v.literal("normal"), v.literal("bold"))),
      
      // Layout
      layout: v.union(
        v.literal("standard"), // Logo top-left, details top-right
        v.literal("centered"), // Logo and title centered
        v.literal("sidebar"), // Sidebar with from/to info
        v.literal("minimal") // Clean, minimal header
      ),
      
      // Features
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
  .index("by_default", ["isDefault"]),
});
```

### 2. Update Invoices Table
Add template reference to invoices:

```typescript
invoices: defineTable({
  // ... existing fields ...
  templateId: v.optional(v.id("templates")),
  templateConfig: v.optional(v.object({
    // Snapshot of template config at time of creation
    primaryColor: v.string(),
    secondaryColor: v.string(),
    fontFamily: v.string(),
    layout: v.string(),
  })),
}),
```

### 3. Generate Types
Run Convex type generation:
```bash
npx convex dev
```

### 4. Verify Schema
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
- Schema planning complete

---

## Acceptance Criteria

- [ ] `templates` table added to Convex schema with all fields
- [ ] Indexes created for efficient queries (by_category, by_user, by_team, by_default)
- [ ] `templateId` and `templateConfig` fields added to `invoices` table
- [ ] Types regenerated successfully
- [ ] Schema validates without errors
- [ ] Documentation updated with schema changes

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
- Convex Schema Docs: https://docs.convex.dev/database/schemas

---

## Notes

- `config` field uses Convex's nested object validation
- `templateConfig` in invoices stores a snapshot to preserve invoice appearance
- `isDefault` separates system templates from user-created ones
- Consider adding soft delete (`deletedAt`) for user templates
