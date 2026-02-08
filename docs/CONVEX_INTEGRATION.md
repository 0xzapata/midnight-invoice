# Convex DB & WorkOS Integration Plan

## Overview
This document outlines the architectural decision to use **Convex** as the backend database and **WorkOS** for authentication in Midnight Invoice.

## Why Convex?
- **Type Safety:** End-to-end type safety without manual generation steps.
- **Developer Experience:** rapid iteration with "backend as code".
- **Realtime:** Native realtime updates for multi-device sync.
- **Auth:** First-party integration with WorkOS.

## Hybrid Storage Strategy (Free vs Pro)
We are adopting a **Hybrid Storage Model** to ensure the app remains free and local-first for guest users.

### 1. Guest Users (Free Tier)
- **Storage:** Continues to use `localStorage` via Zustand.
- **Functionality:** Full offline support, creation, editing, PDF export.
- **Limitations:** Data stays on one device; risk of browser cache clearing.

### 2. Authenticated Users (Pro Tier)
- **Storage:** **Convex DB** becomes the source of truth.
- **Sync:** Real-time updates across all logged-in devices.
- **Features:** "Cloud Backup", "Client Management", "Templates".

## Implementation Strategy

### 1. Authentication (WorkOS)
- Use **Convex Auth** with WorkOS as the identity provider.
- Setup standard OIDC flow.
- Protected routes in React using `Authenticated` and `Unauthenticated` components from Convex.

### 2. Data Migration & Sync
- **Migration Event:** Triggered immediately upon successful login.
- **Workflow:**
    1. **Detect:** Check if user has invoices in `localStorage`.
    2. **Prompt:** "Sync your X local invoices to the cloud?" (Or auto-sync).
    3. **Upload:** Bulk mutation to insert local invoices into Convex.
    4. **Switch:** Update app state to read from `useQuery(api.invoices.list)`.
    5. **Cleanup:** Clear local storage (or retain as backup, flagged as synced).

### 3. Unified Data Hook
The app will consume data via a single interface that abstracts the source:

```typescript
// hooks/useInvoices.ts (Concept)
export function useInvoices() {
  const { isAuthenticated } = useConvexAuth();
  const localStore = useLocalStore();
  const cloudData = useQuery(api.invoices.list) || [];

  if (isAuthenticated) {
    return { 
      invoices: cloudData, 
      save: (inv) => mutation.create(inv),
      source: 'cloud' 
    };
  }
  
  return { 
    invoices: localStore.invoices, 
    save: localStore.saveInvoice,
    source: 'local' 
  };
}
```

## Schema Draft

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  invoices: defineTable({
    userId: v.string(), // WorkOS User ID
    invoiceNumber: v.string(),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    // ... other fields
    clientName: v.string(),
    totalAmount: v.number(),
    status: v.string(), // 'draft', 'paid', 'sent'
    lineItems: v.array(v.object({
      description: v.string(),
      quantity: v.number(),
      price: v.number(),
    })),
  }).index("by_user", ["userId"]),
  
  clients: defineTable({
    userId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
```
