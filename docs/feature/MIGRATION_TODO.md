# Migration Wizard TODO

## Overview
When a user upgrades to a paid plan, they need to migrate their local invoices to the cloud.

## Implementation Tasks

### 1. Announcement Bar Component
Create a dismissible announcement bar that appears at the top of the dashboard for paid users with local invoices.

**File:** `src/components/MigrationBanner.tsx`

**Trigger Conditions:**
- User has paid plan (check user.plan in Convex users table)
- User has local invoices (check localStorage)
- User hasn't dismissed the banner (track in localStorage)

**UI:**
```tsx
"You have {count} local invoices. Migrate them to the cloud for sync across devices."
[Migrate Now] [Dismiss]
```

### 2. Migration Wizard Modal
Create a multi-step wizard to guide users through migration.

**File:** `src/components/MigrationWizard.tsx`

**Steps:**
1. **Review**: Show list of invoices to be migrated
2. **Confirm**: Warn about potential duplicates
3. **Migrate**: Progress bar with status
4. **Complete**: Success message with option to delete local copies

**Logic:**
```typescript
async function migrateInvoices(localInvoices: Invoice[]) {
  const results = [];
  
  for (const invoice of localInvoices) {
    try {
      // Use the Convex mutation to create invoice
      const { status, toName, toEmail, toAddress, ...rest } = invoice;
      
      const cloudId = await createInvoice({
        ...rest,
        clientSnapshot: {
          name: toName,
          email: toEmail,
          address: toAddress,
        },
        status: status || "draft"
      });
      
      results.push({ localId: invoice.id, cloudId, status: 'success' });
    } catch (error) {
      results.push({ localId: invoice.id, status: 'error', error });
    }
  }
  
  return results;
}
```

### 3. Post-Migration Cleanup
After successful migration, optionally clear local invoices.

**Options:**
- Keep local copies as backup (default)
- Delete local copies after confirmation

### 4. Edge Cases to Handle

**Duplicate Invoice Numbers:**
- Check for existing invoice numbers in cloud before migrating
- Offer to rename duplicates automatically (e.g., INV-0001 → INV-0001-migrated)

**Failed Migrations:**
- Log errors for failed invoices
- Offer retry for failed items
- Don't delete local copies if any migrations failed

**Network Issues:**
- Show clear error messages
- Allow resuming migration later
- Track migration progress in localStorage

### 5. Testing Checklist

- [ ] Migration works with 1 invoice
- [ ] Migration works with 100+ invoices
- [ ] Migration handles network failures gracefully
- [ ] Migration detects and handles duplicate invoice numbers
- [ ] Banner appears for paid users with local invoices
- [ ] Banner doesn't appear after dismissal
- [ ] Banner reappears if new local invoices are created
- [ ] Post-migration cleanup works correctly

### 6. Files to Create/Modify

**New Files:**
- `src/components/MigrationBanner.tsx`
- `src/components/MigrationWizard.tsx`
- `src/hooks/useMigration.ts`

**Modified Files:**
- `src/pages/Index.tsx` (add MigrationBanner)
- `src/hooks/useInvoiceData.ts` (already prepared with backend mutations)

## Notes

The backend mutation `api.invoices.getNextInvoiceNumber` exists for atomic invoice number generation during migration. This prevents race conditions when multiple invoices are being migrated concurrently.

Currently, the frontend uses a cached/computed value for `getNextInvoiceNumber` for synchronous access in form initialization. The backend mutation can be used in the migration wizard for guaranteed uniqueness.
