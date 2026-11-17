# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and Tailwind CSS.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 📝 Create and edit professional invoices
- 💾 Auto-save drafts to localStorage
- 📄 Export to PDF
- 🌙 Dark mode design
- 💱 Multi-currency support (All currencies)
- ⚙️ Comprehensive settings management
- 📋 Duplicate invoices
- 📱 Responsive layout
- ⚡ Installable PWA with offline support
- ☁️ Optional cloud sync (opt-in): an anonymous workspace, offline-first sync across browsers and devices, recovery key to link another device
- 🤖 AI agents: approve an agent from the app (scopes you can narrow), see what it created or edited, revoke it any time (REST + remote MCP)
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
| `APP_URL` | `""` (request origin) | Public base URL used in agent verification links |

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

Continuous deployment: CI only builds and runs `wrangler deploy --dry-run`
(no secrets). To deploy on push, either connect the repository in the
Cloudflare dashboard (Workers & Pages → your Worker → Settings → Builds) with
build command `bun run build` and deploy command `bunx wrangler deploy`, or add
a GitHub Actions job using `cloudflare/wrangler-action` with a
`CLOUDFLARE_API_TOKEN` secret.

## Agent API

AI agents (Claude, ChatGPT, scripts…) can work with your invoices after you
approve them, via REST (`/api/v1`) or a remote MCP server (`/api/mcp`).

1. The agent calls `POST /api/v1/agents/register` with its name and the scopes
   it wants (`invoices:read`, `invoices:write`, `invoices:delete`,
   `settings:read`) and shows you a code like `WDJB-MJHT`.
2. You approve it in the app (`/agents/approve?code=…`), optionally with fewer
   scopes.
3. The agent polls `POST /api/v1/agents/token` and receives its API key once.
   Every change it makes is attributed to it (`createdBy` / `updatedBy`), and
   you can revoke it at any time.

### Connecting an agent (as a user)

1. In the app, open **Settings → Cloud sync & agents** and turn on cloud sync.
   Your invoices and default settings are then stored on the server (in an
   anonymous workspace) so approved agents can work with them. The app keeps
   working offline; nothing leaves the browser until you turn this on.
2. Open **Agents** (header) and copy the prompt under *Connect an agent* into
   your AI tool (it tells the agent to read `/llms.txt` and register), or give
   it the MCP endpoint `https://<your app>/api/mcp`.
3. The agent shows you a code and a link to `/agents/approve?code=…`. Open it,
   check that the code matches, untick any permission you do not want to give
   and click **Approve**. Only approve requests you started yourself.
4. Invoices the agent creates or edits appear in your dashboard within ~15
   seconds, marked *by &lt;agent&gt;* / *edited by &lt;agent&gt;*. Revoke it on
   the Agents page.

To use the same workspace in another browser or device, reveal the
**recovery key** in Settings → Cloud sync & agents → *Link another browser or
device* and paste it under *Connect existing workspace* there. Keep it secret
(it is the workspace's only credential) and never give it to an agent.

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
request.

## Project Structure

```
worker/
└── index.ts                 # Cloudflare Worker entry (thin: builds deps, mounts the API)
server/                      # API (Hono), testable via createApp(deps)
├── app.ts                   # Routes
├── auth.ts                  # Bearer auth, scopes, principals
├── db/repository.ts         # All SQL (D1), scoped by workspace
├── services/                # Invoice and agent use-cases (shared by REST and MCP)
├── mcp.ts                   # Remote MCP server (official SDK v2)
├── openapi.ts               # OpenAPI 3.1 document
└── pdf/                     # Server-side PDF + Vite plugin for react-pdf in workerd
shared/                      # Types and helpers used by both the app and the API
├── api.ts                   # API contract types
├── types/invoice.ts         # Invoice types (re-exported from src/types)
├── settings.ts
├── user-code.ts             # Agent user-code normalisation (app + API)
└── invoice-totals.ts
migrations/                  # D1 migrations (wrangler d1 migrations)
wrangler.jsonc               # Worker, assets, D1 and rate-limit configuration
src/
├── App.tsx                  # Providers and routes
├── main.tsx                 # Entry point
├── index.css                # Tailwind 4 theme, design tokens, global styles
├── env.ts                   # Typed environment variables
├── components/
│   ├── invoice/             # Invoice components
│   │   ├── InvoiceForm.tsx
│   │   ├── InvoicePreview.tsx
│   │   ├── InvoicePDF.tsx   # @react-pdf/renderer document (also rendered by the API)
│   │   ├── pdfFonts.ts      # PDF font registry shared by browser and Worker
│   │   └── InvoiceList.tsx
│   ├── icons/               # Custom icons
│   ├── ui/                  # shadcn/ui components + CurrencySelector
│   ├── agents/scopes.ts     # Plain-language scope descriptions
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
│   ├── sync/                # Sync engine, merge rules, workspace join/leave
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
│   ├── Agents.tsx           # Connected agents, revoke, how to connect one
│   ├── ApproveAgent.tsx     # Agent consent screen (/agents/approve?code=…)
│   └── NotFound.tsx
├── stores/
│   ├── useInvoiceStore.ts   # Invoices and drafts (Zustand)
│   ├── useSettingsStore.ts  # Default settings (Zustand)
│   └── useCloudStore.ts     # Cloud sync: workspace, token, cursor, queue (Zustand)
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
