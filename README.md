# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and Tailwind CSS.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 📝 Create and edit professional invoices
- 💾 Auto-save drafts to localStorage
- 📄 Export to PDF that looks exactly like the on-screen preview (same fonts, light/dark colours and layout), with clean page breaks on long invoices
- 🌐 Non-Latin text in PDFs: Chinese, Japanese, Korean, Arabic, Hebrew, Thai, Hindi (Devanagari) and emoji, with fonts downloaded only for invoices that use them
- 🌙 Dark mode design
- 💱 Multi-currency support (All currencies)
- ⚙️ Comprehensive settings management
- 📋 Duplicate invoices
- ✅ Invoice status (draft, sent, paid, void) with overdue tracking, quick actions, status filters and a per-currency totals strip (works offline)
- 👥 Saved clients: a client list (`/clients`) with default currency, tax rate and payment terms; pick a client on an invoice to fill Bill To, "Save as client" from an invoice, one-click import from existing invoices; invoices keep their own copy, so editing a client never changes past invoices
- 📱 Responsive layout
- ⚡ Installable PWA with offline support
- ☁️ Optional cloud sync (opt-in): an anonymous workspace, offline-first sync across browsers and devices, recovery key to link another device
- 🤖 AI agents: approve an agent from the app (scopes you can narrow), see what it created or edited, revoke it any time (REST + remote MCP)
- 🔐 Sign-in for MCP clients (OAuth 2.1): paste the MCP URL into a client that supports the MCP authorization flow, approve it in the app, done; no key to copy
- 🧾 Server-side PDF rendering with the same PDF component as the app

## Tech Stack

- **Framework**: React 19 with TypeScript 6
- **Build Tool**: Vite 8
- **Routing**: React Router 8 (declarative mode)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/index.css`)
- **UI Components**: shadcn/ui (Radix UI) + lucide-react icons
- **State Management**: Zustand with persist middleware
- **Form Handling**: TanStack Form with Zod 4 validation
- **PDF Generation**: @react-pdf/renderer
- **Notifications**: Sonner
- **PWA**: vite-plugin-pwa
- **Hosting**: Cloudflare Workers (static assets + API in one Worker) via `@cloudflare/vite-plugin`
- **API**: Hono on Workers, Cloudflare D1 (SQLite), MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)
- **Testing**: Vitest + React Testing Library; API and Worker tests run against workerd + local D1
- **Linting**: ESLint 10 + typescript-eslint

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.4+ (package manager and script runner)
- [Node.js](https://nodejs.org/) 22.22+ (Vite, Vitest and React Router run on Node)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xzapata/midnight-invoice.git
cd midnight-invoice

# Install dependencies
bun install
```

### Development

```bash
# Start the development server
bun run dev
```

The app will be available at `http://localhost:8080`. `bun run dev` runs the
SPA, the API Worker and a local D1 database together in workerd (Cloudflare's
runtime). Before the first run, create the local database schema:

```bash
bun run db:migrate:local
```

### Environment Variables

