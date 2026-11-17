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
  address, only one the user entered themselves, and only invoices whose sender
  name, email and payment details are the user's own or approved by the user
  ("Needs your review"); caps per workspace, agent, IP and site (see Security).
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
  migrations `0001`–`0011`). Opt-in deploy workflow
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

### Security
Fixes from an independent security review (regression tests in
`server/security-review.test.ts` and next to the code they cover):
- **Sender review by value** (H1): an agent (or a recurring email) can only
  send an invoice whose sender name, email and payment details equal the
  settings or values the user entered or approved, however the invoice came to
  exist — an agent can no longer launder its own payment details through a
  template and a recurring schedule's "run now" (migration `0011`,
  `sender_approved_values`).
- **"Needs your review"** (L2): a user save that merely carries an agent's
  value (the app's full-document sync, "mark paid", a 412 merge) no longer
  confirms an agent-written address or approves its payment details; only
  typing the value or the explicit review does. New: `GET /api/v1/reviews`,
  `POST /api/v1/invoices/:id/review`, `POST /api/v1/clients/:id/review`
  (workspace token, `If-Match`), a banner on the invoice page (old → new) and
  "Confirm address" on the Clients page; activity `invoice.reviewed`,
  `client.reviewed`.
- **Recurring emails send what you approved** (M1): when an agent changed the
  template, the client's email or the generated invoice after you set up
  automatic emailing, the email is held (`email_needs_review`, invoice stays a
  draft) until you re-approve on the Recurring page
  (`POST /recurring/:id/approve-email`, activity `recurring.email_approved`).
  Your own edits need no re-approval.
- **No anonymous email relay** (M2): new operator setting
  `email.requireAccount` (**on by default**): only workspaces owned by a
  signed-in account may send (`403 account_required_for_email`; needs user
  accounts on). Caps count recipients (to + cc); new per-IP hourly limit,
  lower daily cap for new workspaces, 20% of the site cap kept for recurring
  emails; the sender display name drops deceptive characters and is capped at
  60 characters; the console says who can send and warns when a few
  workspaces could use up the site cap.
- **Telemetry** (M3): MCP metric names only from known methods and (for
  authenticated requests) defined tool names; a cap on distinct metrics per
  flush; unauthenticated `POST /api/mcp` is rate limited.
- **Idempotency keys** (L1): server keys use the reserved prefix `internal:`;
  client keys with it are refused (400).
- **Suspended workspaces** (L3): account routes that change the workspace
  (delete, recovery key, connect, claim) refuse while it is suspended.
- **Operator secret** (L4): `INITIAL_PASSWORD` must have at least 24
  characters (else the console stays off); the KEK uses 600,000 PBKDF2
  iterations (existing wraps are upgraded on unlock).
- **Lockout** (L5): attempt counters are atomic; the global bootstrap /
  recovery lock is replaced by a growing delay, so nobody can lock the
  operator out (per-IP lockout unchanged).
- **Content-Security-Policy** (L6) and `Referrer-Policy`,
  `Permissions-Policy`, `X-Content-Type-Options` on the app; API responses
  carry `default-src 'none'`.
- `github.apiUrl` only accepts GitHub / GitHub Enterprise Server API URLs and
  clears the token when changed; GitHub Actions are pinned to commit SHAs;
  revoking an agent pauses the recurring schedules it set up; per-workspace
  storage limits (`limits.*`, `409 limit_reached`).

Upgrade notes: set `INITIAL_PASSWORD` to 24+ characters before deploying;
turn on user accounts (or explicitly turn `email.requireAccount` off) to keep
sending email; agents whose sends now return `invoice_needs_review` need the
user to approve the invoice once.

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
