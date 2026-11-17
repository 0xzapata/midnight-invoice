# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Dependencies**: Upgraded to current major versions: React 19.3, React Router 8 (replaces `react-router-dom` 6), Tailwind CSS 4, Vite 8, Vitest 5, TypeScript 6.0, ESLint 10, Zod 4, date-fns 4, lucide-react 1, Sonner 2, tailwind-merge 3, next-themes 0.4, vite-plugin-pwa 2, jsdom 31 and more.
- **Tailwind CSS 4**: CSS-first configuration in `src/index.css` via `@tailwindcss/vite`; removed `tailwind.config.ts`, `postcss.config.js` and autoprefixer; `tailwindcss-animate` replaced by `tw-animate-css`. Compatibility rules keep the UI visually unchanged.
- **Tooling**: Switched to `@vitejs/plugin-react`; lockfile migrated to the text `bun.lock`; husky is now a dev dependency; Node.js 22.22+ is required.
- **Environment**: No `.env` file is needed; `VITE_APP_NAME` defaults to "Midnight Invoice". `.env.example` documents both variables.

### Added
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
- **Mobile headers**: the invoice page header no longer overflows at 390 px (or 320 px): below the `lg` breakpoint Download PDF is icon-only and Edit, Duplicate, Print and Delete move into a "More actions" menu. The editor's Download PDF, Duplicate and Save Invoice are icon-only below `md`. All keep accessible names, and long titles truncate.
- **Theme on direct page loads**: reloading `/create`, `/invoice/:id` or an unknown URL no longer switches back to dark when light was chosen. The stored theme is applied before the first paint by an inline script in `index.html` (`<html class="dark">` stays the default for new visitors) and then by a root `next-themes` provider, so every route, the toaster and the PDF export (which follows the preview) agree. The theme toggle is now also on the invoice editor, the invoice page and the 404 page.
- **Non-Latin text in PDFs**: characters Noto Sans Mono lacks no longer print as empty boxes. Fallback faces (Noto Sans SC, KR, Arabic, Hebrew, Thai, Devanagari and Noto Emoji, SIL OFL 1.1, in `public/fonts/fallback/`) are fetched and registered only when an invoice contains such characters, in the browser and in the Worker; the preview uses the same faces (via `unicode-range`), so both look alike. Right-to-left text (Arabic, Hebrew) is shaped and ordered. Characters no bundled font covers (e.g. Bengali, Tamil, Georgian, rare Han characters) trigger a warning before the PDF is downloaded. Fonts used once are cached by the service worker for offline export.
- **PDF page breaks**: on long invoices the totals (or the whole line-item table) no longer jump to the next page when they fit: react-pdf counted each section's bottom margin as space needed ahead. Line items flow row by row (a row never splits), the table header repeats at the top of each continuation page, the totals block stays together, and a "Payment Details"/"Notes" label is never left alone at a page bottom.
- **Invoice name on the invoice**: the name you give an invoice (e.g. "Brand refresh — Q4") is printed under the invoice number again, identically in the preview and the PDF (nothing when empty). The playful dashboard label for unnamed invoices ("Cosmic Phoenix 42") is no longer stored as the invoice's name: it is derived from the invoice id, and labels stored by earlier versions are recognised by their shape, kept for the dashboard and never printed.
- **Saving validates**: "Save Invoice" (and "Download PDF", which also saves) now checks the same rules the API enforces (`invoiceFormSchema`): field errors are shown, the first invalid field is focused, nothing typed is lost, and fixed fields clear their error as you type. Drafts are still auto-saved unvalidated. Invoices already stored invalid say exactly what to fix (the dashboard's "Not synced" badge names the fields and opens the editor, a notice with an "Edit to fix" link on the invoice page).

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
