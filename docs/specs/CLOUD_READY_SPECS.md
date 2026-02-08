# Cloud-Ready Specifications

This document defines the detailed specifications for the "Cloud-Ready" milestone of Midnight Invoice.

## 1. Authentication & User Profile

**Goal**: Allow users to sign in/up via WorkOS and manage their session.

### UI Components
*   **Header**:
    *   **Guest State**: Show a "Sign In" button (Variant: `outline` or `ghost`, size `sm`).
    *   **Authenticated State**: Show a **User Avatar** (using `Avatar` from shadcn/ui) with the user's initial or profile picture.
*   **Profile Dropdown**:
    *   Clicking the Avatar opens a `DropdownMenu`.
    *   **Items**:
        *   User Name/Email (Header, muted text)
        *   "Settings" (Navigates to Settings tab)
        *   "Sign Out" (Action)

### Behavior
*   **Sign In**: Triggers `convexAuth.signIn("workos")` which redirects to the specific WorkOS provider configured in `convex/auth.ts`.
*   **Sign Out**: Triggers `convexAuth.signOut()`, then redirects to home (`/`) and clears specific query caches if needed.
*   **Persistence**: The `useInvoiceData` hook already handles switching between LocalStore and Convex based on `isAuthenticated`.

---

## 2. Data Migration (Local to Cloud)

**Goal**: Ensure users don't lose their offline work when they decide to sign up.

### Workflow
1.  **Trigger**: Detects `isAuthenticated === true` AND `localStorage.invoices.length > 0` (check via `useInvoiceStore`).
    *   *Edge Case*: If user already has cloud invoices, still offer to sync local ones? -> Yes, merge them.
2.  **UI**: Display a **Migration Modal** (Dialog) immediately after login (using a `useEffect` in `App.tsx` or a layout wrapper).
    *   **Title**: "Sync your invoices to the cloud?"
    *   **Body**: "We found [X] invoices on this device. Would you like to save them to your account?"
    *   **Actions**:
        *   "Sync Invoices" (Primary): Calls `api.invoices.batchCreate`.
        *   "Skip & Delete Local": Clears local store without syncing.
        *   "Not Now" (Secondary): Closes modal but keeps local data (modal may reappear next session).
3.  **Post-Sync**:
    *   Once synced, clear `localStorage` invoices to avoid duplication.
    *   Show toast: "Invoices synced successfully."

---

## 3. Client Management

**Goal**: Manage reusable client profiles to speed up invoice creation.

### Schema
Already defined in `convex/schema.ts` (`clients` table):
- `name`
- `email` (optional)
- `address` (optional)
- `userId` (index)

### UI Components
*   **New Route**: Add `/clients` route? Or keep it single-page-ish? 
    *   *Decision*: Add a **"Clients" Tab** on the main Dashboard to match the current "Invoices" / "Settings" layout.
*   **Clients List (Tab Content)**:
    *   Search Bar: "Search clients..."
    *   List/Grid: Cards showing Name, Email, Address snippet.
    *   Row Actions: Edit (Pencil), Delete (Trash).
*   **Add/Edit Client Modal**:
    *   Form fields: Name, Email, Address, Notes.
    *   Save logic: `api.clients.create` / `api.clients.update`.

### Invoice Integration
*   **Invoice Form**:
    *   Replace standard "To" inputs with a enhanced **Client Selector**.
    *   **Component**: `Combobox` (popover with search).
    *   **Behavior**:
        *   User types "Acme"... -> Searches `clients` index.
        *   Selects "Acme Corp" -> Auto-fills `toName`, `toEmail`, `toAddress`.
        *   *Manual Entry*: If user types a name not in list and fills details manually, it stays as a "one-off" unless they click a "Save to Clients" button (optional enhancement).

---

## 4. Advanced Features (V2 Preview)

### A. Email Integration
*   **Provider**: **Resend** (Recommended for ease of use/Convex integration).
*   **Backend**: Convex Action `api.invoices.sendEmail`.
    *   Argument: `invoiceId`, `recipientEmail`, `subject`, `body`.
    *   Logic: Generates PDF (on server? or passing URL/Base64?). 
    *   *Constraint*: Generating PDF on Convex Action node environment might be tricky with `react-pdf`. 
    *   *Alt Strategy*: Generate PDF on client, upload to Convex Storage (`api.storage.upload`), then pass the `storageId` to the Action to email as attachment.
*   **UI**: "Send via Email" button on `ViewInvoice` page.
    *   Opens modal: "Send to [Client Email]".
    *   Subject/Message input.
*   **Status**: Update invoice status to `sent` upon success.

### B. Recurring Invoices
*   **Schema Addition**: `recurring_configs` table.
    *   `frequency`: 'monthly', 'weekly', 'yearly'.
    *   `nextRun`: number (timestamp).
    *   `templateInvoiceId`: Id<"invoices">.
*   **Backend**: Convex Cron Job (`crons.ts`).
    *   Runs daily.
    *   Checks `recurring_configs` where `nextRun <= now`.
    *   Clones `templateInvoiceId` -> creates new invoice.
    *   Updates `nextRun`.

### C. Templates
*   **Storage**: Store `templateId` (string) on `invoices` table.
*   **UI**: "Template" selector in Settings or Invoice Form.
*   **Render**: `InvoicePDF.tsx` accepts a `template` prop and renders dynamic styles/layouts.

## 5. Technical Improvements

*   **React Router**: Update to v7 future flags to silence warnings.
*   **Type Safety**: Ensure `ActiveInvoice` type covers both Local and Cloud variants perfectly.
