# Task: Implement File Deletion and Queries

**Task ID**: P2.1.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Small (1 day)  
**Component**: Backend

---

## Problem Statement
The backend lacks endpoints for deleting files and querying file metadata, preventing users from managing their uploaded files.

---

## Objective
Implement Convex queries and actions for file deletion, listing, and metadata retrieval.

---

## Implementation Plan

### 1. Add File Queries
Extend `convex/files.ts` with queries:

```typescript
import { query, internalMutation } from "./_generated/server";

export const getFile = query({
  args: { fileId: v.id("files") },
  returns: v.union(v.null(), v.any()), // File document or null
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const file = await ctx.db.get(args.fileId);
    if (!file) return null;
    
    // Check ownership
    if (file.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    return file;
  },
});

export const getFilesByUser = query({
  args: {
    fileType: v.optional(v.union(
      v.literal("logo"),
      v.literal("avatar"),
      v.literal("attachment"),
      v.literal("product_image")
    )),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    if (args.fileType) {
      return await ctx.db
        .query("files")
        .withIndex("by_type_user", (q) =>
          q.eq("userId", identity.tokenIdentifier).eq("fileType", args.fileType)
        )
        .collect();
    }
    
    return await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
      .collect();
  },
});

export const getFilesByEntity = query({
  args: {
    entityId: v.string(),
    fileType: v.union(
      v.literal("logo"),
      v.literal("avatar"),
      v.literal("attachment"),
      v.literal("product_image")
    ),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    return await ctx.db
      .query("files")
      .withIndex("by_entity", (q) =>
        q.eq("entityId", args.entityId).eq("fileType", args.fileType)
      )
      .collect();
  },
});
```

### 2. Add File Deletion
```typescript
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

export const deleteFile = action({
  args: { fileId: v.id("files") },
  returns: v.promise(v.object({ success: v.boolean() })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    
    // Check ownership
    if (file.userId !== identity.tokenIdentifier) {
      throw new Error("Unauthorized");
    }
    
    // Delete from R2
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: file.r2Key,
    });
    
    await s3Client.send(command);
    
    // Delete record from database
    await ctx.db.delete(args.fileId);
    
    return { success: true };
  },
});

export const deleteFilesByEntity = action({
  args: {
    entityId: v.string(),
    fileType: v.optional(v.string()),
  },
  returns: v.promise(v.object({ deletedCount: v.number() })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    // Get files to delete
    let files;
    if (args.fileType) {
      files = await ctx.db
        .query("files")
        .withIndex("by_entity", (q) =>
          q.eq("entityId", args.entityId).eq("fileType", args.fileType)
        )
        .collect();
    } else {
      files = await ctx.db
        .query("files")
        .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
        .collect();
    }
    
    // Filter by ownership
    const userFiles = files.filter(f => f.userId === identity.tokenIdentifier);
    
    // Delete from R2 and database
    for (const file of userFiles) {
      const command = new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: file.r2Key,
      });
      await s3Client.send(command);
      await ctx.db.delete(file._id);
    }
    
    return { deletedCount: userFiles.length };
  },
});
```

### 3. Add Utility Queries
```typescript
export const getTotalStorageUsed = query({
  returns: v.number(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const files = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", identity.tokenIdentifier))
      .collect();
    
    return files.reduce((total, file) => total + file.size, 0);
  },
});
```

### 4. Test Queries and Deletion
- Test file retrieval
- Test file listing with filters
- Test deletion flow
- Verify R2 cleanup

---

## File Structure

```
convex/
├── files.ts (updated with queries and deletion)
```

---

## Dependencies

- P2.1.2: File upload actions implemented
- AWS SDK for S3 delete operations

---

## Acceptance Criteria

- [ ] `getFile` query implemented with ownership check
- [ ] `getFilesByUser` query implemented with optional type filter
- [ ] `getFilesByEntity` query implemented
- [ ] `deleteFile` action implemented (R2 + database)
- [ ] `deleteFilesByEntity` batch deletion implemented
- [ ] `getTotalStorageUsed` utility query implemented
- [ ] All operations require authentication
- [ ] Ownership verification on all operations
- [ ] R2 files deleted when database records are removed
- [ ] Tests pass for all operations

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.1.2](./task-p2.1.2-implement-file-upload-actions.md)
- Convex Query Docs: https://docs.convex.dev/functions/query-functions

---

## Notes

- File deletion is permanent (no soft delete in MVP)
- Always verify ownership before allowing deletion
- Batch deletion useful for cleaning up invoice attachments
- Storage usage query enables quota enforcement later
