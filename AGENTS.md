# Agent Guide

This documentation is intended for AI agents working on the Midnight Invoice project. It provides an overview of the architecture, key files, and development workflows.

## Project Overview

Midnight Invoice is a modern invoice generator built with React 19, Vite, and TypeScript. It features a dark-themed UI, offline support via local storage, and PDF export capabilities. It is hosted as a single Cloudflare Worker (static assets + API) and has an API so AI agents can work with a user's invoices after the user approves them (see `AGENT_API.md`).

## Tech Stack

- **Framework**: React 19
- **Build Tool**: Vite 8 (`@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-plugin-pwa`)
- **Language**: TypeScript 6 (not `strict`; held below 7 until typescript-eslint supports it)
- **Styling**: Tailwind CSS 4, configured CSS-first in `src/index.css` (no `tailwind.config.*`), animations via `tw-animate-css`
- **Components**: shadcn/ui (Radix UI), icons from `lucide-react`
- **State Management**: Zustand (with persist middleware)
- **Forms**: TanStack Form + Zod 4
- **PDF Generation**: @react-pdf/renderer
- **Routing**: `react-router` 8 in declarative mode (`BrowserRouter`/`Routes`); import from `react-router`, not `react-router-dom`
- **Testing**: Vitest projects: `web` (React Testing Library, jsdom), `server` (API against local D1 in workerd), `workerd` (built bundle in workerd)
- **Hosting**: Cloudflare Workers + static assets, `@cloudflare/vite-plugin`, config in `wrangler.jsonc`
- **API**: Hono, Cloudflare D1 (SQLite), Zod 4, MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)
- **Linting**: ESLint 10 flat config + typescript-eslint + react-hooks 7

## Architecture

### State Management
State is managed using Zustand stores located in `src/stores/`.
- `useInvoiceStore.ts`: Manages the list of saved invoices. Status changes go through `setInvoiceStatus` (shared transition rules); `saveInvoice` never changes the status of an existing invoice (new ones are drafts unless `options.status`).
- `useSettingsStore.ts`: Manages default invoice settings (from address, currency, etc.).
- `useClientStore.ts`: saved clients (address book), persisted as `client-storage` (version + `migrateClientStore`). Local-first and works without cloud sync; user edits are reported with `emitLocalChange`. Helpers: `activeClientsSorted`, `invoicesForClient` (by `clientId`, or name+email for older unlinked invoices), `importFromInvoices` (dedupe by `clientDedupeKey`).
- `useTemplateStore.ts`: invoice templates, persisted as `template-storage` (version + `migrateTemplateStore`). Local-first like clients; user edits are reported with `emitLocalChange`. Helpers: `activeTemplatesSorted`, `templateDataFromInvoice` ("Save as template").
- `useCloudStore.ts`: opt-in cloud sync state: workspace, workspace token (the "recovery key"), one delta cursor per synced collection (`cursors`), the pending-change queue (entries carry `collection` + `entityId`), merge bases and sync errors keyed by `syncKey(collection, id)` (bare id for invoices), plus runtime status for the header. Persisted as `cloud-sync-storage` (version 2 + `migrateCloudStore`, which converts version 1 data).
- All stores use `persist` middleware to save data to `localStorage`. Invoices and clients stay local-first: their stores are the source of truth the UI reads; the sync engine mirrors them with the server.

### Clients
- `Client` (`shared/types/client.ts`): name, email, address, optional defaults (`defaultCurrency`, `defaultTaxRate`, `paymentTermsDays`), private `notes`, `archivedAt`. Invoices keep their own snapshot of `toName/toAddress/toEmail` plus an optional `clientId`; editing or deleting a client never rewrites invoices.
- Fill rules (UI `src/components/clients/clientFill.ts`, API `server/services/invoiceClients.ts`): the client's name/address/email fill Bill To; currency/tax rate/due date come from the client's defaults before workspace settings, and in the form only when the user has not changed those fields.
- UI: `/clients` (`src/pages/Clients.tsx`), `ClientFormDialog`, and in `InvoiceForm` the `ClientPicker` (Bill To header) and `ClientLinkStatus` (Save as client / Update client / Link client).

