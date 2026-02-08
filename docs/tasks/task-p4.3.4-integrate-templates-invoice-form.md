# Task: Integrate Templates into InvoiceForm

**Task ID**: P4.3.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
The invoice creation/editing form needs to integrate the template system so users can select and preview templates while creating their invoices. The template selection should persist with the invoice.

---

## Objective
Update the `InvoiceForm` component to:
- Add a template selection section
- Show live preview of selected template
- Save template ID and config snapshot with invoice
- Support template switching without losing invoice data

---

## Implementation Plan

### 1. Update InvoiceForm Component
Update `src/components/invoice/InvoiceForm.tsx`:

```typescript
import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { TemplateSelector } from '@/components/templates/TemplateSelector';
import { TemplatePreview } from '@/components/templates/TemplatePreview';
import { Template } from '@/lib/templates/types';
import { InvoiceFormData } from '@/types/invoice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface InvoiceFormProps {
  initialData?: Partial<InvoiceFormData>;
  onSubmit: (data: InvoiceFormData) => void;
}

export function InvoiceForm({ initialData, onSubmit }: InvoiceFormProps) {
  const [formData, setFormData] = useState<InvoiceFormData>({
    invoiceNumber: '',
    issueDate: new Date().toISOString().split('T')[0],
    fromName: '',
    fromEmail: '',
    toName: '',
    toEmail: '',
    lineItems: [{ description: '', quantity: 1, price: 0 }],
    taxRate: 0,
    currency: 'USD',
    ...initialData,
  });
  
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(
    initialData?.templateId
  );
  
  const selectedTemplate = useQuery(
    api.templates.getTemplate,
    selectedTemplateId ? { templateId: selectedTemplateId } : 'skip'
  );
  
  const defaultTemplate = useQuery(api.templates.getDefaultTemplate);
  
  const activeTemplate = selectedTemplate || defaultTemplate;
  
  const handleSubmit = () => {
    const submissionData = {
      ...formData,
      templateId: activeTemplate?._id,
      templateConfig: activeTemplate ? {
        primaryColor: activeTemplate.config.primaryColor,
        secondaryColor: activeTemplate.config.secondaryColor,
        fontFamily: activeTemplate.config.fontFamily,
        layout: activeTemplate.config.layout,
      } : undefined,
    };
    onSubmit(submissionData);
  };
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form Section */}
      <div className="space-y-6">
        {/* Template Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice Template</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateSelector
              value={selectedTemplateId}
              onChange={setSelectedTemplateId}
            />
          </CardContent>
        </Card>
        
        {/* Invoice Details */}
        <Tabs defaultValue="details">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="items">Line Items</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details" className="space-y-4">
            {/* Invoice number, dates, from/to fields */}
          </TabsContent>
          
          <TabsContent value="items">
            {/* Line items table */}
          </TabsContent>
          
          <TabsContent value="notes">
            {/* Notes and payment details */}
          </TabsContent>
        </Tabs>
        
        {/* Submit Button */}
        <div className="flex justify-end gap-3">
          <Button variant="outline">Save as Draft</Button>
          <Button onClick={handleSubmit}>Create Invoice</Button>
        </div>
      </div>
      
      {/* Preview Section */}
      <div className="lg:sticky lg:top-4 h-fit">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {activeTemplate ? (
              <TemplatePreview
                data={formData}
                config={activeTemplate.config}
                logoUrl={activeTemplate.logoFileId ? /* fetch url */ undefined : undefined}
              />
            ) : (
              <div className="text-center text-muted-foreground py-12">
                Select a template to see preview
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

### 2. Update Invoice Creation Mutation
Update the Convex mutation to accept template fields:

```typescript
// convex/invoices.ts
export const createInvoice = mutation({
  args: {
    // ... existing args ...
    templateId: v.optional(v.id("templates")),
    templateConfig: v.optional(v.object({
      primaryColor: v.string(),
      secondaryColor: v.string(),
      fontFamily: v.string(),
      layout: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // ... existing validation ...
    
    const invoiceId = await ctx.db.insert("invoices", {
      // ... existing fields ...
      templateId: args.templateId,
      templateConfig: args.templateConfig,
    });
    
    // Increment template usage count
    if (args.templateId) {
      const template = await ctx.db.get(args.templateId);
      if (template) {
        await ctx.db.patch(args.templateId, {
          usageCount: template.usageCount + 1,
        });
      }
    }
    
    return invoiceId;
  },
});
```

### 3. Add getDefaultTemplate Query
Create a query to fetch the default template:

```typescript
// convex/templates.ts
export const getDefaultTemplate = query({
  handler: async (ctx) => {
    const defaults = await ctx.db.query("templates")
      .withIndex("by_default", q => q.eq("isDefault", true))
      .filter(q => q.eq(q.field("category"), "business"))
      .first();
    
    return defaults;
  },
});
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── InvoiceForm.tsx           # Updated with template integration
│       └── templates/
│           └── TemplatePreview.tsx   # Reused component
├── components/
│   └── templates/
│       └── TemplateSelector.tsx      # Reused component
convex/
└── invoices.ts                       # Updated mutations
```

---

## Dependencies

- P4.3.3 (TemplateSelector component)
- Existing InvoiceForm component

---

## Acceptance Criteria

- [ ] Template selection section added to invoice form
- [ ] `TemplateSelector` integrated into form layout
- [ ] Live preview updates when template changes
- [ ] Invoice data persists when switching templates
- [ ] Template ID saved with invoice on submit
- [ ] Template config snapshot saved with invoice
- [ ] Default template used when none selected
- [ ] Template usage count incremented on invoice creation
- [ ] Form layout responsive (side-by-side on desktop, stacked on mobile)

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
