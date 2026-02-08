# Task: Add File Cleanup Job

**Task ID**: P2.4.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Low  
**Effort**: Small (1 day)  
**Component**: Backend

---

## Problem Statement
Orphaned files (uploaded but never associated with an entity) and deleted files can accumulate in storage, wasting space and incurring unnecessary costs.

---

## Objective
Implement a scheduled Convex job to clean up orphaned and old deleted files.

---

## Implementation Plan

### 1. Create Cleanup Action
Create `convex/filesCleanup.ts`:

```typescript
import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "./files";

const ORPHAN_AGE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
const DELETED_AGE_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days

export const findOrphanedFiles = query({
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_AGE_THRESHOLD;
    
    // Find files without entityId that are older than threshold
    const files = await ctx.db
      .query("files")
      .filter((q) =>
        q.and(
          q.eq(q.field("entityId"), undefined),
          q.lt(q.field("uploadedAt"), cutoff)
        )
      )
      .collect();
    
    return files;
  },
});

export const cleanupOrphanedFiles = internalAction({
  returns: v.promise(v.object({
    deletedCount: v.number(),
    failedCount: v.number(),
  })),
  handler: async (ctx) => {
    const orphanedFiles = await ctx.runQuery(internal.filesCleanup.findOrphanedFiles);
    
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const file of orphanedFiles) {
      try {
        // Delete from R2
        if (file.r2Key) {
          const command = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: file.r2Key,
          });
          await s3Client.send(command);
        }
        
        // Delete from database
        await ctx.runMutation(internal.filesCleanup.deleteFileRecord, {
          fileId: file._id,
        });
        
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete file ${file._id}:`, error);
        failedCount++;
      }
    }
    
    return { deletedCount, failedCount };
  },
});

export const deleteFileRecord = internalMutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.fileId);
  },
});
```

### 2. Schedule Periodic Cleanup
Create or update `convex/crons.ts`:

```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run cleanup daily at 3 AM UTC
crons.daily(
  "cleanup orphaned files",
  { hourUTC: 3, minuteUTC: 0 },
  internal.filesCleanup.cleanupOrphanedFiles,
  {}
);

export default crons;
```

### 3. Add Cleanup Stats Query
```typescript
export const getCleanupStats = query({
  returns: v.object({
    orphanedCount: v.number(),
    totalFiles: v.number(),
    totalStorageBytes: v.number(),
  }),
  handler: async (ctx) => {
    const allFiles = await ctx.db.query("files").collect();
    
    const cutoff = Date.now() - ORPHAN_AGE_THRESHOLD;
    const orphanedFiles = allFiles.filter(
      f => !f.entityId && f.uploadedAt < cutoff
    );
    
    return {
      orphanedCount: orphanedFiles.length,
      totalFiles: allFiles.length,
      totalStorageBytes: allFiles.reduce((sum, f) => sum + f.size, 0),
    };
  },
});
```

### 4. Manual Cleanup Endpoint
```typescript
export const runManualCleanup = action({
  returns: v.promise(v.object({
    deletedCount: v.number(),
    failedCount: v.number(),
  })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    // Check admin role (implement your admin check)
    // if (!isAdmin(identity)) throw new Error("Unauthorized");
    
    return await ctx.runAction(internal.filesCleanup.cleanupOrphanedFiles, {});
  },
});
```

---

## File Structure

```
convex/
├── filesCleanup.ts (new)
├── crons.ts (new or updated)
└── files.ts (shared s3Client export)
```

---

## Dependencies

- P2.1.3: File deletion implemented
- AWS SDK for S3 delete operations
- Convex cron jobs

---

## Acceptance Criteria

- [ ] `cleanupOrphanedFiles` action implemented
- [ ] Orphaned files (no entityId, >24h old) identified
- [ ] Files deleted from both R2 and database
- [ ] Daily cron job scheduled (3 AM UTC)
- [ ] Cleanup stats query implemented
- [ ] Manual cleanup endpoint for admins
- [ ] Error handling for failed deletions
- [ ] Logging for cleanup operations
- [ ] Soft delete option documented (future enhancement)

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.1.3](./task-p2.1.3-implement-file-deletion-queries.md), [P2.3.3](./task-p2.3.3-integrate-attachments-invoice-form.md)
- Convex Cron Docs: https://docs.convex.dev/scheduling/cron-jobs

---

## Notes

- Orphaned files = uploaded but never linked to an invoice/user
- 24-hour grace period allows for slow form submissions
- Consider adding a "deleted" flag for soft deletes instead of permanent
- Monitor cleanup logs for errors
- Stats query useful for admin dashboard