No `.env` file is required. To override the defaults, copy `.env.example` to
`.env.local`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_APP_NAME` | `Midnight Invoice` | Name shown in the header |
| `VITE_APP_ENV` | `DEVELOPMENT` | `DEVELOPMENT`, `STAGING`, `PREVIEW` or `PRODUCTION`; `DEVELOPMENT` shows the dev banner and favicon |

Worker (API) variables are set in `wrangler.jsonc` under `vars`, and locally in
`.dev.vars` (see `.dev.vars.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `""` (request origin) | Public base URL used in agent verification links (can be overridden at runtime in the operator console) |
| `INITIAL_PASSWORD` (secret) | unset (console disabled) | Enables the operator console and is the root of its encryption at rest; see [Operator console](#operator-console-operator) |
| `ENCRYPTION_KEY` (secret) | unset | Optional hardened encryption mode for the operator console |

### Building for Production

```bash
# Create production build
bun run build

# Preview the production build in workerd (same as deployed)
bun run preview
```

## Deploying to Cloudflare

The app is one Cloudflare Worker with static assets: the SPA is served from
`dist/client` (unknown paths fall back to `index.html`, so deep links work),
and `/api/*` always goes to the Worker (`worker/index.ts`). Configuration lives
in `wrangler.jsonc`.

One-time setup (needs a Cloudflare account):

```bash
bunx wrangler login
# 1. Create the D1 database and copy the printed database_id
bunx wrangler d1 create midnight-invoice
# 2. Replace the placeholder "database_id" (all zeros) in wrangler.jsonc with it
# 3. Create the tables
bun run db:migrate:remote
# 4. Optionally set "APP_URL" in wrangler.jsonc to your public URL
#    (e.g. https://invoices.example.com); otherwise links use the request origin.
#    The rate-limit "namespace_id"s in wrangler.jsonc can be any integers unique
#    in your account.
```

Deploy:

```bash
bun run deploy          # = bun run build && wrangler deploy
```

New migrations (`migrations/NNNN_*.sql`) are applied with
`bun run db:migrate:remote` before deploying code that needs them. After
changing bindings in `wrangler.jsonc`, regenerate types with
`bun run cf-typegen`.

### Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` deploys on every push to `main` (after the same
lint, typecheck, test and build steps as CI) and on demand from the Actions
tab ("Deploy" → *Run workflow*). It applies remote D1 migrations
(`wrangler d1 migrations apply DB --remote`) and then runs `wrangler deploy`.
Deploys never overlap (a newer push waits for the running one).

It is **off until you opt in**: without the variable below the job is skipped
(grey, not a failure). One-time setup:

1. Do the one-time Cloudflare setup above, and commit the real `database_id`
   in `wrangler.jsonc` (the workflow refuses the all-zeros placeholder).
2. Create an API token (Cloudflare dashboard → My Profile → API Tokens →
   *Create Token* → *Custom token*) with these **account** permissions for
   your account: **Workers Scripts: Edit** (deploy the Worker and its static
   assets), **D1: Edit** (apply migrations) and **Account Settings: Read**.
   If you serve the app on your own domain through a route, also add the
   zone permission **Workers Routes: Edit**.
3. In the GitHub repository → Settings → Secrets and variables → Actions:
   - secret `CLOUDFLARE_API_TOKEN`: the token from step 2;
   - secret `CLOUDFLARE_ACCOUNT_ID`: your account id (dashboard → Workers &
     Pages → *Account ID*);
   - variable `CLOUDFLARE_DEPLOY` = `true` to turn deploys on (any other value,
     or none, keeps the job skipped).
4. Optional: add protection rules to the `production` environment the job uses
   (Settings → Environments), e.g. required reviewers.

Alternatively, connect the repository in the Cloudflare dashboard (Workers &
Pages → your Worker → Settings → Builds) with build command `bun run build`
and deploy command `bunx wrangler deploy`, and leave `CLOUDFLARE_DEPLOY` unset.

## Operator console (`/operator`)

A private back-office for the site owner (the "operator", distinct from the
anonymous workspaces that use the app): headline stats, telemetry per part of
the service, workspaces and agents (metadata only), runtime settings and
secrets, restart/redeploy, audit log, operators, sessions and encryption keys.
It is never linked from the app, sends `noindex`, and its code is a separate
lazily loaded bundle that regular users never download or precache.

### Setup (production)

The only secret the deployment needs is `INITIAL_PASSWORD`. Without it the
console and `/api/operator/*` answer `503 operator console not configured`.

```bash
bun run db:migrate:remote                                 # includes 0004_operator.sql
openssl rand -base64 32 | bunx wrangler secret put INITIAL_PASSWORD
bun run deploy
```

Then open `https://<your-site>/operator`:

1. **Bootstrap login** with `INITIAL_PASSWORD`. This gives a 30-minute
   *setup-only* session (it can do nothing but the wizard). Failed attempts are
   rate limited with lockout and exponential backoff (per IP and global, in D1).
2. **Encryption key**: generate a random 256-bit master key (recommended) or
   derive one from a strong passphrase. The **recovery key** (`mi_mk_…`) is
   shown exactly once; download or copy it and confirm you saved it.
