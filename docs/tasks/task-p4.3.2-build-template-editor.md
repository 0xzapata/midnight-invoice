# Task: Build TemplateEditor Component

**Task ID**: P4.3.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Large (1 week)  
**Component**: Frontend

---

## Problem Statement
Users need a visual editor to customize templates by adjusting colors, fonts, layouts, and features. The editor should provide real-time preview of changes.

---

## Objective
Build a `TemplateEditor` component with:
- Two-column layout: editor panel (40%) and live preview (60%)
- Color pickers for primary and secondary colors
- Font family selector
- Layout variant selector
- Feature toggles (show/hide logo, notes, etc.)
- Name and description fields
- Save and cancel actions

---

## Implementation Plan

### 1. Create TemplateEditor Component
Create `src/components/templates/TemplateEditor.tsx`:

```typescript
import { useState } from 'react';
import { Template, TemplateConfig } from '@/lib/templates/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HexColorPicker } from 'react-colorful';
import { TemplatePreview } from './TemplatePreview';

interface TemplateEditorProps {
  template?: Template;
  onSave: (template: Partial<Template>) => void;
  onCancel: () => void;
}

const FONT_OPTIONS = [
  { value: 'inter', label: 'Inter (Modern)' },
  { value: 'playfair', label: 'Playfair Display (Elegant)' },
  { value: 'roboto', label: 'Roboto (Clean)' },
  { value: 'opensans', label: 'Open Sans (Friendly)' },
];

const LAYOUT_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'centered', label: 'Centered' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'minimal', label: 'Minimal' },
];

export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name || 'New Template');
  const [description, setDescription] = useState(template?.description || '');
  const [config, setConfig] = useState<TemplateConfig>({
    primaryColor: '#1e3a5f',
    secondaryColor: '#6b7280',
    fontFamily: 'inter',
    layout: 'standard',
    showLogo: true,
    showInvoiceName: true,
    showDueDate: true,
    showPaymentDetails: true,
    showNotes: true,
    ...template?.config,
  });
  
  const [activeColorPicker, setActiveColorPicker] = useState<'primary' | 'secondary' | null>(null);
  
  const handleSave = () => {
    onSave({
      name,
      description,
      config,
    });
  };
  
  const updateConfig = (updates: Partial<TemplateConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };
  
  return (
    <div className="flex h-full">
      {/* Editor Panel */}
      <div className="w-[40%] border-r overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">
            {template ? 'Edit Template' : 'Create Template'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Customize your invoice appearance
          </p>
        </div>
        
        {/* Name & Description */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Template"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template..."
              rows={2}
            />
          </div>
        </div>
        
        {/* Colors */}
        <div className="space-y-4">
          <h3 className="font-medium">Colors</h3>
          
          <div className="space-y-2">
            <Label>Primary Color</Label>
            <div className="flex items-center gap-3">
              <button
                className="w-10 h-10 rounded border"
                style={{ backgroundColor: config.primaryColor }}
                onClick={() => setActiveColorPicker('primary')}
              />
              <Input 
                value={config.primaryColor}
                onChange={(e) => updateConfig({ primaryColor: e.target.value })}
                className="w-28"
              />
            </div>
            {activeColorPicker === 'primary' && (
              <HexColorPicker
                color={config.primaryColor}
                onChange={(color) => updateConfig({ primaryColor: color })}
              />
            )}
          </div>
          
          <div className="space-y-2">
            <Label>Secondary Color</Label>
            <div className="flex items-center gap-3">
              <button
                className="w-10 h-10 rounded border"
                style={{ backgroundColor: config.secondaryColor }}
                onClick={() => setActiveColorPicker('secondary')}
              />
              <Input 
                value={config.secondaryColor}
                onChange={(e) => updateConfig({ secondaryColor: e.target.value })}
                className="w-28"
              />
            </div>
            {activeColorPicker === 'secondary' && (
              <HexColorPicker
                color={config.secondaryColor}
                onChange={(color) => updateConfig({ secondaryColor: color })}
              />
            )}
          </div>
        </div>
        
        {/* Typography */}
        <div className="space-y-4">
          <h3 className="font-medium">Typography</h3>
          
          <div className="space-y-2">
            <Label>Font Family</Label>
            <Select 
              value={config.fontFamily} 
              onValueChange={(v) => updateConfig({ fontFamily: v as TemplateConfig['fontFamily'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map(font => (
                  <SelectItem key={font.value} value={font.value}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Layout */}
        <div className="space-y-4">
          <h3 className="font-medium">Layout</h3>
          
          <div className="space-y-2">
            <Label>Layout Style</Label>
            <Select 
              value={config.layout} 
              onValueChange={(v) => updateConfig({ layout: v as TemplateConfig['layout'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LAYOUT_OPTIONS.map(layout => (
                  <SelectItem key={layout.value} value={layout.value}>
                    {layout.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Features */}
        <div className="space-y-4">
          <h3 className="font-medium">Features</h3>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="showLogo" className="cursor-pointer">Show Logo</Label>
              <Switch
                id="showLogo"
                checked={config.showLogo}
                onCheckedChange={(v) => updateConfig({ showLogo: v })}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="showInvoiceName" className="cursor-pointer">Show Invoice Title</Label>
              <Switch
                id="showInvoiceName"
                checked={config.showInvoiceName}
                onCheckedChange={(v) => updateConfig({ showInvoiceName: v })}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="showDueDate" className="cursor-pointer">Show Due Date</Label>
              <Switch
                id="showDueDate"
                checked={config.showDueDate}
                onCheckedChange={(v) => updateConfig({ showDueDate: v })}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="showPaymentDetails" className="cursor-pointer">Show Payment Details</Label>
              <Switch
                id="showPaymentDetails"
                checked={config.showPaymentDetails}
                onCheckedChange={(v) => updateConfig({ showPaymentDetails: v })}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="showNotes" className="cursor-pointer">Show Notes</Label>
              <Switch
                id="showNotes"
                checked={config.showNotes}
                onCheckedChange={(v) => updateConfig({ showNotes: v })}
              />
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button onClick={handleSave} className="flex-1">Save Template</Button>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
      
      {/* Preview Panel */}
      <div className="flex-1 bg-muted p-8 overflow-y-auto">
        <div className="sticky top-0">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Live Preview</h3>
          <TemplatePreview config={config} />
        </div>
      </div>
    </div>
  );
}
```

### 2. Install Dependencies
```bash
npm install react-colorful
```

### 3. Create TemplatePreview Component
Create a preview component that renders the template with sample invoice data.

---

## File Structure

```
src/
├── components/
│   └── templates/
│       ├── TemplateEditor.tsx      # Main editor component
│       └── TemplatePreview.tsx     # Live preview component
├── components/
│   └── ui/
│       ├── switch.tsx              # shadcn switch
│       ├── select.tsx              # shadcn select
│       └── textarea.tsx            # shadcn textarea
```

---

## Dependencies

- P4.2.4 (InvoicePDF with templates must be complete)
- react-colorful library

---

## Acceptance Criteria

- [ ] Two-column layout with editor (40%) and preview (60%)
- [ ] Template name and description inputs
- [ ] Color pickers for primary and secondary colors
- [ ] Font family dropdown with 4 options
- [ ] Layout selector (standard, centered, sidebar, minimal)
- [ ] Feature toggles for all visibility options
- [ ] Live preview updates in real-time
- [ ] Save button triggers onSave callback
- [ ] Cancel button triggers onCancel callback
- [ ] Form validation prevents empty template names

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
