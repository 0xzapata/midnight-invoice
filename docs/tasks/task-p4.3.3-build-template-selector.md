# Task: Build TemplateSelector Component

**Task ID**: P4.3.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
The invoice form needs a compact template selector that allows users to quickly choose a template without opening the full gallery. It should be space-efficient and show relevant templates grouped by type.

---

## Objective
Build a `TemplateSelector` component that:
- Provides a compact dropdown/picker for the invoice form
- Groups templates by: Default, My Templates, Team Templates
- Shows template thumbnail and name
- Supports quick template switching
- Has an option to open the full gallery

---

## Implementation Plan

### 1. Create TemplateSelector Component
Create `src/components/templates/TemplateSelector.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Template } from '@/lib/templates/types';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Grid3X3, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TemplateGallery } from './TemplateGallery';

interface TemplateSelectorProps {
  value?: string;
  onChange: (templateId: string) => void;
  onOpenGallery?: () => void;
  teamId?: string;
}

export function TemplateSelector({ 
  value, 
  onChange, 
  onOpenGallery,
  teamId 
}: TemplateSelectorProps) {
  const [showGallery, setShowGallery] = useState(false);
  
  const templates = useQuery(api.templates.listTemplates, {
    includeDefaults: true,
  });
  
  const selectedTemplate = templates?.find(t => t._id === value);
  
  // Group templates
  const defaultTemplates = templates?.filter(t => t.isDefault) || [];
  const myTemplates = templates?.filter(t => 
    !t.isDefault && !t.teamId
  ) || [];
  const teamTemplates = templates?.filter(t => 
    t.teamId === teamId
  ) || [];
  
  const handleSelect = (templateId: string) => {
    if (templateId === 'gallery') {
      setShowGallery(true);
      return;
    }
    onChange(templateId);
  };
  
  return (
    <>
      <Select value={value} onValueChange={handleSelect}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a template">
            {selectedTemplate && (
              <div className="flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: selectedTemplate.config.primaryColor }}
                />
                <span>{selectedTemplate.name}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Default Templates */}
          <SelectGroup>
            <SelectLabel>Default Templates</SelectLabel>
            {defaultTemplates.map(template => (
              <SelectItem key={template._id} value={template._id}>
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: template.config.primaryColor }}
                  />
                  <span>{template.name}</span>
                  {template._id === value && (
                    <Check className="w-3 h-3 ml-auto" />
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
          
          {/* My Templates */}
          {myTemplates.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>My Templates</SelectLabel>
                {myTemplates.map(template => (
                  <SelectItem key={template._id} value={template._id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: template.config.primaryColor }}
                      />
                      <span>{template.name}</span>
                      {template._id === value && (
                        <Check className="w-3 h-3 ml-auto" />
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          
          {/* Team Templates */}
          {teamTemplates.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Team Templates</SelectLabel>
                {teamTemplates.map(template => (
                  <SelectItem key={template._id} value={template._id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: template.config.primaryColor }}
                      />
                      <span>{template.name}</span>
                      {template._id === value && (
                        <Check className="w-3 h-3 ml-auto" />
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          
          <SelectSeparator />
          
          {/* Browse Gallery Option */}
          <SelectItem value="gallery" className="text-primary">
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-4 h-4" />
              <span>Browse Template Gallery...</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      
      {/* Gallery Dialog */}
      <Dialog open={showGallery} onOpenChange={setShowGallery}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Template</DialogTitle>
          </DialogHeader>
          <TemplateGallery
            selectedId={value}
            onSelect={(template) => {
              onChange(template._id);
              setShowGallery(false);
            }}
            onCustomize={(template) => {
              // Open editor with template
            }}
            onCreateNew={() => {
              // Open editor for new template
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 2. Create Compact Variant
Create a more compact version for space-constrained forms:

```typescript
export function TemplateSelectorCompact({ value, onChange }: TemplateSelectorProps) {
  // Simpler button-triggered popover version
}
```

---

## File Structure

```
src/
├── components/
│   └── templates/
│       ├── TemplateSelector.tsx      # Main selector component
│       └── TemplateGallery.tsx       # Reused from P4.3.1
├── components/
│   └── ui/
│       ├── select.tsx                # shadcn select
│       └── dialog.tsx                # shadcn dialog
```

---

## Dependencies

- P4.2.4 (InvoicePDF with templates must be complete)
- P4.3.1 (TemplateGallery component)

---

## Acceptance Criteria

- [ ] `TemplateSelector` displays as a dropdown with grouped options
- [ ] Templates grouped into: Default, My Templates, Team Templates
- [ ] Each option shows color indicator and template name
- [ ] Selected template marked with checkmark
- [ ] "Browse Template Gallery" option opens full gallery dialog
- [ ] Selection triggers onChange with template ID
- [ ] Current selection displayed in trigger with color indicator
- [ ] Properly handles loading and empty states
- [ ] Responsive design for mobile

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