3. **WorkOS**: in the [WorkOS dashboard](https://dashboard.workos.com) create an
   environment, enable AuthKit with Email + Password and/or **Passkeys**, add the
   redirect URI the wizard shows (`https://<your-site>/api/operator/auth/callback`)
   under *Redirects*, then paste the API key (`sk_…`) and client ID
   (`client_…`). They are checked against WorkOS before they are stored
   (encrypted).
4. **Operator account**: you are sent to AuthKit to sign up and set your final
   password and/or passkey. On return that WorkOS user is bound as the operator
   and the bootstrap login is **permanently disabled** (server-side state in D1).

From then on, sign in at `/operator` with *Continue with WorkOS*. Add teammates
under *Operators & security* by email; they become operators the first time
they sign in with that verified email. The last operator cannot be removed.

`INITIAL_PASSWORD` must **stay set** after setup: in the default encryption mode
it is the root that unwraps the master key (it no longer logs anyone in).

### Encryption at rest

Secret settings (WorkOS API key, GitHub token, Resend key, the session signing
key) are envelope-encrypted with Web Crypto:

- master key (256-bit) → wraps the data key (DEK) → AES-256-GCM per value
  (random 96-bit IV per write, AAD binds setting key + version + DEK version);
- **default mode**: the master key is stored in D1 wrapped (AES-256-GCM) under a
  KEK = PBKDF2-SHA-256(`INITIAL_PASSWORD`, random salt, 100,000 iterations;
  ~14 ms in workerd, derived once per isolate and only for console requests);
- **hardened mode** (optional, *Operators & security*): set the recovery key as
  a second Worker secret, `bunx wrangler secret put ENCRYPTION_KEY`, redeploy,
  and click *Enable hardened mode*. The server verifies it against the stored
  key check value and deletes the wrapped copy from D1, so the database alone
  can never decrypt.

Rotation: *Rotate data key* re-encrypts every secret; *Rotate master key* shows
a new recovery key once (in hardened mode it completes when `ENCRYPTION_KEY` is
updated); *Change INITIAL_PASSWORD…* seals the master key under the new value
first, then you run `wrangler secret put INITIAL_PASSWORD` and the first
request that sees it promotes the new wrap. If the root secret changes without
that step (or `ENCRYPTION_KEY` is missing/wrong), the console **fails closed**:
nothing is decrypted or rewritten, sign-in is blocked, and the sign-in page
offers *Restore access* with the recovery key (or the passphrase).

Threat model: this protects D1 exports and backups, Time Travel restores and
casual database access. It does **not** protect against someone who has both
the database and the Worker's secrets (or can run code in the Worker).

### Runtime settings, restart and redeploy

Worker env vars cannot change at runtime, so the console's *Settings* are
stored in D1 and read in preference to `wrangler.jsonc` vars (`APP_URL`,
agent-flow timings, maintenance mode and message, registration open/closed,
telemetry retention, session timeouts, WorkOS, GitHub deploy settings, Resend).
Every Worker isolate picks a change up within 5 seconds; every change is in the
audit log (never the value of a secret).

- **Restart** = *Reload runtime configuration*: Workers have no process to
  restart; this bumps a config version so every isolate drops its cached
  settings, keys and suspension list.
- **Redeploy** dispatches the repository's `.github/workflows/deploy.yml`
  (`workflow_dispatch`) through the GitHub REST API. Set `github.token` (a
  fine-grained token with *Actions: read and write* on this repository only),
  `github.repository`, and optionally the workflow file and ref.

### Privacy boundary

The console shows metadata only: workspace ids, timestamps and counts, agent
names and scopes. There is no endpoint that returns invoice contents, client
data, workspace settings or tokens. Telemetry stores route templates, status
classes, durations and `cf-ray`; never ids in paths, bodies, tokens or IPs.

### Local development with `workos dev`

`bun run dev:operator` runs the official WorkOS CLI's `workos dev`
(`bunx workos@0.24.0`), which starts the WorkOS API emulator on
`http://localhost:4100` (seeded from `dev/workos-emulate.yaml`) and then the
normal dev server with `WORKOS_API_BASE_URL` set. That URL is honoured only by
the Vite dev server; builds compile it out.

```bash
cp .dev.vars.example .dev.vars          # sets a local INITIAL_PASSWORD
bun run db:migrate:local
bun run dev:operator                    # extra args go to vite, e.g. -- --port 8104
```

In the wizard use API key `sk_test_default` and client ID `client_emulated`,
and `operator@example.com` as the email (the emulator signs in the user named
by `login_hint` without a login page). Tests never use the network: WorkOS and
GitHub are faked at the fetch boundary (`server/test/operator.ts`).

### Break-glass reset

There is deliberately no remote reset endpoint. To re-enable the bootstrap
login (e.g. every operator lost their WorkOS access), clear the operator
binding with a direct database command; the encrypted settings and keys are
kept:

```bash
bunx wrangler d1 execute midnight-invoice --remote --command \
  "DELETE FROM operator_sessions; DELETE FROM operators; UPDATE operator_state SET bootstrap_completed_at = NULL WHERE id = 1;"
```

Then sign in with `INITIAL_PASSWORD` again and finish the wizard's identity
step. To start over completely (new master key; all stored secrets are lost),
also run `DELETE FROM operator_settings; DELETE FROM operator_state;`.

## Agent API

AI agents (Claude, ChatGPT, scripts…) can work with your invoices after you
approve them, via REST (`/api/v1`) or a remote MCP server (`/api/mcp`).

**MCP clients with OAuth** (simplest): add `https://<your app>/api/mcp` as a
remote MCP server. The client discovers the authorization server
(`/.well-known/oauth-protected-resource/api/mcp`), registers itself (or uses
a Client ID Metadata Document) and opens `/agents/authorize` in your browser,
where you review and narrow the permissions and approve. It then gets
short-lived, rotating tokens that only work on the MCP endpoint, and shows up
on the Agents page marked *OAuth*. See AGENT_API.md, *Connect with OAuth*.

**Other agents** use the device flow:

1. The agent calls `POST /api/v1/agents/register` with its name and the scopes
   it wants (`invoices:read`, `invoices:write`, `invoices:delete`,
   `settings:read`, `clients:read`, `clients:write`) and shows you a code like
   `WDJB-MJHT`.
2. You approve it in the app (`/agents/approve?code=…`), optionally with fewer
   scopes.
3. The agent polls `POST /api/v1/agents/token` and receives its API key once.
   Every change it makes is attributed to it (`createdBy` / `updatedBy`), and
   you can revoke it at any time.

With `clients:read` an agent can look up your saved clients and bill one by
id ("invoice Globex for 10 hours": `list_clients` → `create_invoice` with
`clientId`); the server fills the client's name, address, email and default
terms. `clients:write` lets it add, edit, archive and delete clients.

### Connecting an agent (as a user)

1. In the app, open **Settings → Cloud sync & agents** and turn on cloud sync.
   Your invoices, saved clients and default settings are then stored on the server (in an
   anonymous workspace) so approved agents can work with them. The app keeps
   working offline; nothing leaves the browser until you turn this on.
2. Open **Agents** (header). Simplest: paste the MCP server URL
   `https://<your app>/api/mcp` into an MCP client that supports OAuth; it
   opens a page in this app where you review the app's name, where it sends
   you back to and the permissions, untick what you do not want and click
   **Approve**. Otherwise copy the prompt under *Connect an agent* into your AI
   tool (it tells the agent to read `/llms.txt` and register).
3. With the prompt, the agent shows you a code and a link to
   `/agents/approve?code=…`. Open it, check that the code matches, untick any
   permission you do not want to give and click **Approve**. Only approve
   requests you started yourself.
4. Invoices the agent creates or edits appear in your dashboard within ~15
   seconds, marked *by &lt;agent&gt;* / *edited by &lt;agent&gt;*. Revoke it on
   the Agents page.

To use the same workspace in another browser or device, reveal the
**recovery key** in Settings → Cloud sync & agents → *Link another browser or
device* and paste it under *Connect existing workspace* there. Keep it secret
(it is the workspace's only credential) and never give it to an agent.

### Invoice status

Every invoice has a status: **draft**, **sent**, **paid** or **void**.
*Overdue* is not stored: an invoice is overdue when it is *sent* and its due
date is before today (the app uses your local date, the API the UTC date).
**Save Invoice** saves a new invoice as a draft; **Save & mark sent** saves
and marks it sent in one click. On the dashboard, the row menu (and the
buttons on the invoice page) mark invoices sent or paid, void them or reopen
them; filter chips show All / Draft / Outstanding / Overdue / Paid with
counts, and the totals strip shows Outstanding, Overdue and Paid this month
per currency (never added across currencies).

Invoices saved before statuses existed are shown as **drafts**: the app
cannot know whether they were sent or paid, and calling them "sent" would
flag every old invoice with a past due date as overdue. Mark them sent or
paid as needed. Allowed changes: draft → sent | void, sent → paid | void |
draft, paid → sent (undo payment) | void, void → draft | sent (reopen).
Agents use the same rules (`/invoices/:id/mark-sent` … and the
`set_invoice_status` MCP tool) and can ask "what is unpaid?" with
`GET /invoices/summary` or `get_invoice_summary`.

### How the API works

There are no accounts: the browser creates an anonymous workspace
(`POST /api/v1/workspaces`) whose token is the user credential. Full contract,
sync semantics, curl examples and the MCP client configuration:
[AGENT_API.md](AGENT_API.md); OpenAPI 3.1 at `/api/v1/openapi.json`; a short
pointer for agents at `/llms.txt`.

### Testing

```bash
# Run tests in watch mode
bun run test

# Run tests once
bun run test:run

# Run tests with coverage
bun run test:coverage
```

### Linting and Type Checking

```bash
bun run lint
bun run typecheck
```

Tests are split into three Vitest projects: `web` (components, jsdom),
`server` (the Hono API via `app.request()` against a real local D1 in workerd)
and `workerd` (builds the app and runs the production bundle in workerd: SPA
routing, API, MCP and PDF rendering).

CI (`.github/workflows/ci.yml`) runs install, a generated-types check, lint,
typecheck, tests, build and `wrangler deploy --dry-run` on every push and pull
request. Deploying is a separate, opt-in workflow (see "Continuous deployment").

## Project Structure

```
worker/
└── index.ts                 # Cloudflare Worker entry (thin: builds deps, mounts the API)
server/                      # API (Hono), testable via createApp(deps)
├── app.ts                   # Routes
├── auth.ts                  # Bearer auth, scopes, principals
├── db/repository.ts         # SQL (D1), scoped by workspace
├── db/clientRepository.ts   # SQL for saved clients
├── routes/clients.ts        # /api/v1/clients routes
├── services/                # Invoice, client and agent use-cases (shared by REST and MCP)
├── mcp.ts, mcpClients.ts    # Remote MCP server (official SDK v2) and its client tools
├── openapi.ts               # OpenAPI 3.1 document (+ openapiClients.ts)
├── pdf/                     # Server-side PDF + Vite plugin for react-pdf in workerd
├── operator/                # Operator console API, settings registry, encryption, telemetry
└── scheduled.ts             # Cron Trigger job registry
shared/                      # Types and helpers used by both the app and the API
├── api.ts                   # API contract types
├── types/invoice.ts         # Invoice types (re-exported from src/types)
├── types/client.ts          # Saved-client types and helpers
├── settings.ts
├── user-code.ts             # Agent user-code normalisation (app + API)
├── operator.ts              # Operator console API types (private)
└── invoice-totals.ts
migrations/                  # D1 migrations (wrangler d1 migrations)
wrangler.jsonc               # Worker, assets, D1 and rate-limit configuration
src/
├── App.tsx                  # Providers and routes
├── main.tsx                 # Entry point
├── index.css                # Tailwind 4 theme, design tokens, global styles
├── env.ts                   # Typed environment variables
├── operator/                # Operator console SPA (lazy-loaded for /operator only)
├── components/
│   ├── invoice/             # Invoice components
│   │   ├── InvoiceForm.tsx
│   │   ├── InvoicePreview.tsx
│   │   ├── InvoicePDF.tsx   # @react-pdf/renderer document (also rendered by the API)
│   │   ├── pdfFonts.ts      # PDF font registry shared by browser and Worker
│   │   ├── invoiceTheme.ts  # Light/dark invoice palette shared by preview and PDF
│   │   └── InvoiceList.tsx
│   ├── icons/               # Custom icons
│   ├── ui/                  # shadcn/ui components + CurrencySelector
│   ├── agents/scopes.ts     # Plain-language scope descriptions
│   ├── clients/             # Client form dialog, Bill To client picker, fill rules
│   ├── sync/                # Cloud sync settings, header status, runtime (polling/focus/online)
│   ├── AgentBadge.tsx       # "by <agent>" attribution
│   ├── CopyButton.tsx
│   ├── PageHeader.tsx
│   ├── Footer.tsx
│   ├── SettingsDrawer.tsx
│   └── ThemeToggle.tsx
├── hooks/
│   └── useInvoices.ts       # Invoice management hook
├── lib/
│   ├── api/                 # Typed API client (errors, 401/429/offline handling)
│   ├── sync/                # Generic sync engine, per-collection descriptors (collections/), merge rules, workspace join/leave
│   ├── currencies.ts        # Currency list
│   ├── invoice-utils.ts     # Currency/date formatting
│   ├── sanitize.ts          # Input sanitization
│   ├── storageMigrations.ts # localStorage schema migrations
│   ├── validation.ts        # Zod schemas
│   └── utils.ts             # General utilities
├── pages/
│   ├── Index.tsx            # Dashboard
│   ├── CreateInvoice.tsx    # Create/edit invoice
│   ├── ViewInvoice.tsx      # View saved invoice
│   ├── Clients.tsx          # Saved clients (/clients)
│   ├── Agents.tsx           # Connected agents, revoke, how to connect one
│   ├── ApproveAgent.tsx     # Agent consent screen (/agents/approve?code=…)
│   └── NotFound.tsx
├── stores/
│   ├── useInvoiceStore.ts   # Invoices and drafts (Zustand)
│   ├── useSettingsStore.ts  # Default settings (Zustand)
│   ├── useClientStore.ts    # Saved clients (Zustand)
│   └── useCloudStore.ts     # Cloud sync: workspace, token, cursors, queue (Zustand)
├── test/
│   ├── setup.ts             # Test configuration
│   └── fakeApi.ts           # In-memory fake of the API for jsdom tests
└── types/
    └── invoice.ts           # TypeScript interfaces
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start the app + API Worker + local D1 (workerd) |
| `bun run dev:operator` | Same, under `workos dev` (local WorkOS emulator for the operator console) |
| `bun run build` | Build the SPA and the Worker |
| `bun run preview` | Run the production build locally in workerd |
| `bun run deploy` | Build and `wrangler deploy` |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `bun run db:migrate:local` | Apply D1 migrations to the local database |
| `bun run db:migrate:remote` | Apply D1 migrations to the Cloudflare database |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Type-check with TypeScript |
| `bun run test` | Run tests in watch mode |
| `bun run test:run` | Run tests once |
| `bun run test:coverage` | Run tests with coverage report |

## State Management

The app uses [Zustand](https://github.com/pmndrs/zustand) for state management with the `persist` middleware for automatic localStorage synchronization.

```typescript
// Access the store directly
import { useInvoiceStore } from '@/stores/useInvoiceStore';

const invoices = useInvoiceStore((state) => state.invoices);
const saveInvoice = useInvoiceStore((state) => state.saveInvoice);

// Or use the hook wrapper for backwards compatibility
import { useInvoices } from '@/hooks/useInvoices';

const { invoices, saveInvoice, deleteInvoice } = useInvoices();
```

## Security

All user input is sanitized before rendering to prevent XSS attacks:

```typescript
import { sanitizeInvoiceData } from '@/lib/sanitize';

// Sanitize all invoice fields before rendering
const safeData = sanitizeInvoiceData(formData);
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.
