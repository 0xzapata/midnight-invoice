# Task: Add Storage Usage Analytics

**Task ID**: P2.4.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Low  
**Effort**: Small (1 day)  
**Component**: Backend

---

## Problem Statement
There's no visibility into storage usage patterns, making it difficult to monitor costs, identify heavy users, or plan capacity.

---

## Objective
Implement storage analytics queries and tracking to monitor usage by user, file type, and time period.

---

## Implementation Plan

### 1. Create Analytics Queries
Create `convex/storageAnalytics.ts`:

```typescript
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// User-level storage stats
export const getUserStorageStats = query({
  returns: v.object({
    totalFiles: v.number(),
    totalBytes: v.number(),
    byType: v.record(v.string(), v.object({
      count: v.number(),
      bytes: v.number(),
    })),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const files = await ctx.db
      .query("files")
      .withIndex("by_user", (q) =>
        q.eq("userId", identity.tokenIdentifier)
      )
      .collect();
    
    const byType: Record<string, { count: number; bytes: number }> = {};
    
    for (const file of files) {
      if (!byType[file.fileType]) {
        byType[file.fileType] = { count: 0, bytes: 0 };
      }
      byType[file.fileType].count++;
      byType[file.fileType].bytes += file.size;
    }
    
    return {
      totalFiles: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
      byType,
    };
  },
});

// Admin: Global storage stats
export const getGlobalStorageStats = query({
  returns: v.object({
    totalFiles: v.number(),
    totalBytes: v.number(),
    totalUsers: v.number(),
    averagePerUser: v.number(),
    byType: v.record(v.string(), v.object({
      count: v.number(),
      bytes: v.number(),
    })),
  }),
  handler: async (ctx) => {
    // TODO: Add admin authentication check
    
    const files = await ctx.db.query("files").collect();
    const users = new Set(files.map(f => f.userId));
    
    const byType: Record<string, { count: number; bytes: number }> = {};
    
    for (const file of files) {
      if (!byType[file.fileType]) {
        byType[file.fileType] = { count: 0, bytes: 0 };
      }
      byType[file.fileType].count++;
      byType[file.fileType].bytes += file.size;
    }
    
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    
    return {
      totalFiles: files.length,
      totalBytes,
      totalUsers: users.size,
      averagePerUser: users.size > 0 ? Math.round(totalBytes / users.size) : 0,
      byType,
    };
  },
});

// Monthly upload trends
export const getUploadTrends = query({
  args: { months: v.optional(v.number()) },
  returns: v.array(v.object({
    month: v.string(),
    uploads: v.number(),
    bytes: v.number(),
  })),
  handler: async (ctx, args) => {
    const months = args.months || 6;
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    
    const files = await ctx.db
      .query("files")
      .filter((q) => q.gte(q.field("uploadedAt"), cutoff))
      .collect();
    
    const trends: Record<string, { uploads: number; bytes: number }> = {};
    
    for (const file of files) {
      const date = new Date(file.uploadedAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      
      if (!trends[monthKey]) {
        trends[monthKey] = { uploads: 0, bytes: 0 };
      }
      trends[monthKey].uploads++;
      trends[monthKey].bytes += file.size;
    }
    
    return Object.entries(trends)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));
  },
});

// Top users by storage
export const getTopStorageUsers = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({
    userId: v.string(),
    fileCount: v.number(),
    totalBytes: v.number(),
  })),
  handler: async (ctx, args) => {
    // TODO: Add admin authentication check
    
    const limit = args.limit || 10;
    const files = await ctx.db.query("files").collect();
    
    const userStats: Record<string, { fileCount: number; totalBytes: number }> = {};
    
    for (const file of files) {
      if (!userStats[file.userId]) {
        userStats[file.userId] = { fileCount: 0, totalBytes: 0 };
      }
      userStats[file.userId].fileCount++;
      userStats[file.userId].totalBytes += file.size;
    }
    
    return Object.entries(userStats)
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .slice(0, limit);
  },
});
```

### 2. Create Storage Dashboard Component
Create `src/components/admin/StorageDashboard.tsx`:

```typescript
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFileSize } from "@/lib/files/validation";

export function StorageDashboard() {
  const stats = useQuery(api.storageAnalytics.getGlobalStorageStats);
  const trends = useQuery(api.storageAnalytics.getUploadTrends, { months: 6 });
  
  if (!stats) return <Loading />;
  
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Storage Analytics</h2>
      
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Total Files</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalFiles.toLocaleString()}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Total Storage</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatFileSize(stats.totalBytes)}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalUsers}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Avg per User</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatFileSize(stats.averagePerUser)}</p>
          </CardContent>
        </Card>
      </div>
      
      {/* Storage by Type */}
      <Card>
        <CardHeader>
          <CardTitle>Storage by File Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(stats.byType).map(([type, data]) => (
              <div key={type} className="flex justify-between">
                <span className="capitalize">{type.replace("_", " ")}</span>
                <span>{data.count} files ({formatFileSize(data.bytes)})</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 3. Add Usage Warnings
```typescript
// Hook for usage warnings
export function useStorageWarning() {
  const stats = useQuery(api.storageAnalytics.getUserStorageStats);
  
  if (!stats) return null;
  
  const WARNING_THRESHOLD = 100 * 1024 * 1024; // 100MB
  const LIMIT_THRESHOLD = 500 * 1024 * 1024; // 500MB
  
  if (stats.totalBytes > LIMIT_THRESHOLD) {
    return { level: "error", message: "Storage limit exceeded" };
  }
  
  if (stats.totalBytes > WARNING_THRESHOLD) {
    return { level: "warning", message: "Approaching storage limit" };
  }
  
  return null;
}
```

---

## File Structure

```
src/
├── components/
│   └── admin/
│       └── StorageDashboard.tsx
├── hooks/
│   └── useStorageWarning.ts
convex/
└── storageAnalytics.ts
```

---

## Dependencies

- P2.4.1: File cleanup job (for understanding storage patterns)
- Convex queries
- shadcn/ui Card components

---

## Acceptance Criteria

- [ ] `getUserStorageStats` query implemented
- [ ] `getGlobalStorageStats` query implemented (admin)
- [ ] `getUploadTrends` query implemented
- [ ] `getTopStorageUsers` query implemented (admin)
- [ ] Storage dashboard component created
- [ ] File size formatting utilities
- [ ] Storage warning hook created
- [ ] Usage thresholds defined (100MB warning, 500MB limit)
- [ ] Admin authentication checks in place

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.4.1](./task-p2.4.1-add-file-cleanup-job.md)

---

## Notes

- Storage thresholds are suggestions; adjust based on actual usage
- Consider implementing hard limits in the future
- Analytics data can inform pricing tier decisions
- Trends useful for capacity planning
