# Task: Add Files Table to Schema

**Task ID**: P1.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Database

---

## Problem Statement
The database schema lacks a table to track uploaded files and their metadata, preventing file management and association with users, teams, and invoices.

---

## Objective
Add a `files` table to the Convex schema to store file metadata and references to R2 storage.

---

## Implementation Plan

### 1. Update Schema Definition
Edit `convex/schema.ts` to add the files table:

```typescript
export default defineSchema({
  // ... existing tables ...
  
  files: defineTable({
    // Ownership
    userId: v.string(),
    teamId: v.optional(v.id("teams")),
    
    // File metadata
    filename: v.string(),
    originalName: v.string(),
    mimeType: v.string(),
    size: v.number(), // bytes
    
    // Storage
    r2Key: v.string(), // Path in R2 bucket
    r2Url: v.string(), // Public URL
    
    // Usage context
    fileType: v.union(
      v.literal("logo"),
      v.literal("avatar"),
      v.literal("attachment"),
      v.literal("product_image")
    ),
    entityId: v.optional(v.string()), // invoiceId, clientId, etc.
    
    // Tracking
    uploadedAt: v.number(),
    lastAccessedAt: v.optional(v.number()),
  })
  .index("by_user", ["userId"])
  .index("by_team", ["teamId"])
  .index("by_entity", ["entityId", "fileType"])
  .index("by_type_user", ["userId", "fileType"]),
});
```

### 2. Update Related Tables
Add logo references to users and teams tables:

```typescript
users: defineTable({
  // ... existing fields ...
  logoFileId: v.optional(v.id("files")),
}),

teams: defineTable({
  // ... existing fields ...
  logoFileId: v.optional(v.id("files")),
}),

invoices: defineTable({
  // ... existing fields ...
  attachmentFileIds: v.optional(v.array(v.id("files"))),
}),
```

### 3. Generate Types
Run Convex type generation:
```bash
npx convex dev
```

### 4. Verify Schema
- Check generated types in `convex/_generated/`
- Verify indexes are correctly defined
- Test query patterns

---

## File Structure

```
convex/
├── schema.ts (updated)
├── _generated/
│   ├── dataModel.ts (regenerated)
│   └── ...
```

---

## Dependencies

- P1.1.1: R2 bucket must be created first (for reference)
- Convex CLI configured and running

---

## Acceptance Criteria

- [ ] `files` table added to Convex schema with all fields
- [ ] Indexes created for efficient queries (by_user, by_team, by_entity, by_type_user)
- [ ] `logoFileId` field added to `users` table
- [ ] `logoFileId` field added to `teams` table
- [ ] `attachmentFileIds` field added to `invoices` table
- [ ] Types regenerated successfully
- [ ] Schema validates without errors
- [ ] Documentation updated with schema changes

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P1.1.1](./task-p1.1.1-create-r2-bucket.md)
- Convex Schema Docs: https://docs.convex.dev/database/schemas

---

## Notes

- File content is stored in R2, only metadata in Convex
- Use `entityId` to associate files with specific invoices or clients
- `lastAccessedAt` enables cleanup of unused files later
- Consider adding a `deletedAt` field for soft deletes if needed
