# Task: Integrate Logo Upload to Settings

**Task ID**: P2.2.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
The LogoUpload component needs to be integrated into the application's settings UI so users can actually upload and manage their logos.

---

## Objective
Integrate the LogoUpload component into the Settings page/drawer with proper data binding and persistence.

---

## Implementation Plan

### 1. Update Settings Component
Modify `src/components/settings/Settings.tsx` (or create if doesn't exist):

```typescript
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LogoUpload } from "./LogoUpload";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function Settings() {
  const user = useQuery(api.users.getCurrentUser);
  const updateUser = useMutation(api.users.updateUser);
  
  const [logoFileId, setLogoFileId] = useState<Id<"files"> | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  
  // Initialize from user data
  useEffect(() => {
    if (user) {
      setLogoFileId(user.logoFileId || null);
      // Fetch logo URL if fileId exists
      if (user.logoFileId) {
        // Query for logo URL
      }
    }
  }, [user]);
  
  const handleLogoChange = async (fileId: Id<"files"> | null, url: string | null) => {
    setLogoFileId(fileId);
    setLogoUrl(url);
    
    try {
      await updateUser({
        logoFileId: fileId,
      });
      toast.success(fileId ? "Logo updated" : "Logo removed");
    } catch (error) {
      toast.error("Failed to save logo");
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Company Logo</h3>
        <p className="text-sm text-muted-foreground">
          Your logo will appear on invoices and PDFs
        </p>
      </div>
      
      <div className="space-y-2">
        <Label>Logo</Label>
        <LogoUpload
          currentLogoUrl={logoUrl || undefined}
          onLogoChange={handleLogoChange}
          entityType="user"
        />
        <p className="text-xs text-muted-foreground">
          Recommended: 200x100px, PNG or SVG for best quality
        </p>
      </div>
    </div>
  );
}
```

### 2. Add User Update Mutation
Create or update `convex/users.ts`:

```typescript
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getCurrentUser = query({
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
  },
});

export const updateUser = mutation({
  args: {
    logoFileId: v.optional(v.union(v.null(), v.id("files"))),
    // Add other user fields as needed
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    
    if (!user) throw new Error("User not found");
    
    await ctx.db.patch(user._id, args);
    
    return { success: true };
  },
});
```

### 3. Add Settings Route/Drawer
Ensure settings is accessible from the UI:

```typescript
// In navigation or header
<Button onClick={() => setSettingsOpen(true)}>
  Settings
</Button>

// Settings drawer/modal
<Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
  <SheetContent>
    <Settings />
  </SheetContent>
</Sheet>
```

### 4. Handle Old Logo Cleanup
Update the updateUser mutation to clean up old logo:

```typescript
export const updateUser = mutation({
  args: {
    logoFileId: v.optional(v.union(v.null(), v.id("files"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    
    if (!user) throw new Error("User not found");
    
    // Clean up old logo if changing
    if (args.logoFileId !== undefined && user.logoFileId && args.logoFileId !== user.logoFileId) {
      await ctx.runAction(api.files.deleteFile, { fileId: user.logoFileId });
    }
    
    await ctx.db.patch(user._id, args);
    return { success: true };
  },
});
```

---

## File Structure

```
src/
├── components/
│   └── settings/
│       ├── Settings.tsx (updated)
│       └── LogoUpload.tsx
convex/
├── users.ts (updated)
```

---

## Dependencies

- P2.2.2: LogoUpload component built
- Convex mutations for user updates
- Toast notifications

---

## Acceptance Criteria

- [ ] LogoUpload integrated into Settings UI
- [ ] Logo persists to user profile on upload
- [ ] Logo loads from user profile on settings open
- [ ] Old logo cleaned up when replaced
- [ ] Toast notifications for success/error
- [ ] Settings accessible from main navigation
- [ ] Responsive layout in settings drawer/page
- [ ] Help text explains logo usage

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.2](./task-p2.2.2-build-logo-upload-component.md)

---

## Notes

- Consider adding team logo support in future
- Logo appears on all invoices created by the user
- SVG logos recommended for best quality at any size
- Old logos are deleted to save storage space