### Templates
- `InvoiceTemplate` (`shared/types/template.ts`): name, description, optional default `clientId`, line items, `taxRate`/`currency`/`paymentTermsDays` (null = not set), `notes`/`paymentDetails`/`invoiceNamePattern` ("" = not set), `archivedAt`. An invoice created from a template is an independent snapshot with an optional `templateId` (a plain reference: never validated against the templates table, synced as invoice content).
- Placeholders: `shared/template-placeholders.ts` (`resolvePlaceholders`, strict whitelist, evaluated against an explicit issue date; unknown/unresolved names stay visible and are reported) is the only implementation; `invoiceFieldsFromTemplate` (`shared/types/template.ts`) turns a template into invoice fields for both the app and the API. Reuse both for a future "recurring invoices" feature.
- Precedence everywhere: explicit value (request field / what the user typed) → template → client defaults → workspace settings. API: `server/services/templates.ts` (`instantiateTemplate`, `POST /templates/:id/instantiate`); UI: `src/components/templates/templateApply.ts` (`newInvoiceDraftFromTemplate`, `templateFormPatch` with `replace`/`merge`; the form only applies directly when `isPristineForTemplate`, otherwise it asks).
- UI: `/templates` (`src/pages/Templates.tsx`), `TemplateFormDialog` (line editor, placeholder helper with live preview), `TemplateControls.tsx` (`TemplatePicker`, `SaveAsTemplateButton`, `InvoiceTemplateBar` at the top of `InvoiceForm`), `useSaveAsTemplate` (dialog + toast action to /templates; also in the ViewInvoice "More actions" menu below `lg`), `NewFromTemplateButton` on the dashboard; the dashboard header nav is `src/components/HeaderNav.tsx` (one "Pages" menu below `sm`). Operator: template counts only in stats, telemetry group "Templates".
- Server: migration `0005_templates.sql`, `server/db/templateRepository.ts`, `server/templateSchemas.ts`, `server/routes/templates.ts`, `server/mcpTemplates.ts`, `server/openapiTemplates.ts`.

