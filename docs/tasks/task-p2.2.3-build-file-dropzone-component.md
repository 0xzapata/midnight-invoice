# Task: Build FileDropzone Component

**Task ID**: P2.2.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Users need a component to upload multiple files as invoice attachments, with batch upload support, individual file progress, and error handling.

---

## Objective
Build a `FileDropzone` component for multi-file upload with batch processing and file management.

---

## Implementation Plan

### 1. Create Component
Create `src/components/invoice/FileDropzone.tsx`:

```typescript
import { useState, useCallback } from "react";
import { Upload, X, File, FileImage, FileText, Loader2 } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFileUpload, FileRecord, FileType } from "@/hooks/useFileUpload";
import { validateFile, formatFileSize } from "@/lib/files/validation";

export interface FileDropzoneProps {
  files: FileRecord[];
  onFilesChange: (files: FileRecord[]) => void;
  fileType?: FileType;
  maxFiles?: number;
  maxSize?: number;
  entityId?: string;
  accept?: Record<string, string[]>;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  return FileText;
}

export function FileDropzone({
  files,
  onFilesChange,
  fileType = "attachment",
  maxFiles = 5,
  maxSize = 10 * 1024 * 1024,
  entityId,
  accept = {
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "application/pdf": [".pdf"],
  },
}: FileDropzoneProps) {
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  const {
    upload,
    progress,
    isUploading,
    errors: uploadErrors,
  } = useFileUpload({
    fileType,
    entityId,
    onSuccess: (file: FileRecord) => {
      onFilesChange([...files, file]);
    },
  });
  
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setValidationErrors({});
      
      // Check max files
      if (files.length + acceptedFiles.length > maxFiles) {
        setValidationErrors({
          _general: `Maximum ${maxFiles} files allowed`,
        });
        return;
      }
      
      // Validate all files
      const errors: Record<string, string> = {};
      const validFiles: File[] = [];
      
      for (const file of acceptedFiles) {
        const error = validateFile(file, fileType);
        if (error) {
          errors[file.name] = error;
        } else {
          validFiles.push(file);
        }
      }
      
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
      }
      
      // Upload valid files
      if (validFiles.length > 0) {
        await upload(validFiles);
      }
    },
    [files, maxFiles, fileType, upload, onFilesChange]
  );
  
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept,
    maxFiles: maxFiles - files.length,
    noClick: files.length >= maxFiles,
  });
  
  const handleRemove = (fileId: string) => {
    onFilesChange(files.filter((f) => f._id !== fileId));
  };
  
  const canAddMore = files.length < maxFiles;
  
  return (
    <div className="space-y-4">
      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => {
            const FileIcon = getFileIcon(file.mimeType);
            const isUploadingThis = isUploading && progress[file.originalName] !== undefined;
            const uploadProgress = progress[file.originalName] || 0;
            
            return (
              <div
                key={file._id}
                className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50"
              >
                <div className="p-2 bg-background rounded">
                  <FileIcon className="w-5 h-5 text-muted-foreground" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {file.originalName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                  
                  {isUploadingThis && (
                    <Progress value={uploadProgress} className="h-1 mt-2" />
                  )}
                </div>
                
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleRemove(file._id)}
                  disabled={isUploading}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Dropzone */}
      {canAddMore && (
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            isUploading && "pointer-events-none opacity-50"
          )}
        >
          <input {...getInputProps()} />
          
          <div className="flex flex-col items-center justify-center text-center">
            {isUploading ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Uploading files...
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">
                  {isDragActive
                    ? "Drop files here"
                    : "Drag & drop files here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  {maxFiles - files.length} slots remaining • Max{" "}
                  {formatFileSize(maxSize)} each
                </p>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Validation Errors */}
      {Object.entries(validationErrors).map(([fileName, error]) => (
        <p key={fileName} className="text-sm text-destructive">
          {fileName === "_general" ? error : `${fileName}: ${error}`}
        </p>
      ))}
      
      {/* Upload Errors */}
      {Object.entries(uploadErrors).map(([fileName, error]) => (
        <p key={fileName} className="text-sm text-destructive">
          {fileName}: {error}
        </p>
      ))}
    </div>
  );
}
```

### 2. Create Stories
Create `src/components/invoice/FileDropzone.stories.tsx`:

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { FileDropzone } from "./FileDropzone";

const meta: Meta<typeof FileDropzone> = {
  component: FileDropzone,
  title: "Invoice/FileDropzone",
};

export default meta;
type Story = StoryObj<typeof FileDropzone>;

export const Empty: Story = {
  args: {
    files: [],
    onFilesChange: () => {},
  },
};

export const WithFiles: Story = {
  args: {
    files: [
      {
        _id: "file1" as any,
        filename: "receipt.pdf",
        originalName: "receipt.pdf",
        mimeType: "application/pdf",
        size: 1024000,
        r2Url: "https://example.com/receipt.pdf",
        fileType: "attachment",
        uploadedAt: Date.now(),
      },
    ],
    onFilesChange: () => {},
  },
};
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── FileDropzone.tsx
│       └── FileDropzone.stories.tsx
```

---

## Dependencies

- P2.2.1: useFileUpload hook
- react-dropzone for drag-and-drop
- shadcn/ui Button and Progress components
- lucide-react icons

---

## Acceptance Criteria

- [ ] `FileDropzone` component created with multi-file support
- [ ] Batch upload with individual progress tracking
- [ ] File list with remove functionality
- [ ] Drag-and-drop working
- [ ] Max file limit enforcement
- [ ] File type validation
- [ ] File size validation
- [ ] Error handling for individual files
- [ ] Empty state when max files reached
- [ ] Responsive design
- [ ] Storybook stories created

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.1](./task-p2.2.1-create-use-file-upload-hook.md)

---

## Notes

- Maximum 5 files per invoice (configurable via maxFiles prop)
- Each file max 10MB
- Supports PDF, PNG, JPG formats
- Files are removable before invoice save
- Upload happens immediately on drop (optimistic)
