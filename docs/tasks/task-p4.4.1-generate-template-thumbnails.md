# Task: Generate Template Thumbnails

**Task ID**: P4.4.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Low  
**Effort**: Small (1 day)  
**Component**: Backend

---

## Problem Statement
The template gallery needs visual thumbnails that accurately represent each template's appearance. Currently, we only show a generic preview.

---

## Objective
Create a system to generate and store template thumbnails:
- Generate PNG thumbnails from template PDFs
- Store thumbnails in R2 file storage
- Update template records with thumbnail URLs
- Support regenerating thumbnails when templates change

---

## Implementation Plan

### 1. Create Thumbnail Generation Function
Create `convex/templates/thumbnails.ts`:

```typescript
import { action } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';

export const generateTemplateThumbnail = action({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const template = await ctx.runQuery(internal.templates.getTemplateInternal, {
      templateId: args.templateId,
    });
    
    if (!template) throw new Error("Template not found");
    
    // Generate sample invoice data for preview
    const sampleData = generateSampleInvoiceData();
    
    // Generate PDF using react-pdf
    const pdfBlob = await generatePDFForThumbnail(sampleData, template.config);
    
    // Convert first page to PNG using a PDF-to-image library
    // Option 1: Use pdf2pic or similar on backend
    // Option 2: Use a service like Cloudflare Workers with PDF.js
    
    // For now, we'll use a simpler approach - generate and upload
    const thumbnailBuffer = await convertPDFToPNG(pdfBlob, { page: 1, width: 560 });
    
    // Upload to R2
    const fileName = `thumbnails/template-${args.templateId}-${Date.now()}.png`;
    const thumbnailUrl = await ctx.runAction(internal.files.uploadToR2, {
      fileName,
      contentType: 'image/png',
      data: thumbnailBuffer.toString('base64'),
    });
    
    // Update template with thumbnail URL
    await ctx.runMutation(internal.templates.updateThumbnailUrl, {
      templateId: args.templateId,
      thumbnailUrl,
    });
    
    return thumbnailUrl;
  },
});

function generateSampleInvoiceData(): InvoiceFormData {
  return {
    invoiceNumber: 'INV-001',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    fromName: 'Your Company',
    fromEmail: 'billing@example.com',
    fromAddress: '123 Business St, City, State 12345',
    toName: 'Client Company',
    toEmail: 'client@example.com',
    toAddress: '456 Client Ave, Town, State 67890',
    lineItems: [
      { description: 'Web Design Services', quantity: 10, price: 150 },
      { description: 'Hosting (Monthly)', quantity: 1, price: 50 },
      { description: 'Consultation', quantity: 2, price: 200 },
    ],
    taxRate: 10,
    currency: 'USD',
    notes: 'Thank you for your business!',
    paymentDetails: 'Bank transfer to: Account #123456789',
  };
}
```

### 2. Add Batch Generation
Create a function to generate thumbnails for all templates:

```typescript
export const generateAllThumbnails = internalAction({
  handler: async (ctx) => {
    const templates = await ctx.runQuery(internal.templates.listAllTemplates);
    
    for (const template of templates) {
      try {
        await ctx.runAction(internal.templates.generateTemplateThumbnail, {
          templateId: template._id,
        });
      } catch (error) {
        console.error(`Failed to generate thumbnail for ${template._id}:`, error);
      }
    }
  },
});
```

### 3. Add Thumbnail Regeneration Trigger
Regenerate thumbnails when templates are updated:

```typescript
// In updateTemplate mutation
export const updateTemplate = mutation({
  args: {
    templateId: v.id("templates"),
    updates: v.object({
      config: v.optional(v.any()),
      // ... other fields
    }),
  },
  handler: async (ctx, args) => {
    // ... existing update logic ...
    
    // Schedule thumbnail regeneration if config changed
    if (args.updates.config) {
      await ctx.scheduler.runAfter(0, internal.templates.generateTemplateThumbnail, {
        templateId: args.templateId,
      });
    }
  },
});
```

### 4. Update TemplateGallery to Use Thumbnails
Update the `TemplateCard` component to use real thumbnails when available:

```typescript
function TemplateCard({ template }: { template: Template }) {
  return (
    <Card>
      <div className="aspect-[280/200] bg-muted relative overflow-hidden">
        {template.thumbnailUrl ? (
          <img 
            src={template.thumbnailUrl} 
            alt={template.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <TemplateThumbnail template={template} />
        )}
      </div>
      {/* ... rest of card ... */}
    </Card>
  );
}
```

---

## File Structure

```
convex/
├── templates/
│   └── thumbnails.ts         # Thumbnail generation action
├── files.ts                  # R2 upload utilities
└── templates.ts              # Add thumbnail URL update mutation
src/
└── components/
    └── templates/
        └── TemplateCard.tsx  # Update to use thumbnailUrl
```

---

## Dependencies

- P4.3.1 (TemplateGallery must be complete)
- P2.1.2 (File upload to R2)
- PDF to image conversion library

---

## Acceptance Criteria

- [ ] `generateTemplateThumbnail` action creates PNG from template PDF
- [ ] Thumbnails uploaded to R2 storage
- [ ] Template records updated with thumbnailUrl
- [ ] Batch generation function for all templates
- [ ] Thumbnails regenerated automatically on template update
- [ ] TemplateGallery displays real thumbnails when available
- [ ] Fallback to generated preview when no thumbnail exists
- [ ] Thumbnail size optimized (560px width)

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