### Cloud sync (opt-in) and agents
- Off by default: with no workspace token the app makes no API calls and behaves as a purely local app.
- `src/lib/api/`: typed client for `/api/v1` (same origin only). The token goes only in the `Authorization` header; never put it in URLs, logs, errors or toasts. A 401 for the stored token calls `leaveWorkspace('token_rejected')` (local data kept). `ApiError` carries `status/code/details/retryAfterMs`; `NetworkError` = offline/unreachable.
- `src/lib/sync/engine.ts`: the collection-agnostic sync engine (contract: AGENT_API.md "Sync semantics"). Each synced collection is a descriptor (`src/lib/sync/collection.ts`, registered in `src/lib/sync/collections/`). A cycle pulls every collection in dependency order (`SYNCED_COLLECTIONS`: clients, templates, invoices) with `GET /<collection>?include_deleted=true&updated_since=<cursor>` (pages via `next`, that collection's cursor = `syncedAt` only after its last page, items applied idempotently by id, tombstones delete local copies) and then flushes the single queue in order (`PUT` with `If-Match` / `If-None-Match: *`, `DELETE` with `If-Match`, `PUT /settings`). Before an upload, pending uploads of the entities its descriptor's `dependencies()` lists (an invoice's client) are moved ahead of it; a reference to a client that no longer exists locally is left out of the invoice upload. Transient errors (offline, 5xx, 429, 409) stop the queue with backoff / `Retry-After`; permanent ones (400…) drop the entry and mark the invoice "Not synced". `410` drops the local copy. `412` → GET + three-way merge against the last agreed version (`mergeContent` in `fields.ts`): fields changed only locally win, fields changed only on the server win, fields changed on both keep the **server** value; the user gets a toast either way. A `412` on delete restores the newer server copy.
- Operator policy in the engine: 403 `workspace_suspended` and 503 `maintenance` (`ApiError.pause`) put sync in the `paused` status with the server's message; the queue is kept (no attempt counted, nothing marked "Not synced") and retried after `Retry-After` / 60 s (maintenance) or 5 min (suspension). 403 `registration_closed` on enable is explained by `describeError`.
- Local edits reach the engine through `src/lib/sync/localChanges.ts` (`emitLocalChange`, called by the stores' save/archive/delete actions); changes applied from the server use `setState` directly (through the descriptor) so they are never echoed back. Drafts are never synced.
- `src/components/sync/CloudSyncRuntime.tsx` (mounted in `App.tsx`) triggers cycles on start, focus, `online`, and every 15 s while visible. `cloudActions.ts`: enable (create workspace + upload settings, clients, invoices), connect with a recovery key (validated via `GET /workspace`), disconnect, delete workspace.
- Agent-facing UI: `/agents/approve` (consent screen, never auto-approves; agent-supplied text is rendered as plain text), `/agents/authorize` (OAuth consent for MCP clients, `src/pages/oauth/`) and `/agents` (list/revoke, connection help, each agent's latest activity). Server state there uses react-query (`['agents']`, `['agent-registration', code]`, `['oauth-request', id]`, `['activity', …]`).
- OAuth for MCP (`server/oauth/*`, `shared/oauth.ts`, migration `0008_oauth.sql`): the Worker is also the authorization server (metadata under `/.well-known/oauth-*`, endpoints under `/api/oauth/*`, consent API under `/api/v1/oauth/requests/*`). Approved clients are rows in `agents` linked through `oauth_agents`; access tokens (`mi_at_`) are accepted only by `POST /api/mcp` (`mcpAuth` in `server/oauth/routes.ts`) and are audience-bound to it. "Who is the user" for consent is `server/oauth/identity.ts` + `src/pages/oauth/consent.ts` (today the workspace token). `/.well-known/oauth-*` is in `run_worker_first`; `public/_headers` forbids framing.
  - Activity log: consent decisions (`agent.oauth_authorized` / `agent.oauth_denied`, actor = user), the code exchange (`agent.oauth_connected` or, on a re-authorisation that changed scopes, `agent.oauth_scopes_changed`, actor = the agent) and reuse detection (`agent.oauth_reuse_detected`, actor = system) are recorded with `recordActivity` right after the OAuth repository write succeeds (awaited; those writes are batches of their own, not `WriteAttachment` writes). Revocation and MCP tool calls go through the existing paths (`agent.revoked`, tool attribution). Never tokens, codes, request ids or redirect URIs.
  - Operator integration: the operator hook's suspension check matches workspace tokens and agent keys by hash only, so OAuth access tokens, refresh and code exchange check `workspace_suspended` themselves (in `lookupToken` / `isWorkspaceSuspended`). Maintenance answers on `/api/oauth/*` come from `server/oauth/policy.ts` (OAuth error shape; `/authorize` redirects to the consent page's error view); discovery documents are outside `/api/*` and stay up. Tunables are `oauth.*` settings (token lifetimes, DCR on/off, CIMD on/off, unused-registration lifetime) read through `oauthTunables(deps)`; the hourly `oauth.prune` job (`server/oauth/jobs.ts`) prunes expired requests/codes/tokens, unused registrations and dead grants. Telemetry: the OAuth routes add fixed labels/error codes with `setTelemetryDetail` (grant type, authorize outcome); never ids or names.
- Activity UI (`src/components/activity/`): `describe.ts` turns entries into sentences (unknown action codes get a generic sentence — add a `case` for new codes), `ActivityTimeline` (day groups, actor chips, links to entities that still exist locally, "(deleted)" otherwise), `InvoiceHistory` (invoice page; hidden while sync is off), `AgentActivityPreview`, `useActivity.ts` (react-query, refreshed after each sync cycle). `enqueueAllLocal` tags its uploads with one batch id (`X-Midnight-Sync: bulk-upload; batch=<uuid>`) so the server logs one summary entry.
- Invoice status: `shared/invoice-status.ts` is the single source of the rules (statuses, transitions, derived overdue, per-currency summary), used by the store, the UI (`src/components/invoice/status/`) and the server (`server/services/invoiceStatus.ts`, `statusFields.ts`, `server/routes/invoiceStatus.ts`, `server/mcpStatusTools.ts`). Missing status = `draft` everywhere. "Today" is the local date in the browser and the UTC date on the server. For the three-way merge, status + `sentAt` + `paidAt` is one field. Migration `0002_invoice_status.sql` exposes status/due date/client as virtual generated columns over the invoice JSON.
- Tests use `src/test/fakeApi.ts` (an in-memory implementation of the API) with `vi.stubGlobal('fetch', fake.fetch)`.

### Theme
Light/dark is the `dark` class on `<html>`, stored in `localStorage['theme']` (`src/lib/theme.ts`). `index.html` applies it before the first paint (dark when nothing is stored); `AppThemeProvider` (next-themes, mounted at the root of `App.tsx`) takes over, and `ThemeToggle` / the toaster read it with `useTheme()`. Do not toggle classes by hand. The PDF follows the preview via `resolveDocumentInvoiceTheme`.

### Operator console (`/operator`, `/api/operator/*`)
Private back-office for the site owner. Server code lives in `server/operator/` (mounted by the single `installOperator(app, deps, repo)` line in `server/app.ts`), the SPA in `src/operator/` (lazy chunk loaded from `src/main.tsx` only for `/operator/*`, kept out of the PWA precache), private types in `shared/operator.ts`, schema in `migrations/0004_operator.sql`. Operator routes are excluded from `openapi.json`/AGENT_API.md (tested in `server/openapi.test.ts`).
- **Auth** (`auth.ts`, `routes.ts`): `INITIAL_PASSWORD` (Worker secret; unset → 503 `operator_not_configured`) only unlocks a 30-min *setup* session for the wizard; the bootstrap login is disabled for good once `operator_state.bootstrap_completed_at` is set. Operators sign in with WorkOS AuthKit (`workos.ts`, a small fetch client; PKCE S256 + single-use `state` in D1 + a browser-binding nonce cookie). Sessions: `__Secure-mi_op_session` (Path=/api/operator, HttpOnly, Secure, SameSite=Strict), random id stored as SHA-256, HMAC-signed (setup: key from INITIAL_PASSWORD via HKDF; full: `operator.sessionSigningKey` from the encrypted store), idle + absolute timeouts, revocable. State-changing requests need `x-csrf-token` + same origin. Requests with an `Authorization` header are refused; the public API never reads the cookie. Allowlist in `operators` (bind by WorkOS user id, invite by verified email; the last one cannot be removed). Bootstrap/recovery attempts are locked out with backoff in `operator_login_attempts`.
- **Settings registry** (`settings-registry.ts`): every runtime setting is declared once (`setting.boolean/integer/string/url/enum/secret`, with group, label, description, default, validation, optional `envVar` fallback). Read with `deps.settings.get('area.key')` (sync, typed) or `await deps.settings.getSecret('area.key')`. `deps.settings` (`settings.ts`) keeps a per-isolate snapshot refreshed at most every 5 s by the request hook and immediately in the writing isolate; `deps.config` is a view over it, so existing handlers read runtime values without changes (resolution: D1 → deps/wrangler config → default). Writes go through `settings.set()` (validation, encryption for secrets, audit, config-version bump).
- **Encryption at rest** (`keystore.ts`, `crypto.ts`): master key (random or PBKDF2-600k passphrase) → DEK → AES-256-GCM per secret (AAD = key|version|dekVersion). MK is stored wrapped under PBKDF2-SHA-256(INITIAL_PASSWORD, 100k) ("wrapped" mode) or only in the `ENCRYPTION_KEY` secret ("env"/hardened mode), identified by a key check value. Any GCM failure → store "locked" (fail closed, no rewrite); `POST /api/operator/recover` restores with the recovery key. Rotation: DEK, master key (pending in env mode), INITIAL_PASSWORD re-wrap (pending until the new secret is seen).
- **Request hook** (`hooks.ts`, mounted on `/api/*`): refreshes settings, applies maintenance mode (503 `maintenance`), closed registration (403 `registration_closed`) and suspension (403 `workspace_suspended`, by SHA-256 of the bearer token against an in-memory set) without extra D1 queries, then records telemetry.
- **Telemetry** (`telemetry.ts`): per-isolate aggregation (minute + hour buckets per `service|route template` with status classes, duration sum and a 10-bucket histogram, plus capped recent errors and throttled `workspace_activity`), flushed to D1 in one batch via `waitUntil` (coalesced over 2 s). Failures are logged and dropped; telemetry never fails a request. No ids, bodies, tokens or IPs.
- **Scheduled jobs** (`server/scheduled.ts`): `scheduled()` in `worker/index.ts` runs `JOBS` whose `cron` matches the fired trigger; each cron must be listed in `wrangler.jsonc` `triggers.crons` (tested). Add a job by exporting a `ScheduledJob` and appending it to `JOBS`; jobs must be idempotent.
- **Data access**: operator SQL lives in `server/operator/db.ts` (same rules as `server/db/repository.ts`). Workspace/agent views return metadata only, never invoice data.
- **Deployments**: Redeploy dispatches the GitHub Actions deploy workflow (`github.ts`, token in encrypted settings); Restart bumps `operator_state.config_version`. Build info comes from the `__MI_BUILD_INFO__` define, version info from the `CF_VERSION_METADATA` binding.
- **Local dev**: `bun run dev:operator` = `workos dev` (WorkOS CLI emulator, seed `dev/workos-emulate.yaml`) + Vite; `WORKOS_API_BASE_URL` is passed to the Worker only under the Vite dev server (`__MI_DEV_SERVER__`). Tests fake WorkOS/GitHub at the fetch boundary (`server/test/operator.ts`).

### Routing
Routes are defined in `src/App.tsx`.
- `/`: Dashboard (`src/pages/Index.tsx`)
- `/create`: Create new invoice (`src/pages/CreateInvoice.tsx`)
- `/create/:id`: Edit existing invoice or draft
- `/invoice/:id`: View saved invoice (`src/pages/ViewInvoice.tsx`)
- `/?tab=settings`: Dashboard settings tab, including "Cloud sync & agents"
- `/agents`: Connected agents and how to connect one (`src/pages/Agents.tsx`)
- `/agents/approve?code=XXXX-XXXX`: Approve or deny an agent (`src/pages/ApproveAgent.tsx`)
- `/agents/authorize?request=…`: OAuth consent for MCP clients (`src/pages/oauth/AuthorizeAgent.tsx`)
- `/clients`: Saved clients (`src/pages/Clients.tsx`)
- `/templates`: Invoice templates (`src/pages/Templates.tsx`)
- `/activity`: Activity log (`src/pages/Activity.tsx`; filters in the URL: `?agent=<id>|you&group=…&from=…&to=…`)
- `/operator/*`: private operator console (`src/operator/`, rendered by `src/main.tsx` instead of `App`)

### Backend (Cloudflare Worker)
- `worker/index.ts`: thin Worker entry. Builds `AppDeps` from the env (`DB`, `ASSETS`, `RATE_LIMIT_*`, `APP_URL`) and hands `/api/*` and `/.well-known/*` to the Hono app. Static assets and SPA fallback are handled by the assets layer (`run_worker_first`: `/api/*` and the OAuth discovery paths).
- `server/app.ts`: `createApp(deps)` with all routes; tests call `app.request()`.
- `server/deps.ts`: injectable deps (db, clock, id/secret generators, rate limiters, asset reader, config).
- `server/db/repository.ts` (+ per-collection `server/db/clientRepository.ts`): the only places with SQL for the public API (operator-console SQL is in `server/operator/db.ts`). Every query is parameterised and scoped by `workspace_id`; atomic steps are single statements or `db.batch()`. `invoices.client_id` is a generated column over `data.clientId` (migration 0003), so invoice writes need no change for it.
- `server/services/`: invoice, client and agent use-cases shared by REST and MCP. `invoiceClients.ts` validates `clientId` and fills invoice fields from the client. Client routes live in `server/routes/clients.ts`, MCP client tools in `server/mcpClients.ts`, OpenAPI fragments in `server/openapiClients.ts`. `server/auth.ts`: Bearer auth (`mi_ws_` workspace token / `mi_agent_` agent key, looked up by SHA-256) and scopes.
- `server/mcp.ts`: MCP server per request (official SDK v2); tools are registered only for granted scopes (the `tool` helper also sets `ctx.activity.tool` so activity entries name the tool). Scopes: `invoices:read|write|delete`, `settings:read`, `clients:read|write`, `templates:read|write` (write includes delete), `activity:read` (an agent's own activity only); a new scope is never added to existing agents.
- `server/openapi.ts`: OpenAPI 3.1; `server/openapi.test.ts` fails if routes and docs drift. Update it, `shared/api.ts` and `AGENT_API.md` together when changing the API.
- `server/pdf/render.tsx`: renders `InvoicePDF` in the Worker. `server/pdf/vite-plugin-react-pdf-workerd.ts` makes react-pdf run in workerd (browser builds, precompiled yoga wasm, pdfkit `import.meta.url`).
- `migrations/`: D1 schema. Add a new numbered file for every change; never edit applied migrations.
- `shared/`: code and types used by both the browser app and the Worker (keep it free of browser- or Node-only APIs).

### Activity log (recording what happened)
Migration `0006_activity.sql`; contract `shared/activity.ts`; code `server/services/activity.ts` (+ `server/db/activityRepository.ts`, `server/routes/activity.ts`, `server/mcpActivity.ts`). Every mutating use-case records exactly one entry; reads, no-op writes (nothing changed, repeated status, deleting a tombstone, revoking twice) record none. Entries hold field *names*, a status from→to, scopes or counts — never bodies, values or secrets.
- **Atomic (preferred for writes)**: pass `activityWrite(ctx, input)` as the last argument of the repository write (`WriteAttachment`). The INSERT runs in the same `db.batch()` after the write, guarded by `changes() > 0`; if the batch fails the write is retried alone and `deps.logError` is called, so logging never fails a request. Repository writes take `also?: WriteAttachment` and use `firstWith(db, stmt, also)`.
- **After the fact**: `recordActivity(ctx, input)` (scheduled with `waitUntil`, never rejects) for things with no write to attach to (PDF downloads, rejected revoked keys).
- `ctx` is a `ServiceContext` (its `activity` = source `rest|mcp`, tool, request id, bulk-upload id, `waitUntil`, built in `server/app.ts` / `server/mcp.ts`); the actor defaults to the principal. Helpers: `changedFields`, `invoiceChangedInput`, `clientChangedInput`, `labelOf.*` (label snapshot in SQL), `dedupe` (`ignore` = once per key, `count` = bump `changes.counts`).
- Action codes are `<entity>.<verb>`; add them to `ACTIVITY_ACTIONS`, a sentence in `src/components/activity/describe.ts`, optionally an `ACTIVITY_ACTION_GROUPS` entry, and AGENT_API.md. Example for a new collection:
```ts
// server/services/templates.ts
const row = await templateRepo(ctx).updateTemplate(
  { workspaceId: ctx.principal.workspaceId, id, data, actor: actorOf(ctx.principal) },
  activityWriteIf(ctx, changedFields(before, data).length
    ? { action: 'template.updated', entity: { type: 'template', id, label: data.name }, changes: { fields: changedFields(before, data) } }
    : null),
);
// No write to attach to (e.g. an email was sent):
void recordActivity(ctx, { action: 'invoice.emailed', entity: { type: 'invoice', id, label: invoice.invoiceNumber } });
```
- Retention: the daily `activity.retention` job (`server/activityJobs.ts`, cron `43 3 * * *` in `server/scheduled.ts` + wrangler.jsonc) deletes entries older than the operator setting `activity.retentionDays` and all but the newest `activity.maxRowsPerWorkspace` per workspace (defaults `ACTIVITY_RETENTION`: 365 days / 10,000). Nothing is pruned on write. `deleteWorkspace` (also used by the operator console) deletes the workspace's activity; suspension keeps it.
- Templates: `template.created|updated|archived|unarchived|deleted` (helpers `templateCreatedInput` / `templateChangedInput`, `labelOf.template`, attached atomically like clients); an invoice made from a template (instantiate, or a sync PUT carrying `templateId`) records one `invoice.created` with `changes.template = {id, label}` (`createInvoice(ctx, body, { fromTemplate })`); bulk uploads count `templates`. The timeline links template entries to `/templates` while the template exists locally.
- Operator console: workspaces show an activity *count* only (entries name invoices and clients; the privacy test in `server/operator/dashboard.test.ts` checks this). `/activity` routes are the "Activity log" telemetry group.
- Agents: `agent.registered` carries `changes.registrationId`, which links the user's `agent.approved` entry (recorded before the agent id existed) into the agent's view (`agent_id=` filter, `/agents/:id/activity`).

### Adding a synced collection
Example: invoice templates (`src/lib/sync/collections/templates.ts`), added this way with no engine change. The engine itself needs no changes.
1. **Server**: a new numbered migration (table with `workspace_id, id, data, revision, created_at, updated_at, deleted_at, created_by, updated_by`, sync index on `(workspace_id, updated_at, id)`), a repository file, a service with the same contract as `server/services/clients.ts` (list feed with `updated_since`/`after_id`/`include_deleted`, PUT create-or-replace with `If-Match`/`If-None-Match: *`, PATCH, soft DELETE, 410 for tombstones), routes, scopes in `shared/api.ts` (`SCOPES`, `SCOPE_DESCRIPTIONS`) and `src/components/agents/scopes.ts`, OpenAPI, MCP tools, AGENT_API.md, the `deleteWorkspace` batch, and activity entries for its writes (see above).
2. **Types and store**: shared types, a persisted Zustand store with a version + migration in `src/lib/storageMigrations.ts`, whose user actions call `emitLocalChange({ collection, type, id[, entity] })`.
3. **Descriptor**: add the name to `SYNCED_COLLECTIONS` in `src/lib/sync/collectionNames.ts` *after* every collection it references (that is the pull and initial-upload order), write `src/lib/sync/collections/<name>.ts` implementing `SyncCollection` (store access that bypasses the emitter incl. `setAll`, `listPage`/`fetchOne`/`put`/`remove` via new methods in `src/lib/api/client.ts`, `contentOf`/`contentEquals`/`merge` (use `mergeFields`), `fromServer`, `withContent`, `withoutServerState`, optional `dependencies`/`uploadOrder`), and register it in `src/lib/sync/collections/index.ts`. Its `bases`/`syncErrors` entries are keyed by `syncKey(name, id)`; no cloud-store migration is needed.
4. **Tests**: extend `src/test/fakeApi.ts` with the routes (the engine pulls every registered collection, so the fake must answer them) and add sync tests like `src/lib/sync/clients.sync.test.ts`.

### Components
- `src/components/invoice/`: Core business logic components (Form, Preview, PDF). PDF fonts are declared only in `pdfFonts.ts` (files in `public/fonts/`); the Worker loads the same files through the assets binding. Characters Noto Sans Mono lacks (CJK, Hangul, Arabic, Hebrew, Thai, Devanagari, emoji) use the WOFF faces in `public/fonts/fallback/`, registered on demand by `pdfFallbackFonts.ts` only when the invoice text needs them (preview: same faces via `unicode-range` in `src/index.css`); after changing a font run `node scripts/pdf-font-coverage.mjs` (`server/pdf-fonts.test.ts` fails on drift). Keep `wrapMonospace.ts` widths in line with those faces.
- `src/components/ui/`: Reusable UI components from shadcn/ui.
- `src/components/Footer.tsx`: Global footer with attribution.
- `src/components/clients/`: client form dialog, Bill To client picker and fill rules.
- `src/components/templates/`: template form dialog, pickers, "Save as template" and the template fill rules (`templateApply.ts`).
- `src/components/sync/`, `src/components/AgentBadge.tsx`, `src/components/PageHeader.tsx`: cloud sync settings and header status, agent attribution, header for secondary pages.
- `font-mono` (ProtoMono) has capitals only; use `font-code` for keys, URLs and code where case matters.

## Development Workflows

### Running Locally
```bash
bun install
bun run dev
```

Requires Bun 1.4+ and Node.js 22.22+. No `.env` is needed; see `.env.example` (app) and `.dev.vars.example` (Worker) for optional overrides. The dev server runs on port 8080 and also runs the API Worker and a local D1 database in workerd; run `bun run db:migrate:local` once first. Never run `wrangler deploy` or remote migrations unless asked.

### Testing
Tests are co-located with components (e.g., `Component.test.tsx`) and server modules (`server/*.test.ts`). Server tests get a fresh local D1 per file from `server/test/helpers.ts` (`startD1`, `buildApp`, `connectAgent`); `worker/worker.test.ts` builds the app and runs the deployable bundle in workerd. `@cloudflare/vitest-pool-workers` is not used because it does not support Vitest 5 yet.
```bash
bun run test
bun run test:coverage
```

### Checks (same as CI)
```bash
bun run lint && bun run typecheck && bun run test:run && bun run build
```
`.github/workflows/deploy.yml` repeats these checks, applies remote D1 migrations and deploys on push to `main` / manual dispatch, only when the repository variable `CLOUDFLARE_DEPLOY` is `true` (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). Keep its steps in line with `ci.yml`; validate with `actionlint`.

### PDF Generation
PDF generation is handled by `src/components/invoice/InvoicePDF.tsx` using `@react-pdf/renderer`.
**Note:** valid CSS in React PDF is limited compared to web CSS. Always verify PDF output when making changes.
The PDF is a 1:1 rendering of `InvoicePreview.tsx` (595 px card = 595 pt A4 width). The card is always laid out at 595 px; where less room is available `InvoicePreview` scales it down as a whole (`transform: scale`, measured with ResizeObserver) instead of letting it reflow. When you change one, change the other: colours come from `invoiceTheme.ts` (mirrors the `src/index.css` tokens; a test fails on drift), fonts from `pdfFonts.ts` (same Noto Sans Mono faces as the preview's `@font-face`). In the browser the PDF follows the theme the preview shows; the API takes `?theme=light|dark` (default dark). `sanitizeText` returns plain text and must not HTML-escape (React and react-pdf render text literally). The invoice name prints under the number via `printableInvoiceName` (`src/lib/invoiceName.ts`): unnamed invoices store no name and get their dashboard label from `invoiceListLabel` (derived from the id); labels stored by earlier versions match `isGeneratedInvoiceName` and are never printed.
Page breaks (row-by-row line items, repeated table header, totals kept together, `minPresenceAhead` cancelling section margins) are explained at the top of `InvoicePDF.tsx` and covered by `server/pdf-pagination.test.ts`. The same component is rendered server-side by `GET /api/v1/invoices/:id/pdf` inside the Worker; `server/pdf.test.ts` and `worker/worker.test.ts` check the output text.

### Styling
- Use Tailwind CSS utility classes. Theme tokens (colors, radius, fonts) live in `src/index.css` (`@theme` / `@theme inline`).
- `src/index.css` contains Tailwind v3 compatibility rules (v3 `space-*` sibling margins, placeholder colour, button cursor, pinned palette colours) that keep the original look; keep them unless you deliberately restyle.
- Follow the existing dark mode aesthetic.
- Use `lucide-react` for icons.

## Contribution Guidelines
- Use the `bun` runtime for scripts.
- Ensure all new features have accompanying tests.
- Keep the `README.md` updated with new features.
