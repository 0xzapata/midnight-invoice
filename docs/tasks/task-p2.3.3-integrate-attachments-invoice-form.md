# Task: Integrate Attachments to Invoice Form

**Task ID**: P2.3.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
The invoice form doesn't support file attachments, preventing users from associating supporting documents with their invoices.

---

## Objective
Integrate the FileDropzone component into the InvoiceForm and persist attachments with the invoice.

---

## Implementation Plan

### 1. Update InvoiceForm Component
Modify `src/components/invoice/InvoiceForm.tsx`:

```typescript
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { FileDropzone } from "./FileDropzone";
import { InvoiceAttachments } from "./InvoiceAttachments";
import { FileRecord } from "@/hooks/useFileUpload";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export interface InvoiceFormData {
  // ... existing fields ...
  attachmentFileIds: string[];
}

interface InvoiceFormProps {
  initialData?: Partial<InvoiceFormData>;
  onSubmit: (data: InvoiceFormData) => void;
}

export function InvoiceForm({ initialData, onSubmit }: InvoiceFormProps) {
  const [formData, setFormData] = useState<InvoiceFormData>({
    // ... existing defaults ...
    attachmentFileIds: initialData?.attachmentFileIds || [],
  });
  
  const [attachedFiles, setAttachedFiles] = useState<FileRecord[]>([]);
  
  // Load existing attachments if editing
  useEffect(() => {
    if (initialData?.attachmentFileIds?.length) {
      // Query for file records
      // setAttachedFiles(files);
    }
  }, [initialData]);
  
  const handleFilesChange = (files: FileRecord[]) => {
    setAttachedFiles(files);
    setFormData(prev => ({
      ...prev,
      attachmentFileIds: files.map(f => f._id),
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ... existing form fields ... */}
      
      <Separator />
      
      {/* Attachments Section */}
      <div className="space-y-4">
        <div>
          <Label className="text-base">Attachments</Label>
          <p className="text-sm text-muted-foreground">
            Add supporting documents, receipts, or contracts
          </p>
        </div>
        
        <FileDropzone
          files={attachedFiles}
          onFilesChange={handleFilesChange}
          fileType="attachment"
          maxFiles={5}
          maxSize={10 * 1024 * 1024}
          // entityId will be set after invoice creation
        />
      </div>
      
      {/* Submit Button */}
      <Button type="submit">Save Invoice</Button>
    </form>
  );
}
```

### 2. Update Save Invoice Mutation
Update `convex/invoices.ts`:

```typescript
export const createInvoice = mutation({
  args: {
    // ... existing fields ...
    attachmentFileIds: v.optional(v.array(v.id("files"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const invoiceId = await ctx.db.insert("invoices", {
      ...args,
      userId: identity.tokenIdentifier,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Update files with entityId
    if (args.attachmentFileIds) {
      for (const fileId of args.attachmentFileIds) {
        await ctx.db.patch(fileId, { entityId: invoiceId });
      }
    }
    
    return invoiceId;
  },
});

export const updateInvoice = mutation({
  args: {
    invoiceId: v.id("invoices"),
    // ... existing fields ...
    attachmentFileIds: v.optional(v.array(v.id("files"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const { invoiceId, ...updates } = args;
    
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    // Get current attachments
    const currentAttachments = invoice.attachmentFileIds || [];
    const newAttachments = updates.attachmentFileIds || [];
    
    // Find removed attachments
    const removedAttachments = currentAttachments.filter(
      id => !newAttachments.includes(id)
    );
    
    // Delete removed attachments
    for (const fileId of removedAttachments) {
      await ctx.runAction(api.files.deleteFile, { fileId });
    }
    
    // Update entityId for new attachments
    const addedAttachments = newAttachments.filter(
      id => !currentAttachments.includes(id)
    );
    for (const fileId of addedAttachments) {
      await ctx.db.patch(fileId, { entityId: invoiceId });
    }
    
    await ctx.db.patch(invoiceId, {
      ...updates,
      updatedAt: Date.now(),
    });
    
    return { success: true };
  },
});
```

### 3. Update Invoice View Page
Show attachments in invoice view:

```typescript
// In InvoiceView page
import { InvoiceAttachments } from "@/components/invoice/InvoiceAttachments";

export function InvoiceView({ invoiceId }: { invoiceId: string }) {
  const invoice = useQuery(api.invoices.getInvoice, { invoiceId });
  const files = useQuery(
    api.files.getFilesByEntity,
    invoice?._id ? { entityId: invoice._id, fileType: "attachment" } : "skip"
  );
  
  if (!invoice) return <Loading />;
  
  return (
    <div className="space-y-6">
      {/* ... invoice details ... */}
      
      {files && files.length > 0 && (
        <InvoiceAttachments
          files={files}
          invoiceNumber={invoice.invoiceNumber}
        />
      )}
    </div>
  );
}
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── InvoiceForm.tsx (updated)
│       ├── InvoiceView.tsx (updated)
│       ├── FileDropzone.tsx
│       └── InvoiceAttachments.tsx
convex/
├── invoices.ts (updated)
```

---

## Dependencies

- P2.2.3: FileDropzone component
- P2.3.2: InvoiceAttachments component
- Convex mutations for invoice CRUD

---

## Acceptance Criteria

- [ ] FileDropzone integrated into InvoiceForm
- [ ] Attachments persist with invoice on save
- [ ] Attachments load when editing existing invoice
- [ ] Removed attachments deleted from storage
- [ ] New attachments linked to invoice via entityId
- [ ] Invoice view displays attachments list
- [ ] Maximum 5 attachments per invoice enforced
- [ ] Form validation includes attachment limits

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.3](./task-p2.2.3-build-file-dropzone-component.md), [P2.3.2](./task-p2.3.2-build-invoice-attachments.md)

---

## Notes

- Attachments are linked to invoices via entityId in the files table
- Removed attachments are permanently deleted
- Consider soft delete for attachment history in future
- entityId is set after invoice creation for new invoices
