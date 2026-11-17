# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Invoice templates** (replaces the "Invoice Templates" teaser in Coming Soon): a Templates page (`/templates`, linked from the dashboard header) to list, search, add, edit, archive and delete templates with a line-item editor and a placeholder helper with live preview. Placeholders (`{{month}}`, `{{month_name}}`, `{{prev_month_name}}`, `{{prev_month_year}}`, `{{year}}`, `{{quarter}}`, `{{client_name}}`, `{{invoice_number}}`) are resolved for the invoice's issue date by one shared, whitelisted function (`shared/template-placeholders.ts`); unknown ones stay visible and are flagged. "New from template" on the dashboard, "From template" in the invoice form (asks before touching anything typed: add to the invoice or replace) and "Save as template" in the form and on the invoice page. Invoices made from a template are independent drafts that record `templateId`. Local-first (`template-storage`) and synced as a third collection (clients → templates → invoices).
- **Template activity**: template writes are logged (`template.created|updated|archived|unarchived|deleted`, field names only); an invoice created from a template logs one `invoice.created` naming the template (snapshot); "enable cloud sync" summaries count templates; the Activity page describes these entries and links them to `/templates` (deleted ones are marked).
- **Templates API**: migration `0005_templates.sql`; `GET /api/v1/templates` (`q`, sync feed), `POST`, `GET/PUT/PATCH/DELETE /api/v1/templates/:id` with revisions/ETags and soft deletes; `POST /api/v1/templates/:id/instantiate` creates a draft invoice (explicit values > template > client defaults > settings) and reports unknown/unresolved placeholders; scopes `templates:read` and `templates:write` (existing agents keep exactly their scopes); invoices accept an optional `templateId` reference; MCP tools `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `create_invoice_from_template`.
- **Activity log**: a per-workspace audit trail of what the user's browsers and approved agents did. Migration `0006_activity.sql` (append-only `activity` table); one recording API in `server/services/activity.ts` (`activityWrite` commits the entry in the same D1 batch as invoice, client, settings and agent-access writes; `recordActivity` records PDF downloads and revoked-key attempts in the background; a logging failure never fails the request). Entries carry actor, stable action codes (`invoice.status_changed`, `agent.revoked`, …), entity + label snapshot, changed field names / status from→to (never bodies or secrets), source (`rest` or `mcp` + tool) and request id. No-op writes are not logged; a browser's initial upload is one `sync.bulk_upload` entry (`X-Midnight-Sync` header); repeated PDF downloads and revoked-key attempts are collapsed. Retention by a daily scheduled job (`activity.retention`), 365 days / 10,000 entries per workspace by default, configurable as operator settings `activity.retentionDays` / `activity.maxRowsPerWorkspace`; deleted with the workspace (also from the operator console, whose workspace list shows only an activity count). An agent's view includes the user's approval of it; agent chips link to that agent's activity, including revoked agents.
- **Activity API**: `GET /api/v1/activity` (filters `actor`, `agent_id`, `action` prefixes, `entity_type`, `entity_id`, `since`, `until`; newest-first cursor paging) and `GET /api/v1/agents/:id/activity`; new scope `activity:read` lets an agent read only its own entries, also as MCP tool `get_my_activity`.
- **Activity page** (`/activity`, linked from Agents and Settings → Cloud sync & agents): day-grouped timeline with "You" / agent chips, plain-language sentences, changed fields, links to invoices and clients (deleted ones marked), filters for agent, kind of action and date range, "Load older activity". The Agents page shows each agent's latest actions with "View activity"; the invoice page has a History section. With cloud sync off, the page explains that activity is recorded once sync is on.
- **Saved clients** (replaces the "Client Management" teaser in Coming Soon): a Clients page (`/clients`, linked from the dashboard header) to list, search, add, edit, archive and delete clients (with confirmation), with default currency, tax rate and payment terms per client, private notes, invoice counts and "New invoice" for a client; one-click import from existing invoices (deduplicated by normalised name + email). In the invoice form, a client picker on Bill To fills name, address and email plus the client's defaults (never overwriting currency, tax rate or due date you already changed), and "Save as client" / "Update client" / "Link client" keep the list current. Invoices keep their own copy of the client's details and an optional `clientId`; editing a client never changes past invoices. Works offline and without cloud sync (`client-storage`), and syncs like invoices when cloud sync is on.
- **Clients API**: migration `0003_clients.sql`; `GET /api/v1/clients` (search with `q`, sync feed), `POST`, `GET/PUT/PATCH/DELETE /api/v1/clients/:id` with revisions/ETags and soft deletes; scopes `clients:read` and `clients:write` (existing agents keep exactly their scopes); invoices accept `clientId` and fill omitted to-fields and terms from the client (client defaults before workspace settings); MCP tools `list_clients`, `get_client`, `create_client`, `update_client`, `delete_client`; `GET /api/v1/invoices?client_id=` and `list_invoices {client_id}` list a client’s invoices (combinable with the status filters). The approval and Agents pages describe the new permissions.

### Changed
- **Sync engine** generalised to synced collections (`src/lib/sync/collection.ts`, `collections/`): invoices and clients share pull/push, queue, backoff, tombstones and the three-way merge; uploads of referenced clients go before the invoices that reference them. The cloud store moves to version 2 (per-collection cursors and queue entries; version 1 data is migrated).
- Invoice `toName` may be omitted on `POST`/`PUT /api/v1/invoices` when `clientId` is given (OpenAPI `InvoiceInput.required` is now `["lineItems"]`).
- The dashboard's "New Invoice" button is icon-only on small screens.
- Dashboard header: Clients, Templates and Agents are separate links from `sm` (labels from `lg`) and one "Pages" menu on phones (`src/components/HeaderNav.tsx`), so the header fits at 320 px with sync status and New Invoice. On the invoice page "Save as template" sits in the "More actions" menu below `lg`. Saving a template from an invoice offers "View templates" in the toast. The operator console counts templates (counts only), groups template routes under "Templates" in telemetry and treats `GET /templates?include_deleted=true` as sync.

### Changed
- **Dependencies**: Upgraded to current major versions: React 19.3, React Router 8 (replaces `react-router-dom` 6), Tailwind CSS 4, Vite 8, Vitest 5, TypeScript 6.0, ESLint 10, Zod 4, date-fns 4, lucide-react 1, Sonner 2, tailwind-merge 3, next-themes 0.4, vite-plugin-pwa 2, jsdom 31 and more.
- **Tailwind CSS 4**: CSS-first configuration in `src/index.css` via `@tailwindcss/vite`; removed `tailwind.config.ts`, `postcss.config.js` and autoprefixer; `tailwindcss-animate` replaced by `tw-animate-css`. Compatibility rules keep the UI visually unchanged.
- **Tooling**: Switched to `@vitejs/plugin-react`; lockfile migrated to the text `bun.lock`; husky is now a dev dependency; Node.js 22.22+ is required.
- **Environment**: No `.env` file is needed; `VITE_APP_NAME` defaults to "Midnight Invoice". `.env.example` documents both variables.

### Added
- **Operator console** (`/operator`, private): first-run wizard unlocked by the `INITIAL_PASSWORD` secret (encryption master key with a one-time recovery key, WorkOS credentials, operator account via WorkOS AuthKit with password and/or passkey), after which the bootstrap login is permanently disabled; AuthKit sign-in with an operator allowlist, cookie sessions with CSRF protection, idle/absolute timeouts and revocation; overview stats and charts; telemetry per part of the service (REST route groups, MCP tools, agent-registration funnel, sync, PDF, rate limits, auth failures, D1 health) from D1 rollups; workspaces and agents (metadata only) with suspend, delete and force-revoke; runtime settings registry stored in D1 with envelope encryption for secrets (AES-256-GCM, optional hardened `ENCRYPTION_KEY` mode, key rotation and recovery); maintenance mode and registration toggles; restart (reload runtime configuration) and redeploy (GitHub Actions `workflow_dispatch`); audit log. Cron Trigger job registry (`server/scheduled.ts`) with hourly telemetry retention. `bun run dev:operator` runs it locally against the WorkOS emulator (`workos dev`). Migration `0004_operator.sql`.
- Public API error codes `maintenance` (503), `workspace_suspended` and `registration_closed` (403). In the app, suspension and maintenance pause cloud sync ("Sync paused" with the operator's message; queued changes are kept and retried), and turning on cloud sync while registration is closed says so.
- **Invoice status and due-date tracking**: statuses draft / sent / paid / void with `sentAt` / `paidAt` dates and a derived *overdue* (sent and past its due date: local date in the app, UTC in the API). Shared transition rules (`shared/invoice-status.ts`) used by the app and the API. Invoices saved before this release (local and on the server) are drafts. Dashboard: status badges ("N days overdue"), row and invoice-page quick actions (mark sent, mark paid, void, reopen), filter chips with counts and a per-currency totals strip computed locally. New invoices: **Save Invoice** saves a draft, **Save & mark sent** marks it sent.
- **API / MCP**: invoice `status`, `sentAt`, `paidAt`, derived `isOverdue` / `daysOverdue`; `GET /invoices` filters `status` (incl. virtual `overdue`), `due_before`, `due_after`, `client`; `POST /invoices/:id/mark-sent|mark-paid|void|reopen` (with `If-Match`; 409 `invalid_status_transition`); `GET /invoices/summary` (per currency). MCP: filters on `list_invoices`, new `set_invoice_status` and `get_invoice_summary`. D1 migration `0002_invoice_status.sql`. Local invoice store version 2.
- **Cloud sync & agents in the app** (opt-in, Settings → Cloud sync & agents): creates an anonymous workspace and uploads local invoices and default settings; local-first sync engine with a persisted offline queue, delta pulls (on start, focus, reconnect and every 15 s), tombstones, revisions with `If-Match`, and a three-way merge on conflicts (server wins per conflicting field; the user is told); header sync status; recovery key to link another browser and "Connect existing workspace"; disconnect this browser; delete the cloud workspace (local copies kept).
- **Agent approval page** (`/agents/approve?code=…`): consent screen with the agent's name and description as plain text, anti-phishing guidance, per-permission checkboxes to narrow scopes, expiry countdown, approve/deny and clear states for unknown, expired, already decided and rate-limited codes.
- **Agents page** (`/agents`): connected and revoked agents with permissions and last use, revoke with confirmation, code entry, and copyable connection help (prompt, API base URL, MCP endpoint and client config).
- Invoices created or edited by agents show a "by / edited by <agent>" badge in the list and provenance on the invoice view.
- Typed API client (`src/lib/api`) and an in-memory API fake for tests.
- **Cloudflare hosting**: the app now runs as one Cloudflare Worker with static assets (`wrangler.jsonc`, `@cloudflare/vite-plugin`). SPA not-found handling keeps deep links working; `/api/*` always reaches the Worker. New scripts: `deploy`, `cf-typegen`, `db:migrate:local`, `db:migrate:remote`.
- **Agent API** (`/api/v1`, Hono on Workers + Cloudflare D1): anonymous workspaces with a one-time workspace token; RFC 8628-style agent registration (user code approval, scope narrowing, deny, expiry, one-time API key), agent listing and revocation; invoice CRUD with soft deletes, `updated_since` delta sync, revisions/ETags and `If-Match` preconditions, atomic invoice-number allocation, defaults from workspace settings, server-computed totals; settings; `createdBy`/`updatedBy` attribution; rate limiting (Workers Rate Limiting + D1 counters); OpenAPI 3.1 at `/api/v1/openapi.json`. See `AGENT_API.md`.
- **Remote MCP server** at `/api/mcp` (official MCP TypeScript SDK v2, stateless Streamable HTTP, JSON responses) with scope-filtered invoice tools.
- **Server-side PDFs** (`GET /api/v1/invoices/:id/pdf`) rendered in the Worker by the app's own `InvoicePDF` component.
- `public/llms.txt` pointing agents to the API.
- `typecheck` script and a GitHub Actions CI workflow (lint, typecheck, tests, build, `wrangler deploy --dry-run`).
- Vitest projects: `web` (jsdom), `server` (API against local D1 in workerd), `workerd` (production build in workerd).
- **Deploy workflow** (`.github/workflows/deploy.yml`): on push to `main` (after the CI checks) and on manual dispatch, applies remote D1 migrations and deploys with `cloudflare/wrangler-action`; skipped until the repository variable `CLOUDFLARE_DEPLOY` is `true`; needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets (setup in the README).

### Changed
- Saving an existing invoice keeps its original `createdAt` and its sync metadata.
- The dashboard tab is reflected in the URL (`/?tab=settings`); the "Cloud Sync" teaser left "Coming Soon".
- The service worker explicitly never caches `/api/*` (NetworkOnly).
- Agent user-code helpers moved to `shared/user-code.ts` (re-exported from `server/crypto.ts`).
- PDF fonts are declared once in `src/components/invoice/pdfFonts.ts` (used by the browser and the Worker).
- Invoice, settings and API types live in `shared/` (re-exported from the old `src/` paths); `Invoice` gained optional server fields (`updatedAt`, `deletedAt`, `revision`, `createdBy`, `updatedBy`).
- The service worker never serves the SPA shell for `/api/*` navigations.

### Fixed
- **PDF matches the invoice preview**: exported and API PDFs now use the preview's colours (dark by default, light when the app is in light mode; shared tokens in `src/components/invoice/invoiceTheme.ts`), its Noto Sans Mono faces at real Medium/SemiBold weights (embedded; no stray Helvetica), its sizes, spacing, dividers, column grid and line wrapping. `GET /api/v1/invoices/:id/pdf` and the MCP `get_invoice_pdf` tool accept an optional `theme` (`light`|`dark`).
- Text containing `&`, quotes or apostrophes no longer shows HTML entities (e.g. "Me &amp; Co") in the PDF or the preview.
- **Small screens (320–390 px)**: no page scrolls sideways any more. The dashboard header shows just the logo below 360 px and the tabs drop their icons (and the "Coming Soon" label) below `sm`; totals stack as rows; invoice rows put the name, badges and details full width with the amount and actions on one row, wrapping the details only between number, client and date. Line items in the editor put the description on its own row with labelled Qty and Price below, and the invoice details / From / Bill To / notes fields stack in one column. The invoice preview keeps its A4 layout and is scaled down as a whole to fit narrow screens and columns (CSS transform, unscaled when printing), so it stays a faithful picture of the PDF instead of overlapping columns.
- **Mobile headers**: the invoice page header no longer overflows at 390 px (or 320 px): below the `lg` breakpoint Download PDF is icon-only and Edit, Duplicate, Print and Delete move into a "More actions" menu. The editor's Download PDF, Duplicate, Save & mark sent and Save Invoice are icon-only below `lg`. All keep accessible names, and long titles truncate.
- **Theme on direct page loads**: reloading `/create`, `/invoice/:id` or an unknown URL no longer switches back to dark when light was chosen. The stored theme is applied before the first paint by an inline script in `index.html` (`<html class="dark">` stays the default for new visitors) and then by a root `next-themes` provider, so every route, the toaster and the PDF export (which follows the preview) agree. The theme toggle is now also on the invoice editor, the invoice page and the 404 page.
- **Non-Latin text in PDFs**: characters Noto Sans Mono lacks no longer print as empty boxes. Fallback faces (Noto Sans SC, KR, Arabic, Hebrew, Thai, Devanagari and Noto Emoji, SIL OFL 1.1, in `public/fonts/fallback/`) are fetched and registered only when an invoice contains such characters, in the browser and in the Worker; the preview uses the same faces (via `unicode-range`), so both look alike. Right-to-left text (Arabic, Hebrew) is shaped and ordered. Characters no bundled font covers (e.g. Bengali, Tamil, Georgian, rare Han characters) trigger a warning before the PDF is downloaded. Fonts used once are cached by the service worker for offline export.
- **PDF page breaks**: on long invoices the totals (or the whole line-item table) no longer jump to the next page when they fit: react-pdf counted each section's bottom margin as space needed ahead. Line items flow row by row (a row never splits), the table header repeats at the top of each continuation page, the totals block stays together, and a "Payment Details"/"Notes" label is never left alone at a page bottom.
- **Invoice name on the invoice**: the name you give an invoice (e.g. "Brand refresh — Q4") is printed under the invoice number again, identically in the preview and the PDF (nothing when empty). The playful dashboard label for unnamed invoices ("Cosmic Phoenix 42") is no longer stored as the invoice's name: it is derived from the invoice id, and labels stored by earlier versions are recognised by their shape, kept for the dashboard and never printed.
- **Saving validates**: "Save Invoice", "Save & mark sent" (nothing is marked sent while invalid) and "Download PDF" (which also saves) now checks the same rules the API enforces (`invoiceFormSchema`): field errors are shown, the first invalid field is focused, nothing typed is lost, and fixed fields clear their error as you type. Drafts are still auto-saved unvalidated. Invoices already stored invalid say exactly what to fix (the dashboard's "Not synced" badge names the fields and opens the editor, a notice with an "Edit to fix" link on the invoice page).

### Removed
- Vercel configuration (`vercel.json`, `VERCEL` check in the `prepare` script).
- Unused shadcn/ui components (skeleton, toggle, Radix toast), unused helpers (NavLink, use-mobile) and ~30 unused packages (react-hook-form, recharts, embla-carousel, react-day-picker, input-otp, vaul, unused Radix packages, lovable-tagger, etc.).
- Committed `.env` and `package-lock.json`.

### Fixed
- Infinite render loop ("Maximum update depth exceeded") that left the create invoice page blank.
- All lint errors and warnings.
- README inaccuracies (form library, PDF library, dev server port, project structure).

## [1.1.0] - 2025-12-13

### Added
- **Storage Versioning**: Implemented robust backward compatibility for local storage with schema migrations.
- **Development Experience**: Added "DEV" badge and custom favicon for development environment.
- **Git Hooks**: Added Husky pre-commit hooks to run tests automatically.

### Fixed
- **Settings**: Fixed missing banner in settings drawer.
- **Currency Selector**: Fixed display issues (clipping long names) and added fuzzy search.
- **Create Invoice**: Resolved black screen issue and form validation errors.
- **Tests**: Fixed failing tests in InvoiceList, InvoiceForm, and ViewInvoice.

### Changed
- **Dependencies**: Updated various dependencies.

## [1.0.0] - 2024-12-13

### Added
- **Core Invoice Features**
  - Create, edit, and duplicate invoices
  - Auto-save drafts to localStorage
  - Persistent invoice URLs
  - "Load Session" to restore previous work
  - PDF export with custom monospace font and selectable text

- **Multi-Currency Support**
  - Extensive currency list with fuzzy search
  - Currency symbol handling in forms and PDF

- **UI/UX**
  - Modern, dark-themed design using Tailwind CSS & shadcn/ui
  - Responsive layout for mobile and desktop
  - Settings drawer for defaults (tax, currency, sender details)
  - Input sanitization for security

- **PWA Support**
  - Offline support via Service Workers
  - Installable as a progressive web app
  - Custom app icons
