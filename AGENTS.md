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
- `useInvoiceStore.ts`: Manages the list of saved invoices.
- `useSettingsStore.ts`: Manages default invoice settings (from address, currency, etc.).
- `useCloudStore.ts`: opt-in cloud sync state: workspace, workspace token (the "recovery key"), sync cursor, pending-change queue, merge bases, per-invoice sync errors, plus runtime status for the header. Persisted as `cloud-sync-storage` (version + `migrateCloudStore` in `src/lib/storageMigrations.ts`).
- All stores use `persist` middleware to save data to `localStorage`. Invoices stay local-first: `useInvoiceStore` is the source of truth the UI reads; the sync engine mirrors it with the server.

### Cloud sync (opt-in) and agents
- Off by default: with no workspace token the app makes no API calls and behaves as a purely local app.
- `src/lib/api/`: typed client for `/api/v1` (same origin only). The token goes only in the `Authorization` header; never put it in URLs, logs, errors or toasts. A 401 for the stored token calls `leaveWorkspace('token_rejected')` (local data kept). `ApiError` carries `status/code/details/retryAfterMs`; `NetworkError` = offline/unreachable.
- `src/lib/sync/engine.ts`: the sync engine (contract: AGENT_API.md "Sync semantics"). A cycle pulls `GET /invoices?include_deleted=true&updated_since=<cursor>` (pages via `next`, cursor = `syncedAt` only after the last page, items applied idempotently by id, tombstones delete local copies) and then flushes the queue in order (`PUT` with `If-Match` / `If-None-Match: *`, `DELETE` with `If-Match`, `PUT /settings`). Transient errors (offline, 5xx, 429, 409) stop the queue with backoff / `Retry-After`; permanent ones (400…) drop the entry and mark the invoice "Not synced". `410` drops the local copy. `412` → GET + three-way merge against the last agreed version (`mergeContent` in `fields.ts`): fields changed only locally win, fields changed only on the server win, fields changed on both keep the **server** value; the user gets a toast either way. A `412` on delete restores the newer server copy.
- Local edits reach the engine through `src/lib/sync/localChanges.ts` (emitted by `saveInvoice`/`deleteInvoice`); changes applied from the server use `setState` directly so they are never echoed back. Drafts are never synced.
- `src/components/sync/CloudSyncRuntime.tsx` (mounted in `App.tsx`) triggers cycles on start, focus, `online`, and every 15 s while visible. `cloudActions.ts`: enable (create workspace + upload), connect with a recovery key (validated via `GET /workspace`), disconnect, delete workspace.
- Agent-facing UI: `/agents/approve` (consent screen, never auto-approves; agent-supplied text is rendered as plain text) and `/agents` (list/revoke, connection help). Server state there uses react-query (`['agents']`, `['agent-registration', code]`).
- Tests use `src/test/fakeApi.ts` (an in-memory implementation of the API) with `vi.stubGlobal('fetch', fake.fetch)`.

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
- `/operator/*`: private operator console (`src/operator/`, rendered by `src/main.tsx` instead of `App`)

### Backend (Cloudflare Worker)
- `worker/index.ts`: thin Worker entry. Builds `AppDeps` from the env (`DB`, `ASSETS`, `RATE_LIMIT_*`, `APP_URL`) and hands `/api/*` to the Hono app. Static assets and SPA fallback are handled by the assets layer (`run_worker_first: ["/api/*"]`).
- `server/app.ts`: `createApp(deps)` with all routes; tests call `app.request()`.
- `server/deps.ts`: injectable deps (db, clock, id/secret generators, rate limiters, asset reader, config).
- `server/db/repository.ts`: the only place with SQL for the public API (operator-console SQL is in `server/operator/db.ts`). Every query is parameterised and scoped by `workspace_id`; atomic steps are single statements or `db.batch()`.
- `server/services/`: invoice and agent use-cases shared by REST and MCP. `server/auth.ts`: Bearer auth (`mi_ws_` workspace token / `mi_agent_` agent key, looked up by SHA-256) and scopes.
- `server/mcp.ts`: MCP server per request (official SDK v2); tools are registered only for granted scopes.
- `server/openapi.ts`: OpenAPI 3.1; `server/openapi.test.ts` fails if routes and docs drift. Update it, `shared/api.ts` and `AGENT_API.md` together when changing the API.
- `server/pdf/render.tsx`: renders `InvoicePDF` in the Worker. `server/pdf/vite-plugin-react-pdf-workerd.ts` makes react-pdf run in workerd (browser builds, precompiled yoga wasm, pdfkit `import.meta.url`).
- `migrations/`: D1 schema. Add a new numbered file for every change; never edit applied migrations.
- `shared/`: code and types used by both the browser app and the Worker (keep it free of browser- or Node-only APIs).

### Components
- `src/components/invoice/`: Core business logic components (Form, Preview, PDF). PDF fonts are declared only in `pdfFonts.ts` (files in `public/fonts/`); the Worker loads the same files through the assets binding.
- `src/components/ui/`: Reusable UI components from shadcn/ui.
- `src/components/Footer.tsx`: Global footer with attribution.
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

### PDF Generation
PDF generation is handled by `src/components/invoice/InvoicePDF.tsx` using `@react-pdf/renderer`.
**Note:** valid CSS in React PDF is limited compared to web CSS. Always verify PDF output when making changes.
The PDF is a 1:1 rendering of `InvoicePreview.tsx` (595 px card = 595 pt A4 width). When you change one, change the other: colours come from `invoiceTheme.ts` (mirrors the `src/index.css` tokens; a test fails on drift), fonts from `pdfFonts.ts` (same Noto Sans Mono faces as the preview's `@font-face`). In the browser the PDF follows the theme the preview shows; the API takes `?theme=light|dark` (default dark). `sanitizeText` returns plain text and must not HTML-escape (React and react-pdf render text literally).
The same component is rendered server-side by `GET /api/v1/invoices/:id/pdf` inside the Worker; `server/pdf.test.ts` and `worker/worker.test.ts` check the output text.

### Styling
- Use Tailwind CSS utility classes. Theme tokens (colors, radius, fonts) live in `src/index.css` (`@theme` / `@theme inline`).
- `src/index.css` contains Tailwind v3 compatibility rules (v3 `space-*` sibling margins, placeholder colour, button cursor, pinned palette colours) that keep the original look; keep them unless you deliberately restyle.
- Follow the existing dark mode aesthetic.
- Use `lucide-react` for icons.

## Contribution Guidelines
- Use the `bun` runtime for scripts.
- Ensure all new features have accompanying tests.
- Keep the `README.md` updated with new features.
