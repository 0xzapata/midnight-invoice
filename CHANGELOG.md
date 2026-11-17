# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-11-17

A major release: the app moves from Vercel to a single Cloudflare Worker and
gains an optional backend (cloud sync, an API and MCP server for AI agents,
email, recurring invoices, optional accounts and a private operator console).
With cloud sync off the app still works entirely in the browser, as before.

Upgrading from 1.x: local data (invoices, drafts, settings) is migrated in
place; invoices saved before statuses existed become **drafts**. Hosting needs
the Cloudflare setup in the README ("Deploy to Cloudflare"); the Vercel
configuration is gone.

### Invoices
- **Status and due dates**: draft / sent / paid / void with `sentAt` / `paidAt`
  and a derived *overdue* (sent and past its due date: local date in the app,
  UTC in the API), one set of transition rules for app and API
  (`shared/invoice-status.ts`). Status badges ("N days overdue"), quick actions
  in the row menu and on the invoice page (mark sent, mark paid, void, reopen),
  filter chips with counts, a per-currency totals strip, and **Save & mark
  sent** in the editor.
- **Saved clients** (`/clients`): list, search, add, edit, archive and delete,
  with default currency, tax rate and payment terms and private notes; a client
  picker on Bill To (fills the client's details and defaults without
  overwriting what you changed), "Save as client" / "Update client" / "Link
  client", one-click import from existing invoices. Invoices keep their own copy
  of the client's details plus an optional `clientId`.
- **Templates** (`/templates`): reusable invoices with line items, terms, notes
  and a default client; whitelisted placeholders (`{{month}}`,
  `{{month_name}}`, `{{prev_month_name}}`, `{{prev_month_year}}`, `{{year}}`,
  `{{quarter}}`, `{{client_name}}`, `{{invoice_number}}`) resolved for each
  invoice's issue date; "New from template" on the dashboard, "From template"
  (asks before replacing anything typed) and "Save as template" in the editor
  and on the invoice page. Invoices made from a template are independent drafts
  that record `templateId`.
- **Recurring invoices** (`/recurring`, needs cloud sync): schedules that create
  an invoice from a template every week, two weeks, month, quarter or year in
  your time zone, even when the browser is closed; as a draft, marked sent, or
  emailed to the client (user-only choice). Month-end clamping, DST-safe local
  run dates, exactly one invoice per period, catch-up of only the most recent
  missed period, failures shown on the schedule and retried with backoff, end
  date or number of invoices, pause / resume / run now, plain-language summary,
  upcoming dates and a preview of the next invoice; "Make recurring" from a
  template or an invoice; a *Recurring* badge and dashboard filter.
- **Send by email** (needs cloud sync and an email provider set up by the site
  operator): a dialog with recipient, "Send me a copy", subject and message,
  a preview, and the PDF attached; a draft is marked sent; the invoice page
  shows the email history.
- **Validation on save**: Save, Save & mark sent and Download PDF check the same
  rules as the API, show field errors and focus the first one; invoices stored
  invalid say exactly what to fix.
- Invoice names print under the invoice number; the playful dashboard label of
  unnamed invoices is derived from the id and never printed.
- Fixed: the dashboard's **Duplicate** opened an empty editor; every Duplicate
  now copies the invoice as a new draft (no status, sync data or template /
  schedule provenance).
- Fixed: an infinite render loop that left the create page blank.

### PDF
- The PDF matches the on-screen preview: same colours (dark by default, light
  when the app is light), the preview's Noto Sans Mono faces at their real
  weights (embedded), sizes, spacing and line wrapping.
- Clean page breaks on long invoices: rows never split, the table header
  repeats, totals stay together, labels are never orphaned.
- Non-Latin text: Chinese, Japanese, Korean, Arabic and Hebrew (right-to-left),
  Thai, Devanagari and emoji through fallback fonts loaded only when needed,
  with a warning for characters no bundled font covers.
- `&`, quotes and apostrophes no longer show as HTML entities.
- Server-side rendering of the same component (`GET /api/v1/invoices/:id/pdf`,
  MCP `get_invoice_pdf`), with `?theme=light|dark`.

### Cloud sync, accounts and the activity log
- **Cloud sync** (opt-in, Settings → *Cloud sync & agents*): an anonymous
  workspace with a recovery key; offline-first sync of invoices, clients,
  templates and settings (persisted queue, delta pulls on start, focus,
  reconnect and every 15 s, tombstones, revisions with `If-Match`, three-way
  merge on conflicts with a toast); header sync status; connect another browser
  with the recovery key; disconnect; delete the cloud workspace (local copies
  kept). With sync off the app makes no API requests.
- **Optional user accounts** (WorkOS AuthKit, when the operator enables them):
  sign up / sign in from Settings and the agent consent screens; claim the
  browser's anonymous workspace; connect new browsers without a recovery key,
  with an explicit choice when a browser has other local data (nothing is
  discarded or merged on the server); an Account page (`/account`) with devices
  (revoke, last synced), sign out other devices / everywhere, recovery key
  rotate / create / turn off and account deletion (with or without the
  workspace). Per-device workspace tokens; account management uses a separate
  HttpOnly cookie session with CSRF protection. Signed-out browsers explain why.
