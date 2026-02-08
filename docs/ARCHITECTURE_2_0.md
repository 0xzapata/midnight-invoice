# Architecture 2.0: Hybrid Storage & Cloud Integration

## 1. Executive Summary

This document defines the technical architecture for **Midnight Invoice v2.0**. The primary goal is to introduce a **Pro Tier** with Cloud Sync (Convex) and Secure Auth (WorkOS) while preserving the completely offline, no-account-required experience for **Guest Users** (LocalStorage).

## 2. Hybrid Data Architecture

To maintain code maintainability while supporting two distinct data sources (Zustand/LocalStorage vs. Convex/Cloud), we will implement a **Data Abstraction Layer**.

### The Unified Hook Pattern
UI components should not know *where* data comes from. They will consume a unified hook `useInvoiceData()`.

```typescript
// src/hooks/useInvoiceData.ts

export function useInvoiceData() {
  // 1. Check Auth Status
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  
  // 2. Load Data Sources
  const localStore = useInvoiceStore(); // Zustand
  const cloudQuery = useQuery(api.invoices.list); // Convex
  const cloudMutations = useMutation(api.invoices.save);

  // 3. Return Unified Interface
  if (isAuthenticated) {
    return {
      invoices: cloudQuery || [],
      isLoading: !cloudQuery,
      saveInvoice: cloudMutations,
      source: 'cloud' as const
    };
  }

  return {
    invoices: localStore.invoices,
    isLoading: localStore.isLoading,
    saveInvoice: localStore.saveInvoice,
    source: 'local' as const
  };
}
```

## 3. Database Schema (Convex)

The schema is designed for flexibility (document-based) and security (RLS via Auth).

### `convex/schema.ts`

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users (Synced from WorkOS via Webhook or Auth)
  users: defineTable({
    tokenIdentifier: v.string(), // WorkOS ID
    email: v.string(),
    name: v.optional(v.string()),
    plan: v.string(), // 'free', 'pro'
  }).index("by_token", ["tokenIdentifier"]),

  // Invoices
  invoices: defineTable({
    userId: v.string(), // Foreign Key to Users
    invoiceNumber: v.string(),
    invoiceName: v.optional(v.string()),
    issueDate: v.string(), // ISO Date
    dueDate: v.optional(v.string()),
    status: v.string(), // 'draft', 'sent', 'paid'
    
    // Payment & Sender Details
    fromName: v.string(),
    fromEmail: v.string(),
    currency: v.string(),
    taxRate: v.number(),
    
    // JSON Structure for Line Items (No separate table needed for NoSQL)
    lineItems: v.array(v.object({
      id: v.string(),
      description: v.string(),
      quantity: v.number(),
      price: v.number(),
    })),
    
    // Client Info (Denormalized Snapshot for invoice immutability)
    clientSnapshot: v.object({
      name: v.string(),
      email: v.string(),
      address: v.string(),
    }),
    
    clientId: v.optional(v.id("clients")), // Link to live client record
  })
  .index("by_user", ["userId"])
  .index("by_invoice_number", ["userId", "invoiceNumber"]), // Uniqueness check scope

  // Clients (New Feature)
  clients: defineTable({
    userId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
```

## 4. Authentication & WorkOS Integration

We will use **Convex Auth** which provides a first-party wrapper around OpenID Connect (OIDC).

### Workflow
1.  **Frontend:** User clicks "Sign In".
2.  **Redirect:** App redirects to WorkOS Hosted Login.
3.  **Callback:** WorkOS redirects back to `/auth/callback`.
4.  **Token Exchange:** Convex verifies the OIDC token.
5.  **Session:** Convex issues a session token. `isAuthenticated` becomes true.

### Row Level Security (RLS)
All queries/mutations will start with:
```typescript
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new Error("Unauthenticated");
const userId = identity.tokenIdentifier;
```
This ensures users can ONLY access their own data.

## 5. Data Migration Strategy (The "Upgrade Event")

When a Guest User (LocalStorage) logs in for the first time, we must migrate their data.

### Logic Flow
1.  **Login Success:** `isAuthenticated` becomes true.
2.  **Migration Component:** A global `DataMigrator` component detects:
    - User is Authenticated.
    - `localStorage` has > 0 invoices.
    - `localStorage` flag `migration_completed` is false.
3.  **User Prompt:** "We found X invoices on this device. Upload them to your cloud account?"
4.  **Execution:**
    - Call Convex Action `api.invoices.bulkImport(localInvoices)`.
    - On success:
        - Set `localStorage` `migration_completed = true`.
        - (Optional) Clear `localStorage` to avoid confusion, or keep as "Backup".
5.  **Conflict Handling:**
    - If Invoice #101 exists in both (rare edge case), Cloud wins, or we append "-copy" to the local one during import.

## 6. Offline Strategy

### Guest Users (Free)
- **Mechanism:** Native `localStorage`.
- **Experience:** 100% Offline capability. No change.

### Pro Users (Cloud)
- **Mechanism:** Convex React Query Caching.
- **Reads:** Recently loaded invoices work offline (cache).
- **Writes:** Optimistic Updates allow the UI to update instantly.
- **Persistence Gap:**
    - *Risk:* If user makes edits offline and closes the tab *before* reconnecting, edits are lost (Memory-only queue).
    - *Mitigation (V2.0):* "Unsaved Changes" warning if connection is lost.
    - *Future (V2.1):* Integrate `@convex-dev/react-query` with persistence to IndexedDB for "True Offline" writes.
