# Task: Add Template Analytics Tracking

**Task ID**: P4.4.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Low  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
We need to track how users interact with the template system to understand which templates are popular and how the feature is being used.

---

## Objective
Add analytics tracking for template-related events:
- Template selection during invoice creation
- Template gallery views
- Custom template creation
- Template editor usage
- Template customization patterns

---

## Implementation Plan

### 1. Define Template Analytics Events
Create `src/lib/analytics/template-events.ts`:

```typescript
import { useAnalytics } from '@/hooks/useAnalytics';

export const TEMPLATE_EVENTS = {
  TEMPLATE_GALLERY_VIEWED: 'template_gallery_viewed',
  TEMPLATE_SELECTED: 'template_selected',
  TEMPLATE_CUSTOMIZE_STARTED: 'template_customize_started',
  TEMPLATE_CUSTOMIZE_COMPLETED: 'template_customize_completed',
  TEMPLATE_CREATED: 'template_created',
  TEMPLATE_DELETED: 'template_deleted',
  TEMPLATE_PREVIEW_VIEWED: 'template_preview_viewed',
} as const;

export interface TemplateAnalyticsProps {
  templateId: string;
  templateName: string;
  category: string;
  isDefault: boolean;
}

export function useTemplateAnalytics() {
  const { track } = useAnalytics();
  
  const trackGalleryViewed = (filters?: { category?: string }) => {
    track(TEMPLATE_EVENTS.TEMPLATE_GALLERY_VIEWED, {
      ...filters,
    });
  };
  
  const trackTemplateSelected = (props: TemplateAnalyticsProps) => {
    track(TEMPLATE_EVENTS.TEMPLATE_SELECTED, {
      template_id: props.templateId,
      template_name: props.templateName,
      category: props.category,
      is_default: props.isDefault,
    });
  };
  
  const trackCustomizeStarted = (props: TemplateAnalyticsProps) => {
    track(TEMPLATE_EVENTS.TEMPLATE_CUSTOMIZE_STARTED, {
      template_id: props.templateId,
      template_name: props.templateName,
      base_template: props.isDefault ? 'system' : 'custom',
    });
  };
  
  const trackCustomizeCompleted = (
    props: TemplateAnalyticsProps & {
      customizations: string[]; // e.g., ['primaryColor', 'fontFamily']
    }
  ) => {
    track(TEMPLATE_EVENTS.TEMPLATE_CUSTOMIZE_COMPLETED, {
      template_id: props.templateId,
      template_name: props.templateName,
      customizations_made: props.customizations,
      customization_count: props.customizations.length,
    });
  };
  
  const trackTemplateCreated = (
    props: TemplateAnalyticsProps & {
      baseTemplateId?: string;
    }
  ) => {
    track(TEMPLATE_EVENTS.TEMPLATE_CREATED, {
      template_id: props.templateId,
      template_name: props.templateName,
      category: props.category,
      created_from: props.baseTemplateId ? 'duplicate' : 'scratch',
      base_template_id: props.baseTemplateId,
    });
  };
  
  const trackTemplateDeleted = (props: TemplateAnalyticsProps) => {
    track(TEMPLATE_EVENTS.TEMPLATE_DELETED, {
      template_id: props.templateId,
      template_name: props.templateName,
      usage_count: props.usageCount,
    });
  };
  
  const trackPreviewViewed = (
    props: TemplateAnalyticsProps & {
      previewDuration?: number;
    }
  ) => {
    track(TEMPLATE_EVENTS.TEMPLATE_PREVIEW_VIEWED, {
      template_id: props.templateId,
      template_name: props.templateName,
      preview_duration_ms: props.previewDuration,
    });
  };
  
  return {
    trackGalleryViewed,
    trackTemplateSelected,
    trackCustomizeStarted,
    trackCustomizeCompleted,
    trackTemplateCreated,
    trackTemplateDeleted,
    trackPreviewViewed,
  };
}
```

### 2. Integrate Analytics into Components
Update `TemplateGallery` to track views:

```typescript
export function TemplateGallery(props: TemplateGalleryProps) {
  const { trackGalleryViewed, trackTemplateSelected } = useTemplateAnalytics();
  
  useEffect(() => {
    trackGalleryViewed({ category: props.category });
  }, []);
  
  const handleSelect = (template: Template) => {
    trackTemplateSelected({
      templateId: template._id,
      templateName: template.name,
      category: template.category,
      isDefault: template.isDefault,
    });
    props.onSelect(template);
  };
  
  // ... rest of component
}
```

Update `TemplateEditor` to track customizations:

```typescript
export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const { trackCustomizeStarted, trackCustomizeCompleted } = useTemplateAnalytics();
  const [customizations, setCustomizations] = useState<string[]>([]);
  
  useEffect(() => {
    if (template) {
      trackCustomizeStarted({
        templateId: template._id,
        templateName: template.name,
        category: template.category,
        isDefault: template.isDefault,
      });
    }
  }, []);
  
  const handleConfigChange = (key: string, value: unknown) => {
    if (!customizations.includes(key)) {
      setCustomizations([...customizations, key]);
    }
    // ... update config
  };
  
  const handleSave = () => {
    trackCustomizeCompleted({
      templateId: template?._id || 'new',
      templateName: name,
      category: template?.category || 'custom',
      isDefault: false,
      customizations,
    });
    // ... save logic
  };
  
  // ... rest of component
}
```

Update `InvoiceForm` to track template selection:

```typescript
const handleTemplateChange = (templateId: string) => {
  const template = templates?.find(t => t._id === templateId);
  if (template) {
    trackTemplateSelected({
      templateId: template._id,
      templateName: template.name,
      category: template.category,
      isDefault: template.isDefault,
    });
  }
  setSelectedTemplateId(templateId);
};
```

### 3. Create Analytics Dashboard Query
Add a Convex query for template analytics:

```typescript
// convex/analytics.ts
export const getTemplateUsageStats = query({
  handler: async (ctx) => {
    const templates = await ctx.db.query("templates").collect();
    
    return templates.map(template => ({
      id: template._id,
      name: template.name,
      category: template.category,
      isDefault: template.isDefault,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
    })).sort((a, b) => b.usageCount - a.usageCount);
  },
});
```

---

## File Structure

```
src/
├── lib/
│   └── analytics/
│       └── template-events.ts    # Template analytics events
├── components/
│   └── templates/
│       ├── TemplateGallery.tsx   # Add tracking
│       ├── TemplateEditor.tsx    # Add tracking
│       └── TemplateSelector.tsx  # Add tracking
├── components/
│   └── invoice/
│       └── InvoiceForm.tsx       # Add tracking
convex/
└── analytics.ts                  # Template stats query
```

---

## Dependencies

- P4.3.4 (Template integration must be complete)
- P3.2.1 (useAnalytics hook from Phase 3)

---

## Acceptance Criteria

- [ ] `TEMPLATE_EVENTS` constants defined for all template actions
- [ ] `useTemplateAnalytics` hook created with tracking functions
- [ ] Template gallery view tracked on mount
- [ ] Template selection tracked with template metadata
- [ ] Template customization tracked with fields changed
- [ ] Template creation tracked with source (duplicate vs scratch)
- [ ] Template deletion tracked with usage count
- [ ] Preview views tracked with duration
- [ ] Convex query for template usage statistics
- [ ] No PII in analytics events

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
