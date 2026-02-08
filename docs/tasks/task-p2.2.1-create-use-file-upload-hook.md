# Task: Create useFileUpload Hook

**Task ID**: P2.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
The frontend lacks a reusable hook for handling file uploads with progress tracking, error handling, and cancellation support.

---

## Objective
Create a `useFileUpload` hook that handles the complete file upload flow from validation to completion.

---

## Implementation Plan

### 1. Create Hook File
Create `src/hooks/useFileUpload.ts`:

```typescript
import { useState, useCallback, useRef } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export type FileType = "logo" | "avatar" | "attachment" | "product_image";

export interface FileRecord {
  _id: Id<"files">;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Url: string;
  fileType: FileType;
  uploadedAt: number;
}

export interface UseFileUploadOptions {
  fileType: FileType;
  entityId?: string;
  maxFiles?: number;
  onSuccess?: (file: FileRecord) => void;
  onError?: (error: Error, fileName: string) => void;
  onProgress?: (fileName: string, progress: number) => void;
}

export interface UseFileUploadReturn {
  upload: (files: File[]) => Promise<void>;
  uploadSingle: (file: File) => Promise<FileRecord | null>;
  progress: Record<string, number>;
  isUploading: boolean;
  errors: Record<string, string>;
  cancel: () => void;
  reset: () => void;
}

export function useFileUpload(options: UseFileUploadOptions): UseFileUploadReturn {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const generateUploadUrl = useAction(api.files.generateUploadUrl);
  const confirmUpload = useMutation(api.files.confirmUpload);
  
  const uploadSingle = useCallback(async (file: File): Promise<FileRecord | null> => {
    setIsUploading(true);
    setErrors(prev => ({ ...prev, [file.name]: "" }));
    
    try {
      // Generate upload URL
      const { uploadUrl, fileId, publicUrl } = await generateUploadUrl({
        filename: fileId,
        mimeType: file.type,
        size: file.size,
        fileType: options.fileType,
        entityId: options.entityId,
      });
      
      // Create abort controller for this upload
      abortControllerRef.current = new AbortController();
      
      // Upload to R2 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            setProgress(prev => ({ ...prev, [file.name]: percentComplete }));
            options.onProgress?.(file.name, percentComplete);
          }
        });
        
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        });
        
        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
        
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
        
        // Store xhr for cancellation
        (abortControllerRef.current as any).xhr = xhr;
      });
      
      // Confirm upload
      await confirmUpload({ fileId });
      
      const fileRecord: FileRecord = {
        _id: fileId,
        filename: fileId,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        r2Url: publicUrl,
        fileType: options.fileType,
        uploadedAt: Date.now(),
      };
      
      options.onSuccess?.(fileRecord);
      return fileRecord;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      setErrors(prev => ({ ...prev, [file.name]: errorMessage }));
      options.onError?.(error as Error, file.name);
      return null;
    } finally {
      setIsUploading(false);
      setProgress(prev => ({ ...prev, [file.name]: 0 }));
    }
  }, [generateUploadUrl, confirmUpload, options]);
  
  const upload = useCallback(async (files: File[]): Promise<void> => {
    setIsUploading(true);
    setErrors({});
    
    try {
      await Promise.all(files.map(file => uploadSingle(file)));
    } finally {
      setIsUploading(false);
    }
  }, [uploadSingle]);
  
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      const xhr = (abortControllerRef.current as any).xhr;
      if (xhr) xhr.abort();
      abortControllerRef.current.abort();
    }
  }, []);
  
  const reset = useCallback(() => {
    setProgress({});
    setErrors({});
    setIsUploading(false);
  }, []);
  
  return {
    upload,
    uploadSingle,
    progress,
    isUploading,
    errors,
    cancel,
    reset,
  };
}
```

### 2. Create Validation Utilities
Create `src/lib/files/validation.ts`:

```typescript
export interface FileValidation {
  maxSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
}

export const FILE_VALIDATION: Record<string, FileValidation> = {
  logo: {
    maxSize: 2 * 1024 * 1024, // 2MB
    allowedTypes: ["image/png", "image/jpeg", "image/svg+xml"],
    allowedExtensions: [".png", ".jpg", ".jpeg", ".svg"],
  },
  avatar: {
    maxSize: 1 * 1024 * 1024, // 1MB
    allowedTypes: ["image/png", "image/jpeg"],
    allowedExtensions: [".png", ".jpg", ".jpeg"],
  },
  attachment: {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ["application/pdf", "image/png", "image/jpeg"],
    allowedExtensions: [".pdf", ".png", ".jpg", ".jpeg"],
  },
  product_image: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ["image/png", "image/jpeg"],
    allowedExtensions: [".png", ".jpg", ".jpeg"],
  },
};

export function validateFile(file: File, fileType: string): string | null {
  const validation = FILE_VALIDATION[fileType];
  if (!validation) return "Invalid file type category";
  
  if (file.size > validation.maxSize) {
    return `File too large. Max size: ${validation.maxSize / 1024 / 1024}MB`;
  }
  
  if (!validation.allowedTypes.includes(file.type)) {
    return `Invalid file type. Allowed: ${validation.allowedExtensions.join(", ")}`;
  }
  
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
```

### 3. Write Tests
Create `src/hooks/useFileUpload.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileUpload } from "./useFileUpload";

describe("useFileUpload", () => {
  it("should initialize with default state", () => {
    const { result } = renderHook(() =>
      useFileUpload({ fileType: "logo" })
    );
    
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toEqual({});
    expect(result.current.errors).toEqual({});
  });
  
  // Add more tests...
});
```

---

## File Structure

```
src/
├── hooks/
│   ├── useFileUpload.ts
│   └── useFileUpload.test.ts
├── lib/
│   └── files/
│       └── validation.ts
```

---

## Dependencies

- P2.1.2: File upload actions implemented
- Convex React hooks
- XMLHttpRequest for progress tracking

---

## Acceptance Criteria

- [ ] `useFileUpload` hook created with full interface
- [ ] File validation utilities implemented
- [ ] Progress tracking working via XMLHttpRequest
- [ ] Cancellation support implemented
- [ ] Single and batch upload modes supported
- [ ] Error handling with descriptive messages
- [ ] Success/error callbacks functional
- [ ] Hook tested with unit tests
- [ ] TypeScript types exported

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.1.2](./task-p2.1.2-implement-file-upload-actions.md)

---

## Notes

- XMLHttpRequest used instead of fetch for upload progress
- AbortController pattern allows cancellation
- Validation can be done client-side before upload
- Consider adding retry logic for failed uploads
