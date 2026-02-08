# Task: Implement File Upload Convex Actions

**Task ID**: P2.1.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Backend

---

## Problem Statement
The backend lacks API endpoints for generating presigned upload URLs and managing file metadata, preventing the frontend from uploading files to R2.

---

## Objective
Implement Convex actions for file upload URL generation and file record creation.

---

## Implementation Plan

### 1. Create Files Module
Create `convex/files.ts` with upload functionality:

```typescript
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const generateUploadUrl = action({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    fileType: v.union(
      v.literal("logo"),
      v.literal("avatar"),
      v.literal("attachment"),
      v.literal("product_image")
    ),
    entityId: v.optional(v.string()),
  },
  returns: v.promise(v.object({
    uploadUrl: v.string(),
    fileId: v.id("files"),
    publicUrl: v.string(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    // Validate file size
    const maxSize = args.fileType === "logo" ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
    if (args.size > maxSize) {
      throw new Error(`File too large. Max size: ${maxSize / 1024 / 1024}MB`);
    }
    
    // Validate file type
    const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "application/pdf"];
    if (!allowedTypes.includes(args.mimeType)) {
      throw new Error("Invalid file type");
    }
    
    // Create file record
    const fileId = await ctx.runMutation(internal.files.createFileRecord, {
      userId: identity.tokenIdentifier,
      ...args,
    });
    
    // Generate presigned URL
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileId,
      ContentType: args.mimeType,
      ContentLength: args.size,
    });
    
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    
    return {
      uploadUrl,
      fileId,
      publicUrl: `${process.env.VITE_R2_PUBLIC_URL}/${fileId}`,
    };
  },
});

export const createFileRecord = internalMutation({
  args: {
    userId: v.string(),
    filename: v.string(),
    originalName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    fileType: v.union(
      v.literal("logo"),
      v.literal("avatar"),
      v.literal("attachment"),
      v.literal("product_image")
    ),
    entityId: v.optional(v.string()),
  },
  returns: v.promise(v.id("files")),
  handler: async (ctx, args) => {
    return await ctx.db.insert("files", {
      ...args,
      r2Key: "", // Will be set after upload confirmation
      r2Url: "", // Will be set after upload confirmation
      uploadedAt: Date.now(),
    });
  },
});
```

### 2. Implement Upload Confirmation
Add mutation to confirm successful upload:

```typescript
export const confirmUpload = mutation({
  args: {
    fileId: v.id("files"),
  },
  returns: v.promise(v.object({
    success: v.boolean(),
    publicUrl: v.string(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    if (file.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    const publicUrl = `${process.env.VITE_R2_PUBLIC_URL}/${args.fileId}`;
    
    await ctx.db.patch(args.fileId, {
      r2Key: args.fileId,
      r2Url: publicUrl,
    });
    
    return { success: true, publicUrl };
  },
});
```

### 3. Install AWS SDK
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### 4. Test Actions
- Test URL generation
- Test upload flow via presigned URL
- Verify file record creation

---

## File Structure

```
convex/
├── files.ts (new)
├── schema.ts (existing)
package.json (updated)
```

---

## Dependencies

- P2.1.1: R2 CORS configured
- AWS SDK for S3/R2 operations
- Convex auth configured

---

## Acceptance Criteria

- [ ] `generateUploadUrl` action implemented with validation
- [ ] `createFileRecord` internal mutation implemented
- [ ] `confirmUpload` mutation implemented
- [ ] File size limits enforced (2MB for logos, 10MB for attachments)
- [ ] File type validation working (PNG, JPG, SVG, PDF)
- [ ] Presigned URLs expire after 15 minutes
- [ ] Authentication required for all upload operations
- [ ] AWS SDK dependencies installed
- [ ] Actions tested and working end-to-end

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.1.1](./task-p2.1.1-configure-r2-cors.md)
- AWS SDK S3 Docs: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3.html

---

## Notes

- Presigned URLs allow direct browser-to-R2 uploads (bypasses Convex limits)
- File records are created before upload to reserve the ID
- Upload confirmation updates the record with final URL
- Consider rate limiting: 10 uploads per minute per user
