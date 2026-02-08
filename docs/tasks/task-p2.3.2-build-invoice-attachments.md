# Task: Build InvoiceAttachments Component

**Task ID**: P2.3.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Users need a component to view and manage attachments associated with an invoice in the invoice view page.

---

## Objective
Build an InvoiceAttachments component that displays attached files with download and preview capabilities.

---

## Implementation Plan

### 1. Create Component
Create `src/components/invoice/InvoiceAttachments.tsx`:

```typescript
import { useState } from "react";
import { FileText, FileImage, Download, ExternalLink, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/files/validation";
import { FileRecord } from "@/hooks/useFileUpload";

export interface InvoiceAttachmentsProps {
  files: FileRecord[];
  invoiceNumber: string;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return <FileImage className="w-8 h-8 text-blue-500" />;
  }
  return <FileText className="w-8 h-8 text-red-500" />;
}

export function InvoiceAttachments({ files, invoiceNumber }: InvoiceAttachmentsProps) {
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  
  if (files.length === 0) {
    return null;
  }
  
  const handleDownload = (file: FileRecord) => {
    const link = document.createElement("a");
    link.href = file.r2Url;
    link.download = file.originalName;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handlePreview = (file: FileRecord) => {
    if (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") {
      setPreviewFile(file);
    } else {
      handleDownload(file);
    }
  };
  
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Paperclip className="w-5 h-5" />
            Attachments ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={file._id}
                className="flex items-center gap-4 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {getFileIcon(file.mimeType)}
                
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.originalName}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(file.size)} • Uploaded{" "}
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  {(file.mimeType.startsWith("image/") ||
                    file.mimeType === "application/pdf") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePreview(file)}
                      title="Preview"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(file)}
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogTitle>{previewFile?.originalName}</DialogTitle>
          
          {previewFile?.mimeType.startsWith("image/") && (
            <img
              src={previewFile.r2Url}
              alt={previewFile.originalName}
              className="max-w-full max-h-[70vh] object-contain mx-auto"
            />
          )}
          
          {previewFile?.mimeType === "application/pdf" && (
            <iframe
              src={previewFile.r2Url}
              title={previewFile.originalName}
              className="w-full h-[70vh]"
            />
          )}
          
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setPreviewFile(null)}>
              Close
            </Button>
            <Button onClick={() => previewFile && handleDownload(previewFile)}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 2. Create Compact Variant
Create a compact version for inline use:

```typescript
// InvoiceAttachmentsCompact.tsx
export function InvoiceAttachmentsCompact({ files }: { files: FileRecord[] }) {
  if (files.length === 0) return null;
  
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Paperclip className="w-4 h-4" />
      <span>{files.length} attachment{files.length !== 1 ? "s" : ""}</span>
    </div>
  );
}
```

### 3. Add Stories
Create `src/components/invoice/InvoiceAttachments.stories.tsx`:

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { InvoiceAttachments } from "./InvoiceAttachments";

const meta: Meta<typeof InvoiceAttachments> = {
  component: InvoiceAttachments,
  title: "Invoice/InvoiceAttachments",
};

export default meta;
type Story = StoryObj<typeof InvoiceAttachments>;

const mockFiles = [
  {
    _id: "file1" as any,
    filename: "receipt.pdf",
    originalName: "Hotel Receipt.pdf",
    mimeType: "application/pdf",
    size: 1024000,
    r2Url: "https://example.com/receipt.pdf",
    fileType: "attachment" as const,
    uploadedAt: Date.now() - 86400000,
  },
  {
    _id: "file2" as any,
    filename: "contract.jpg",
    originalName: "Signed Contract.jpg",
    mimeType: "image/jpeg",
    size: 2048000,
    r2Url: "https://via.placeholder.com/800x600",
    fileType: "attachment" as const,
    uploadedAt: Date.now() - 172800000,
  },
];

export const Default: Story = {
  args: {
    files: mockFiles,
    invoiceNumber: "INV-001",
  },
};

export const Empty: Story = {
  args: {
    files: [],
    invoiceNumber: "INV-002",
  },
};
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── InvoiceAttachments.tsx
│       ├── InvoiceAttachmentsCompact.tsx
│       └── InvoiceAttachments.stories.tsx
```

---

## Dependencies

- FileRecord type from useFileUpload
- shadcn/ui Card, Dialog, Button
- lucide-react icons

---

## Acceptance Criteria

- [ ] InvoiceAttachments component created
- [ ] File list with icons based on mime type
- [ ] Download functionality working
- [ ] Preview for images and PDFs
- [ ] File metadata displayed (size, upload date)
- [ ] Empty state (returns null when no files)
- [ ] Compact variant for inline use
- [ ] Responsive design
- [ ] Storybook stories created

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.3](./task-p2.2.3-build-file-dropzone-component.md)

---

## Notes

- Attachments are not rendered on the PDF invoice itself
- Preview opens in a modal dialog
- Direct download for non-previewable files
- Files are publicly accessible via R2 URL
