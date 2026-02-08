# Task: Implement Template Backend API

**Task ID**: P4.1.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Backend

---

## Problem Statement
Frontend components need a backend API to query templates, create custom templates, update existing ones, and clone templates for customization.

---

## Objective
Implement Convex queries and mutations for template management:
- List templates (with filtering by category, user, team)
- Get single template by ID
- Create custom template
- Update template
- Delete template
- Clone existing template

---

## Implementation Plan

### 1. Create Template Queries
Create `convex/templates.ts` with query functions:

```typescript
// List templates with optional filters
export const listTemplates = query({
  args: {
    category: v.optional(v.string()),
    includeDefaults: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    let templates = await ctx.db.query("templates")
      .withIndex("by_default", q => q.eq("isDefault", true))
      .collect();
    
    if (identity) {
      const userTemplates = await ctx.db.query("templates")
        .withIndex("by_user", q => q.eq("userId", identity.tokenIdentifier))
        .filter(q => q.eq(q.field("isActive"), true))
        .collect();
      templates = [...templates, ...userTemplates];
    }
    
    if (args.category) {
      templates = templates.filter(t => t.category === args.category);
    }
    
    return templates;
  },
});

// Get single template
export const getTemplate = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.templateId);
  },
});
```

### 2. Create Template Mutations
Add mutation functions for CRUD operations:

```typescript
// Create custom template
export const createTemplate = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    config: v.object({
      primaryColor: v.string(),
      secondaryColor: v.string(),
      fontFamily: v.string(),
      layout: v.string(),
      showLogo: v.boolean(),
      showInvoiceName: v.boolean(),
      showDueDate: v.boolean(),
      showPaymentDetails: v.boolean(),
      showNotes: v.boolean(),
    }),
    baseTemplateId: v.optional(v.id("templates")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const templateId = await ctx.db.insert("templates", {
      name: args.name,
      description: args.description,
      category: args.category,
      userId: identity.tokenIdentifier,
      isDefault: false,
      config: args.config,
      isActive: true,
      usageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    return templateId;
  },
});

// Update template
export const updateTemplate = mutation({
  args: {
    templateId: v.id("templates"),
    updates: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      config: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    await ctx.db.patch(args.templateId, {
      ...args.updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete template (soft delete)
export const deleteTemplate = mutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    await ctx.db.patch(args.templateId, { isActive: false });
  },
});
```

### 3. Add Clone Functionality
Implement template duplication:

```typescript
export const cloneTemplate = mutation({
  args: {
    templateId: v.id("templates"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const source = await ctx.db.get(args.templateId);
    if (!source) throw new Error("Template not found");
    
    const newTemplateId = await ctx.db.insert("templates", {
      name: args.newName,
      description: source.description,
      category: source.category,
      userId: identity.tokenIdentifier,
      isDefault: false,
      config: source.config,
      isActive: true,
      usageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    return newTemplateId;
  },
});
```

---

## File Structure

```
convex/
├── templates.ts       # Template queries and mutations
└── seedTemplates.ts   # Seed function (from P4.1.3)
src/
└── lib/
    └── templates/
        └── types.ts   # Type definitions
```

---

## Dependencies

- P4.1.3 (Default templates must be defined)

---

## Acceptance Criteria

- [ ] `listTemplates` query with category filtering and user template support
- [ ] `getTemplate` query for fetching single template
- [ ] `createTemplate` mutation with proper auth checks
- [ ] `updateTemplate` mutation with ownership validation
- [ ] `deleteTemplate` mutation (soft delete)
- [ ] `cloneTemplate` mutation for duplicating templates
- [ ] All functions have proper authentication checks
- [ ] Users can only modify their own templates (not system defaults)
- [ ] API returns proper error messages for unauthorized access

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
