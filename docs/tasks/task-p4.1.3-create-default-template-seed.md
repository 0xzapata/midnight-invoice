# Task: Create Default Template Seed Data

**Task ID**: P4.1.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
The system needs pre-built professional templates available at launch so users can immediately choose from multiple invoice designs without creating their own.

---

## Objective
Create 5+ default templates covering different styles and use cases:
- **Professional** - Clean, traditional business style
- **Modern** - Contemporary with bold typography
- **Minimal** - Ultra-clean, whitespace-focused
- **Creative** - Playful for designers/agencies
- **Classic** - Timeless elegance

---

## Implementation Plan

### 1. Define Template Types
Create `src/lib/templates/types.ts` with TypeScript interfaces:

```typescript
export type TemplateCategory = 'business' | 'creative' | 'minimal' | 'modern' | 'classic';

export interface TemplateConfig {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily: 'inter' | 'playfair' | 'roboto' | 'opensans';
  headingWeight?: 'normal' | 'bold';
  layout: 'standard' | 'centered' | 'sidebar' | 'minimal';
  showLogo: boolean;
  showInvoiceName: boolean;
  showDueDate: boolean;
  showPaymentDetails: boolean;
  showNotes: boolean;
}

export interface InsertTemplate {
  name: string;
  description?: string;
  category: TemplateCategory;
  isDefault: boolean;
  config: TemplateConfig;
}
```

### 2. Create Default Templates Data
Create `src/lib/templates/defaults.ts` with template definitions:

```typescript
export const DEFAULT_TEMPLATES: InsertTemplate[] = [
  {
    name: 'Professional',
    description: 'Clean and traditional, perfect for business invoices',
    category: 'business',
    isDefault: true,
    config: {
      primaryColor: '#1e3a5f',
      secondaryColor: '#6b7280',
      fontFamily: 'inter',
      layout: 'standard',
      showLogo: true,
      showInvoiceName: true,
      showDueDate: true,
      showPaymentDetails: true,
      showNotes: true,
    },
  },
  // ... 4 more templates
];
```

### 3. Create Convex Seed Function
Create `convex/seedTemplates.ts` to insert default templates:

```typescript
export const seedDefaultTemplates = internalMutation({
  handler: async (ctx) => {
    // Check if defaults already exist
    const existing = await ctx.db.query("templates")
      .withIndex("by_default", q => q.eq("isDefault", true))
      .collect();
    
    if (existing.length > 0) return;
    
    // Insert default templates
    for (const template of DEFAULT_TEMPLATES) {
      await ctx.db.insert("templates", {
        ...template,
        isActive: true,
        usageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});
```

### 4. Add Seed Command
Create a script or Convex action to run the seed function.

---

## File Structure

```
src/
├── lib/
│   └── templates/
│       ├── types.ts       # Template type definitions
│       └── defaults.ts    # Default template data
convex/
└── seedTemplates.ts       # Seed mutation function
```

---

## Dependencies

- P4.1.2 (Invoice template fields must be defined)

---

## Acceptance Criteria

- [ ] TypeScript types created for templates in `src/lib/templates/types.ts`
- [ ] 5 default templates defined with distinct styles
- [ ] Seed function created in Convex
- [ ] Templates include proper category, colors, fonts, and layout settings
- [ ] Seed function is idempotent (won't duplicate on re-run)
- [ ] Default templates marked with `isDefault: true`

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
