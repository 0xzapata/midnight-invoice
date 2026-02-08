# Task: Build LogoUpload Component

**Task ID**: P2.2.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Users need a UI component to upload and manage their company logo, with preview, validation, and error handling.

---

## Objective
Build a `LogoUpload` component with drag-and-drop support, preview, and upload progress.

---

## Implementation Plan

### 1. Create Component
Create `src/components/settings/LogoUpload.tsx`:

```typescript
import { useState, useCallback } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFileUpload, FileRecord } from "@/hooks/useFileUpload";
import { validateFile, formatFileSize } from "@/lib/files/validation";

export interface LogoUploadProps {
  currentLogoUrl?: string;
  onLogoChange: (fileId: string | null, url: string | null) => void;
  entityType: "user" | "team";
  entityId?: string;
  maxSize?: number;
}

export function LogoUpload({
  currentLogoUrl,
  onLogoChange,
  entityType,
  entityId,
  maxSize = 2 * 1024 * 1024,
}: LogoUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl || null);
  const [error, setError] = useState<string | null>(null);
  
  const {
    uploadSingle,
    progress,
    isUploading,
    errors: uploadErrors,
    cancel,
  } = useFileUpload({
    fileType: "logo",
    entityId,
    onSuccess: (file: FileRecord) => {
      setPreviewUrl(file.r2Url);
      onLogoChange(file._id, file.r2Url);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });
  
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setError(null);
      
      if (acceptedFiles.length === 0) return;
      
      const file = acceptedFiles[0];
      
      // Validate file
      const validationError = validateFile(file, "logo");
      if (validationError) {
        setError(validationError);
        return;
      }
      
      // Upload
      await uploadSingle(file);
    },
    [uploadSingle]
  );
  
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/svg+xml": [".svg"],
    },
    maxFiles: 1,
    noClick: !!previewUrl,
    noKeyboard: !!previewUrl,
  });
  
  const handleRemove = () => {
    setPreviewUrl(null);
    onLogoChange(null, null);
    setError(null);
  };
  
  const currentProgress = Object.values(progress)[0] || 0;
  
  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "relative border-2 border-dashed rounded-lg p-6 transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          previewUrl && "border-solid border-muted-foreground/25 p-0 overflow-hidden",
          error && "border-destructive bg-destructive/5",
          isUploading && "pointer-events-none"
        )}
      >
        <input {...getInputProps()} />
        
        {previewUrl ? (
          // Preview State
          <div className="relative aspect-video max-h-[200px]">
            <img
              src={previewUrl}
              alt="Logo preview"
              className="w-full h-full object-contain"
            />
            
            {!isUploading && (
              <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    open();
                  }}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Change
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove();
                  }}
                >
                  <X className="w-4 h-4 mr-1" />
                  Remove
                </Button>
              </div>
            )}
            
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-white" />
                <span className="text-white text-sm">{currentProgress}%</span>
                <Progress value={currentProgress} className="w-32" />
              </div>
            )}
          </div>
        ) : (
          // Empty State
          <div className="flex flex-col items-center justify-center py-8 text-center">
            {isUploading ? (
              <>
                <Loader2 className="w-10 h-10 animate-spin text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  Uploading... {currentProgress}%
                </p>
                <Progress value={currentProgress} className="w-48 mt-2" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-4"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancel();
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <ImageIcon className="w-10 h-10 text-muted-foreground mb-4" />
                <p className="text-sm font-medium">
                  {isDragActive ? "Drop logo here" : "Drag & drop logo here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-4">
                  PNG, JPG, or SVG up to {formatFileSize(maxSize)}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      
      {Object.entries(uploadErrors).map(([fileName, err]) => (
        <p key={fileName} className="text-sm text-destructive">
          {fileName}: {err}
        </p>
      ))}
    </div>
  );
}
```

### 2. Install Dependencies
```bash
npm install react-dropzone
```

### 3. Create Storybook Story (Optional)
Create `src/components/settings/LogoUpload.stories.tsx`:

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { LogoUpload } from "./LogoUpload";

const meta: Meta<typeof LogoUpload> = {
  component: LogoUpload,
  title: "Settings/LogoUpload",
};

export default meta;
type Story = StoryObj<typeof LogoUpload>;

export const Empty: Story = {
  args: {
    entityType: "user",
    onLogoChange: () => {},
  },
};

export const WithLogo: Story = {
  args: {
    entityType: "user",
    currentLogoUrl: "https://via.placeholder.com/200x100",
    onLogoChange: () => {},
  },
};
```

---

## File Structure

```
src/
├── components/
│   └── settings/
│       ├── LogoUpload.tsx
│       └── LogoUpload.stories.tsx
```

---

## Dependencies

- P2.2.1: useFileUpload hook
- react-dropzone for drag-and-drop
- shadcn/ui Button and Progress components
- lucide-react icons

---

## Acceptance Criteria

- [ ] `LogoUpload` component created with full props interface
- [ ] Drag-and-drop functionality working
- [ ] File validation (type, size) implemented
- [ ] Preview with hover actions (change, remove)
- [ ] Upload progress indicator showing
- [ ] Error states handled with user-friendly messages
- [ ] Loading state during upload
- [ ] Responsive design working
- [ ] Storybook stories created
- [ ] Component tested

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.1](./task-p2.2.1-create-use-file-upload-hook.md)
- React Dropzone Docs: https://react-dropzone.js.org/

---

## Notes

- Supports PNG, JPG, and SVG formats
- SVG sanitization should be added if displaying user-uploaded SVGs
- Consider adding image cropping/editing in future iterations
- Maximum file size: 2MB for logos
