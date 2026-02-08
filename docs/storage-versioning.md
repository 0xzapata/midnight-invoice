# Storage Versioning Guide

This document explains how to manage localStorage schema versions for backward compatibility.

## Overview

| Term | Description |
|------|-------------|
| **Storage Version** | Schema version for localStorage data structure |
| **Package Version** | App release version (`package.json`) |

> [!IMPORTANT]
> Storage versions are **independent** of package.json versions. You may release many app versions without changing the storage schema, or bump the schema multiple times within a single release.

## When to Bump Storage Version

Bump the version when making **breaking changes** to persisted data:

| Change Type | Bump Required? | Example |
|-------------|----------------|---------|
| Add optional field | ❌ No | Adding `invoiceName?: string` |
| Add required field | ✅ Yes | Adding `clientId: string` (must migrate existing data) |
| Rename field | ✅ Yes | `fromName` → `senderName` |
| Change field type | ✅ Yes | `taxRate: string` → `taxRate: number` |
| Remove field | ✅ Yes | Removing `legacyField` |
| Change structure | ✅ Yes | Nesting fields, splitting arrays |

## Migration Procedure

### Step 1: Update Version Constant

In `src/lib/storageMigrations.ts`:

```typescript
// Before
export const CURRENT_INVOICE_VERSION = 1;

// After
export const CURRENT_INVOICE_VERSION = 2;
```

### Step 2: Add Migration Logic

Add a new migration step in the appropriate migrate function:

```typescript
export function migrateInvoiceStore(
    persistedState: unknown,
    version: number
): InvoicePersistedState {
    let state = persistedState as InvoicePersistedState;
    
    // Existing: v0 → v1
    if (version < 1) {
        state = {
            ...state,
            invoices: (state.invoices || []).map((inv) => ({
                ...inv,
                version: 1,
            })),
            drafts: state.drafts || {},
        };
    }
    
    // NEW: v1 → v2 (example: rename field)
    if (version < 2) {
        state = {
            ...state,
            invoices: state.invoices.map((inv) => ({
                ...inv,
                senderName: (inv as any).fromName,
                version: 2,
            })),
        };
    }
    
    return state;
}
```

### Step 3: Update Type Definitions

In `src/types/invoice.ts`, update the interface to match v2:

```typescript
export interface Invoice {
  version?: number;
  senderName: string;  // renamed from fromName
  // ...
}
```

### Step 4: Add Tests

In `src/lib/storageMigrations.test.ts`:

```typescript
it('migrates from version 1 to version 2', () => {
    const v1State = {
        invoices: [{ version: 1, fromName: 'Old Name', /* ... */ }],
        drafts: {},
    };
    
    const result = migrateInvoiceStore(v1State, 1);
    
    expect(result.invoices[0].senderName).toBe('Old Name');
    expect(result.invoices[0].version).toBe(2);
});
```

### Step 5: Verify

```bash
bun run test:run
```

## Checklist

- [ ] Is this a breaking change to stored data? (If no, skip versioning)
- [ ] Increment `CURRENT_*_VERSION` constant
- [ ] Add migration step in `migrate*Store()` function
- [ ] Update TypeScript interfaces
- [ ] Add migration tests
- [ ] Test manually with existing localStorage data
- [ ] Run full test suite

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/storageMigrations.ts` | Version constants and migration functions |
| `src/lib/storageMigrations.test.ts` | Migration tests |
| `src/types/invoice.ts` | Invoice type definitions |
| `src/stores/useInvoiceStore.ts` | Invoice store with persist config |
| `src/stores/useSettingsStore.ts` | Settings store with persist config |
