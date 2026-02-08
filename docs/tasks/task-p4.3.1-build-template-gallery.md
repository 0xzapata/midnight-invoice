# Task: Build TemplateGallery Component

**Task ID**: P4.3.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Large (1 week)  
**Component**: Frontend

---

## Problem Statement
Users need a visual gallery to browse, filter, and select from available invoice templates. The gallery should showcase templates with previews and organize them by category.

---

## Objective
Build a `TemplateGallery` component that:
- Displays templates in a responsive grid layout
- Shows template thumbnails with preview
- Supports category filtering (business, creative, minimal, etc.)
- Allows template selection and customization
- Includes search functionality
- Shows template information on hover/selection

---

## Implementation Plan

### 1. Create TemplateGallery Component
Create `src/components/templates/TemplateGallery.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Template, TemplateCategory } from '@/lib/templates/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Search } from 'lucide-react';

interface TemplateGalleryProps {
  selectedId?: string;
  onSelect: (template: Template) => void;
  onCustomize: (template: Template) => void;
  onCreateNew: () => void;
}

const CATEGORIES: { value: TemplateCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All Templates' },
  { value: 'business', label: 'Business' },
  { value: 'modern', label: 'Modern' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'creative', label: 'Creative' },
  { value: 'classic', label: 'Classic' },
];

export function TemplateGallery({ 
  selectedId, 
  onSelect, 
  onCustomize, 
  onCreateNew 
}: TemplateGalleryProps) {
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const templates = useQuery(api.templates.listTemplates, {
    category: category === 'all' ? undefined : category,
    includeDefaults: true,
  });
  
  const filteredTemplates = templates?.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  return (
    <div className="space-y-6">
      {/* Header with Search and Create */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button onClick={onCreateNew}>
          <Plus className="mr-2 h-4 w-4" />
          Create New
        </Button>
      </div>
      
      {/* Category Tabs */}
      <Tabs value={category} onValueChange={(v) => setCategory(v as TemplateCategory | 'all')}>
        <TabsList>
          {CATEGORIES.map(cat => (
            <TabsTrigger key={cat.value} value={cat.value}>
              {cat.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      
      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates?.map(template => (
          <TemplateCard
            key={template._id}
            template={template}
            isSelected={template._id === selectedId}
            onSelect={() => onSelect(template)}
            onCustomize={() => onCustomize(template)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 2. Create TemplateCard Component
Create `src/components/templates/TemplateCard.tsx`:

```typescript
import { Template } from '@/lib/templates/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Edit2 } from 'lucide-react';
import { TemplateThumbnail } from './TemplateThumbnail';

interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}

export function TemplateCard({ 
  template, 
  isSelected, 
  onSelect, 
  onCustomize 
}: TemplateCardProps) {
  return (
    <Card 
      className={`group relative overflow-hidden transition-all duration-200 cursor-pointer
        ${isSelected ? 'ring-2 ring-primary shadow-lg' : 'hover:scale-[1.02] hover:shadow-md'}
      `}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="aspect-[280/200] bg-muted relative">
        <TemplateThumbnail template={template} />
        
        {/* Selected Overlay */}
        {isSelected && (
          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
            <div className="bg-primary text-primary-foreground rounded-full p-2">
              <Check className="h-6 w-6" />
            </div>
          </div>
        )}
        
        {/* Hover Actions */}
        {!template.isDefault && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              size="icon" 
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onCustomize();
              }}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      
      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold">{template.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-1">
              {template.description}
            </p>
          </div>
          <Badge variant="secondary">{template.category}</Badge>
        </div>
        
        <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
          <span>Used {template.usageCount} times</span>
          {template.isDefault && (
            <Badge variant="outline" className="text-xs">Default</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
```

### 3. Create TemplateThumbnail Component
Create `src/components/templates/TemplateThumbnail.tsx`:

```typescript
import { Template } from '@/lib/templates/types';

interface TemplateThumbnailProps {
  template: Template;
}

export function TemplateThumbnail({ template }: TemplateThumbnailProps) {
  const { config } = template;
  
  // Generate a visual representation of the template
  return (
    <div 
      className="w-full h-full p-4"
      style={{ 
        backgroundColor: config.backgroundColor || '#ffffff',
        fontFamily: config.fontFamily,
      }}
    >
      {/* Simplified invoice preview */}
      <div className="space-y-2">
        <div 
          className="h-3 w-16 rounded"
          style={{ backgroundColor: config.primaryColor }}
        />
        <div className="flex justify-between">
          <div className="space-y-1">
            <div className="h-2 w-20 bg-gray-300 rounded" />
            <div className="h-2 w-24 bg-gray-200 rounded" />
          </div>
          <div className="space-y-1 text-right">
            <div className="h-2 w-12 bg-gray-300 rounded" />
            <div className="h-2 w-16 bg-gray-200 rounded" />
          </div>
        </div>
        <div 
          className="h-6 mt-2 rounded"
          style={{ backgroundColor: config.primaryColor }}
        />
        <div className="space-y-1">
          <div className="h-2 w-full bg-gray-100 rounded" />
          <div className="h-2 w-full bg-gray-100 rounded" />
          <div className="h-2 w-3/4 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  );
}
```

---

## File Structure

```
src/
├── components/
│   └── templates/
│       ├── TemplateGallery.tsx     # Main gallery component
│       ├── TemplateCard.tsx        # Individual template card
│       └── TemplateThumbnail.tsx   # Visual thumbnail preview
├── components/
│   └── ui/
│       ├── tabs.tsx                # shadcn tabs
│       ├── card.tsx                # shadcn card
│       └── badge.tsx               # shadcn badge
```

---

## Dependencies

- P4.2.4 (InvoicePDF with templates must be complete)

---

## Acceptance Criteria

- [ ] `TemplateGallery` displays templates in responsive 3-column grid
- [ ] Category tabs filter templates by type
- [ ] Search filters by name and description
- [ ] `TemplateCard` shows thumbnail, name, description, and category
- [ ] Selected state visually indicated with border and checkmark
- [ ] Hover reveals customize button for custom templates
- [ ] "Create New" button opens template editor
- [ ] Thumbnails visually represent template colors and layout
- [ ] Loading states handled gracefully
- [ ] Empty state shown when no templates match filters

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