- **Activity log** (`/activity`, linked from the header, Agents and Settings):
  a day-grouped timeline of what your browsers, each agent and the system
  (recurring schedules) did, with filters by who, kind of action and dates, a
  History section on each invoice and each agent's latest actions on the Agents
  page. Entries hold field names, never values; retention 365 days / 10,000
  entries per workspace by default. "Sent again" now only marks invoices that
  were emailed before.
- Suspension and maintenance pause sync ("Sync paused" with the operator's
  message; queued changes are kept and retried).

### AI agents, API and MCP
- **Agent API** (`/api/v1`, Hono on Workers + D1): anonymous workspaces; an
  RFC 8628-style device flow (user code, scope narrowing, deny, expiry,
  one-time API key); agent listing and revocation; invoice, client, template
  and recurring-schedule CRUD with soft deletes, delta sync, revisions/ETags and
  `If-Match`; atomic invoice numbers; defaults from settings; server-computed
  totals; status endpoints and a per-currency summary; template instantiation;
  email sending with idempotency keys; activity reads; rate limiting; OpenAPI
  3.1 at `/api/v1/openapi.json`; `public/llms.txt`. See `AGENT_API.md`.
- **Scopes**: `invoices:read|write|delete`, `settings:read`,
  `clients:read|write`, `templates:read|write`, `activity:read` (own entries
  only), `invoices:send` (sensitive), `recurring:read|write`. New scopes are
  never added to existing agents.
- **Remote MCP server** (`/api/mcp`, official MCP TypeScript SDK v2, stateless
  Streamable HTTP) with scope-filtered tools for invoices, status, PDFs,
  clients, templates, recurring schedules, email and the agent's own activity.
- **OAuth for MCP clients** (MCP authorization spec 2026-07-28): paste the MCP
  URL into a client, approve on `/agents/authorize`, done. Protected-resource
  and authorization-server metadata, PKCE S256, resource indicators, `iss` in
  responses, dynamic client registration and Client ID Metadata Documents,
  1-hour access tokens (MCP only) and 30-day rotating refresh tokens with reuse
  detection, revocation.
- **Agent safety for email**: agents can only email the invoice's client
  address, only one the user entered themselves, and not while an agent has
  changed the sender or payment details since the user's last save; cooldown,
  per-workspace, per-agent and site-wide caps.
- App UI: consent screens (`/agents/approve`, `/agents/authorize`) that show
  agent-supplied text as plain text and only narrow permissions; an Agents page
  with connection help, permissions, last use and revoke; "by / edited by
  <agent>" badges.

### Operator console (`/operator`, private)
- First-run wizard unlocked by the `INITIAL_PASSWORD` secret (master key with a
  one-time recovery key, WorkOS credentials, operator account); afterwards
  operators sign in with WorkOS AuthKit (allowlist, CSRF-protected cookie
  sessions with timeouts and revocation).
- Overview, telemetry per part of the service (REST groups, MCP, sync, PDF,
  email, OAuth, accounts, recurring), workspaces / agents / accounts (metadata
  only) with suspend, delete, revoke and disable; runtime settings stored in D1
  with envelope encryption for secrets (optional hardened `ENCRYPTION_KEY`
  mode, key rotation and recovery); maintenance mode and registration
  switches; restart (reload runtime configuration) and redeploy (GitHub Actions
  `workflow_dispatch`); audit log. Fits phones without sideways scrolling.
- Scheduled jobs (Cron Triggers): telemetry and session housekeeping, OAuth
  pruning, account cleanup, activity retention and recurring generation.

### Hosting and tooling
- **Cloudflare Workers**: one Worker serves the SPA (static assets with SPA
  fallback) and the API (`wrangler.jsonc`, `@cloudflare/vite-plugin`, D1
  migrations `0001`–`0010`). Opt-in deploy workflow
  (`.github/workflows/deploy.yml`) and a CI workflow (lint, typecheck, tests,
  build, `wrangler deploy --dry-run`). `bun run dev:operator` runs everything
  locally against the WorkOS emulator.
- **Dependencies** on current majors: React 19, React Router 8 (replaces
  `react-router-dom`), Tailwind CSS 4 (CSS-first config, `tw-animate-css`),
  Vite 8, Vitest 5, TypeScript 6, ESLint 10, Zod 4, date-fns 4, lucide-react 1,
  Sonner 2 and more; `@vitejs/plugin-react`; text `bun.lock`; Node.js 22.22+.
- Vitest projects `web` (jsdom), `server` (API against local D1 in workerd) and
  `workerd` (the production bundle in workerd).
- No `.env` is needed (`VITE_APP_NAME` defaults to "Midnight Invoice").
- The service worker never caches `/api/*`; app pages forbid framing.

### UI
- Small screens (320–390 px): no page scrolls sideways; compact headers with a
  "More actions" menu; the invoice preview scales as a whole.
- The header links to Clients, Templates, Recurring, Agents and Activity (one
  "Pages" menu on phones).
- The chosen theme is applied before the first paint on every route; the theme
  toggle is on every page.

### Removed
- Vercel configuration; unused shadcn/ui components, helpers and ~30 unused
  packages; the committed `.env` and `package-lock.json`.

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
