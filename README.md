# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and
Tailwind CSS. It works entirely in your browser; optionally it syncs to a
Cloudflare-hosted backend that also lets approved AI agents work with your
invoices.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Deploy to Cloudflare](#deploy-to-cloudflare)
- [Configuration reference](#configuration-reference) (bindings, vars and secrets · operator settings · scheduled jobs)
- [Operator console](#operator-console-operator)
- [User accounts (optional)](#user-accounts-optional)
- [Agent API](#agent-api)
- [Invoice status](#invoice-status)
- [Security model and known limitations](#security-model-and-known-limitations)
- [Development](#development) (tests, checks, CI, project structure, scripts)
- [Contributing](#contributing) · [License](#license)

## Features

Works without any server (everything stays in the browser):

- 📝 Create, edit and duplicate invoices; drafts are auto-saved
- ✅ Invoice status (draft, sent, paid, void) with overdue tracking, quick actions, status filters and a per-currency totals strip
- 👥 Saved clients (`/clients`) with default currency, tax rate and payment terms; a client picker on Bill To, "Save as client", import from existing invoices; invoices keep their own copy, so editing a client never changes past invoices
- 🧩 Templates (`/templates`): reusable invoices with line items, terms, notes and a default client; placeholders such as `{{month_name}}` and `{{prev_month_name}}` are filled in for each invoice's issue date; "New from template", "From template" and "Save as template"
- 📄 PDF export that looks exactly like the on-screen preview (same fonts, light/dark colours and layout), with clean page breaks on long invoices
- 🌐 Non-Latin text in PDFs: Chinese, Japanese, Korean, Arabic, Hebrew, Thai, Hindi (Devanagari) and emoji, with fonts downloaded only for invoices that use them
- 💱 Every ISO 4217 currency · 🌙 dark and light themes · 📱 responsive down to 320 px · ⚡ installable PWA with offline support

With the optional backend (opt-in per browser, *Settings → Cloud sync & agents*):

- ☁️ Cloud sync: offline-first sync of invoices, clients, templates and settings across browsers and devices, in an anonymous workspace with a recovery key
- 👤 Optional accounts (when the operator enables them): sign in with WorkOS AuthKit to reach your workspace from any browser, with per-device keys you can revoke
- 🔁 Recurring invoices (`/recurring`): an invoice from a template every week, two weeks, month, quarter or year, in your time zone, even when the app is closed; as a draft, marked sent or emailed to the client
- ✉️ Send an invoice by email with the PDF attached (needs an email provider set up by the site operator)
- 🕵️ Activity log (`/activity`): what you, each AI agent and your recurring schedules did, with filters, per-agent views and a History section on each invoice
- 🤖 AI agents: approve an agent from the app (permissions you can narrow), see what it created or edited, revoke it any time; REST API and remote MCP server, with OAuth sign-in for MCP clients ("paste the URL, approve, done")
- 🛠️ A private operator console (`/operator`) for the site owner: telemetry, workspaces, settings, encryption of secrets, maintenance mode, redeploys

## Tech stack

- **Framework**: React 19 with TypeScript 6, Vite 8, React Router 8 (declarative mode)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/index.css`), shadcn/ui (Radix UI), lucide-react icons, Sonner
- **State**: Zustand with persist middleware; TanStack Form + Zod 4; react-query for server state
- **PDF**: @react-pdf/renderer (same component in the browser and in the Worker)
- **PWA**: vite-plugin-pwa
- **Hosting**: one Cloudflare Worker (static assets + API) via `@cloudflare/vite-plugin`
- **API**: Hono, Cloudflare D1 (SQLite), MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)
- **Testing**: Vitest + React Testing Library; API and Worker tests run in workerd against a local D1
- **Linting**: ESLint 10 + typescript-eslint

## Local development

Prerequisites: [Bun](https://bun.sh/) 1.4+ (package manager and script
runner) and [Node.js](https://nodejs.org/) 22.22+ (Vite, Vitest and React
Router run on Node).

```bash
git clone https://github.com/0xzapata/midnight-invoice.git
cd midnight-invoice
bun install
bun run db:migrate:local      # once, and after pulling new migrations
bun run dev                   # http://localhost:8080
```

`bun run dev` runs the SPA, the API Worker and a local D1 database together in
workerd (Cloudflare's runtime). Everything except the operator console and
user accounts works with no configuration.

To work on the operator console or user accounts, run the same server under
the official WorkOS CLI's local emulator instead:

```bash
cp .dev.vars.example .dev.vars          # sets a local INITIAL_PASSWORD
bun run dev:operator                    # extra args go to vite, e.g. -- --port 8104
```

`bun run dev:operator` runs `bunx workos@0.24.0 dev` (emulator on
`http://localhost:4100`, seeded from `dev/workos-emulate.yaml`; add
`--port <n>` after `dev` in the script if 4100 is taken) and then the dev
server with `WORKOS_API_BASE_URL` pointing at it. Open `/operator`, use API key
`sk_test_default` and client ID `client_emulated` in the wizard and
`operator@example.com` as the email. The emulator signs in the user named by
`login_hint` without a login page; it also seeds `alice@example.com`,
`bob@example.com` and an unverified user for user accounts.

To try sending email locally, run a fake Resend server and start the dev
server with `RESEND_API_BASE_URL=http://127.0.0.1:<port>` in its environment.
`WORKOS_API_BASE_URL` and `RESEND_API_BASE_URL` are honoured only by the Vite
dev server and compiled out of every build. Scheduled jobs can be triggered
locally with
`curl "http://127.0.0.1:8080/cdn-cgi/handler/scheduled?cron=7+*+*+*+*"`.

Optional build-time variables for the browser app (copy `.env.example` to
`.env.local`; no `.env` is required):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_APP_NAME` | `Midnight Invoice` | Name shown in the header |
| `VITE_APP_ENV` | `DEVELOPMENT` under `bun run dev`, `PRODUCTION` in builds | `DEVELOPMENT`, `STAGING`, `PREVIEW` or `PRODUCTION`; `DEVELOPMENT` shows the dev banner and favicon |

Worker variables for local runs go in `.dev.vars` (see `.dev.vars.example`);
the full list is in [Configuration reference](#configuration-reference).

## Deploy to Cloudflare

The app is one Cloudflare Worker with static assets: the SPA is served from
`dist/client` (unknown paths fall back to `index.html`, so deep links work),
and `/api/*` plus the OAuth discovery documents always go to the Worker
(`worker/index.ts`). Configuration lives in `wrangler.jsonc`. The Workers
**Paid** plan is recommended: server-side PDF rendering (PDF downloads by
agents, emailed invoices) and the operator console's key derivation need more
CPU time per request than the Free plan allows (see
[limitations](#security-model-and-known-limitations)).

Steps 1–6 make the app and the agent API work; the rest is optional.

1. **Log in and create the database**
   ```bash
   bunx wrangler login
   bunx wrangler d1 create midnight-invoice
   ```
2. **Configure `wrangler.jsonc`**: replace the placeholder `database_id`
   (all zeros) with the printed id. Optionally set `vars.APP_URL` to your
   public URL (e.g. `https://invoices.example.com`; empty = the request
   origin, can also be changed later in the operator console). The
   rate-limit `namespace_id`s can be any integers unique in your account.
3. **Set the operator secret** (enables the operator console; also the root
   of its encryption at rest, so keep it set afterwards):
   ```bash
   openssl rand -base64 32 | bunx wrangler secret put INITIAL_PASSWORD
   ```
   Use at least 24 characters: a shorter value keeps the console off
   (`503 operator_not_configured`, reason `initial_password_too_short`).
   Without it the app and API work, but `/operator` and user accounts are
   unavailable (`503`).
4. **Create the tables**: `bun run db:migrate:remote`. Run it again whenever
   new files appear in `migrations/`, before deploying code that needs them.
5. **Deploy**: `bun run deploy` (= `bun run build && wrangler deploy`).
6. **Run the operator wizard**: open `https://<your-site>/operator`, sign in
   with `INITIAL_PASSWORD`, create the master key and save the recovery key
   (`mi_mk_…`, shown once), enter your WorkOS credentials and create your
   operator account (details in [Operator console](#operator-console-operator)).
   In the [WorkOS dashboard](https://dashboard.workos.com) first create an
   environment, enable AuthKit (Email + Password and/or Passkeys) and add
   **both** redirect URIs under *Redirects*:
   - `https://<your-site>/api/operator/auth/callback` (operators)
   - `https://<your-site>/api/account/auth/callback` (user accounts, if you
     will enable them; AuthKit must allow sign-ups and require email
     verification)
7. **Optional: user accounts**: *Settings → Accounts → User accounts* in the
   console ([details](#user-accounts-optional)).
8. **Optional: email**: in [Resend](https://resend.com) add and verify a
   sending domain and create an API key, then set *Settings → Email* in the
   console ([details](#email-sending-invoices)).
9. **Optional: redeploys from the console**: set *Settings → Deployments*
   (`github.token`, a fine-grained token with *Actions: read and write* on
   this repository only, and `github.repository`), and set up the deploy
   workflow (step 11).
10. **Optional: hardened encryption**: put the recovery key in a second secret
    (`bunx wrangler secret put ENCRYPTION_KEY`), redeploy, then click
    *Enable hardened mode* under *Operators & security* ([details](#encryption-at-rest)).
11. **Optional: continuous deployment**: `.github/workflows/deploy.yml` runs
    the CI checks, applies remote D1 migrations and deploys on every push to
    `main` and on manual dispatch, but stays skipped until you opt in:
    - commit the real `database_id` (the workflow refuses the placeholder);
    - create a Cloudflare API token (*My Profile → API Tokens → Custom token*)
      with the account permissions **Workers Scripts: Edit**, **D1: Edit** and
      **Account Settings: Read** (plus the zone permission **Workers Routes:
      Edit** if you serve the app on your own domain through a route);
    - in GitHub → *Settings → Secrets and variables → Actions* add the secrets
      `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and the variable
      `CLOUDFLARE_DEPLOY` = `true`;
    - optionally add protection rules to the `production` environment.

    Alternatively connect the repository in the Cloudflare dashboard (*Workers
    & Pages → your Worker → Settings → Builds*, build command `bun run build`,
    deploy command `bunx wrangler deploy`) and leave `CLOUDFLARE_DEPLOY` unset.

After changing bindings in `wrangler.jsonc`, regenerate types with
`bun run cf-typegen`.

## Configuration reference

### Bindings, vars and secrets (`wrangler.jsonc`)

| Name | Kind | Required | Purpose |
|------|------|----------|---------|
| `DB` | D1 binding | yes | All server data (`migrations/0001`–`0011`) |
| `ASSETS` | static assets binding | yes | SPA files; the Worker reads the PDF fonts through it |
| `RATE_LIMIT_CREATE` | rate-limit binding | yes | Workspace creation, agent registration, OAuth client registration: 10 / 60 s per IP |
| `RATE_LIMIT_POLL` | rate-limit binding | yes | Token polling, user-code lookups, OAuth endpoints: 30 / 60 s per IP |
| `CF_VERSION_METADATA` | version metadata binding | yes | Running version shown in the operator console |
| `triggers.crons` | Cron Triggers | yes | `17 * * * *`, `43 3 * * *`, `7 * * * *` ([jobs](#scheduled-jobs)) |
| `APP_URL` | var | no | Public base URL for links (empty = request origin); the operator setting `app.url` wins |
| `INITIAL_PASSWORD` | secret | for the console | Unlocks the first-run wizard; root of the default encryption mode; at least 24 characters |
| `ENCRYPTION_KEY` | secret | no | Hardened encryption mode (the master/recovery key `mi_mk_…`) |
| `RESEND_API_KEY` | secret | no | Fallback for the operator setting `resend.apiKey` |
| `EMAIL_FROM_ADDRESS` | var | no | Fallback for the operator setting `email.fromAddress` |
| `WORKOS_API_BASE_URL`, `RESEND_API_BASE_URL` | env (dev only) | no | Local emulators; ignored outside `bun run dev` |

GitHub Actions (deploy workflow only): secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, variable `CLOUDFLARE_DEPLOY`.

### Operator settings

Runtime settings live in D1 and are edited in `/operator` → *Settings* (every
isolate picks up a change within 5 s, every change is audited; secrets are
stored encrypted and never shown again). Resolution: D1 value → wrangler var
(where one is listed above) → default.

| Group | Settings |
|-------|----------|
| General | `app.url`, maintenance mode and message, workspace and agent registration open/closed |
| Storage limits | invoices (50,000), clients (10,000) and templates (2,000) per workspace (`409 limit_reached`) |
| Agents | device-flow registration lifetime (600 s), poll interval (5 s), user-code failure limit, last-used throttle |
| OAuth (MCP clients) | dynamic client registration and Client ID Metadata Documents on/off, access-token (60 min) and refresh-token (30 days) lifetimes, unused-registration lifetime (24 h) |
| Telemetry | on/off, minute and hour rollup retention |
| Activity log | retention days (365) and entries per workspace (10,000) |
| Recurring invoices | on/off, schedules per workspace, invoices generated per run |
| Operator console | session idle and absolute timeouts |
| WorkOS | client ID, API key (secret) — used by operators and user accounts |
| Accounts | user accounts on/off, require an account for new workspaces, session idle (14 days) and absolute (30 days) timeouts |
| Deployments | GitHub token (secret), repository, workflow file (`deploy.yml`), ref (`main`), API URL (`https://api.github.com` or `https://<host>/api/v3`; changing it clears the token) |
| Email | on/off, **only signed-in accounts may send** (`email.requireAccount`, on), provider (Resend), Resend API key (secret), From address and name, Reply-To policy, PDF theme (light), cooldown (10 min); limits count recipients (to + cc): workspace hourly / daily (20/50), new workspaces' daily cap (10 for 7 days), per IP hourly (30), agent hourly / daily (5/20), site daily cap (500) with 20% kept for recurring emails |

### Scheduled jobs

Registered in `server/scheduled.ts`; each cron must also be in
`wrangler.jsonc` `triggers.crons` (tested). All jobs are idempotent.

| Cron (UTC) | Job | Does |
|------------|-----|------|
| `17 * * * *` | `operator.maintenance` | Telemetry retention, expired operator sessions |
| `17 * * * *` | `oauth.prune` | Expired OAuth requests, codes and tokens, unused client registrations, dead grants |
| `17 * * * *` | `accounts.cleanup` | Expired sign-in states, ended sessions, device keys revoked over 30 days ago |
| `7 * * * *` | `recurring.generate` | Generates due recurring invoices (and retries failed generations and emails) |
| `43 3 * * *` | `activity.retention` | Prunes the activity log per the retention settings |

## Operator console (`/operator`)

A private back-office for the site owner (the "operator"): headline stats,
telemetry per part of the service, workspaces, agents and accounts (metadata
only), runtime settings and secrets, restart/redeploy, audit log, operators,
sessions and encryption keys. It is never linked from the app, sends
`noindex`, and its code is a separate lazily loaded bundle that regular users
never download or precache.

### First-run wizard

Without `INITIAL_PASSWORD` the console and `/api/operator/*` answer
`503 operator console not configured`. With it, open `/operator`:

1. **Bootstrap login** with `INITIAL_PASSWORD`. This gives a 30-minute
   *setup-only* session (it can do nothing but the wizard). Failed attempts are
   rate limited with lockout and exponential backoff (per IP and global, in D1).
2. **Encryption key**: generate a random 256-bit master key (recommended) or
   derive one from a strong passphrase. The **recovery key** (`mi_mk_…`) is
   shown exactly once; download or copy it and confirm you saved it.
3. **WorkOS**: paste the API key (`sk_…`) and client ID (`client_…`) of the
   AuthKit environment whose redirect URIs you added (see
   [Deploy](#deploy-to-cloudflare), step 6). They are checked against WorkOS
   before they are stored (encrypted).
4. **Operator account**: you are sent to AuthKit to sign up and set your final
   password and/or passkey. On return that WorkOS user is bound as the operator
   and the bootstrap login is **permanently disabled** (server-side state in D1).

From then on, sign in at `/operator` with *Continue with WorkOS*. Add teammates
under *Operators & security* by email; they become operators the first time
they sign in with that verified email. The last operator cannot be removed.

### Encryption at rest

Secret settings (WorkOS API key, GitHub token, Resend key, session signing
keys) are envelope-encrypted with Web Crypto:

- master key (256-bit) → wraps the data key (DEK) → AES-256-GCM per value
  (random 96-bit IV per write, AAD binds setting key + version + DEK version);
- **default mode**: the master key is stored in D1 wrapped (AES-256-GCM) under a
  KEK = PBKDF2-SHA-256(`INITIAL_PASSWORD` (24+ characters), random salt,
  600,000 iterations; ~93 ms in local workerd, derived once per isolate and only
  for console and account requests; wraps made with 100,000 iterations by
  earlier builds are re-wrapped on unlock);
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

### Restart and redeploy

- **Restart** = *Reload runtime configuration*: Workers have no process to
  restart; this bumps a config version so every isolate drops its cached
  settings, keys and suspension list.
- **Redeploy** dispatches `.github/workflows/deploy.yml` (`workflow_dispatch`)
  through the GitHub REST API with the *Deployments* settings, and lists the
  workflow's recent runs.

### Email (sending invoices)

Sending invoices by email (`POST /api/v1/invoices/:id/send`, the app's
**Send by email**, MCP `send_invoice_email`, recurring schedules that email)
uses [Resend](https://resend.com). Until it is configured, the feature answers
`503 email_not_configured`, the app explains it, and *Settings → Email* shows
"Email: not configured".

1. Create a Resend account and **add and verify a sending domain** (Resend →
   Domains: add the SPF/DKIM DNS records it shows; a subdomain such as
   `mail.example.org` keeps your main domain's reputation separate). Add a
   DMARC record for the domain if you do not have one.
2. Create an API key with *Sending access*, ideally restricted to that domain.
3. In `/operator` → **Settings → Email** paste the key into *Resend API key*
   (stored encrypted; alternatively `bunx wrangler secret put RESEND_API_KEY`)
   and set *From address* to an address on the verified domain, e.g.
   `invoices@mail.example.org` (or the `EMAIL_FROM_ADDRESS` var). No redeploy
   is needed.
4. Optionally adjust the *From name* (recipients see "<sender> via <From
   name>"), *Reply-To* (default: the invoice's From email), the attached PDF's
   theme and the limits ([settings](#operator-settings)). *Send invoices by
   email* turns the feature off without removing the key.
5. **Who may send**: by default only workspaces owned by a signed-in account
   (with a verified email) may send (`email.requireAccount`), so nobody can use
   your domain anonymously; others get `403 account_required_for_email` and
   the app asks them to sign in. This needs [user accounts](#user-accounts-optional)
   on; with accounts off and the setting on, nobody can send (the console says
   so). Turning it off lets anyone who turns on cloud sync send from your
   domain within the caps.

Users never choose the From address. Agents need the `invoices:send` scope
(never granted to existing agents), can only email the invoice's client
address when the user entered it themselves, and cannot send an invoice whose
sender name, email or payment details are not the user's (the settings, or
values the user typed or approved) until the user approves it in the app
("Needs your review" on the invoice page; saving the invoice for another
reason approves nothing). Recurring emails are held when an agent changed
the template, client or invoice since the user set them up ("re-approve" on
the Recurring page). Every
attempt is logged per workspace (`email_messages`, no message bodies) and
appears in the activity log (recipient masked).

### Privacy boundary

The console shows metadata only: workspace ids, timestamps and counts, agent
names and scopes, and for user accounts their sign-in email. There is no
endpoint that returns invoice contents, client data, workspace settings or
tokens (templates and recurring schedules appear as counts only). Telemetry
stores route templates, status classes, durations and `cf-ray`; never ids in
paths, bodies, tokens or IPs.

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

## User accounts (optional)

By default cloud sync uses an **anonymous workspace**: one browser holds its
token, and the *recovery key* (that token) is the only way back in from
another device. When the operator turns on accounts, users can also **sign in
with WorkOS AuthKit** (email + password, passkeys or social logins, whatever
the AuthKit environment allows) and reach their workspace from any browser.
Accounts are additive: the app still works fully local, and anonymous
workspaces and recovery keys keep working.

### Enabling accounts (operator)

Accounts reuse the operator console's WorkOS credentials and AuthKit
environment, so the console must be set up first.

1. In the WorkOS dashboard, add the redirect URI
   `https://<your-site>/api/account/auth/callback` (next to the operator's
   `/api/operator/auth/callback`). AuthKit must **allow sign-ups** and require
   **email verification** (the server refuses unverified emails in any case).
2. In the console: *Settings → Accounts → User accounts* on. Optionally
   *Require an account for new workspaces* (anonymous `POST /api/v1/workspaces`
   then answers `403 account_required`; existing workspaces are unaffected) and
   the account-session timeouts.
3. *Users → Accounts* lists accounts (email, verified, created, last sign-in,
   linked workspace id, device count), searchable by email; *Disable* refuses
   sign-in and revokes every session and device key of that account. The
   *Telemetry* page has *Account sign-in* and *Accounts* groups.

Turning accounts off later does not lock anyone out: browsers that are
already signed in keep syncing with their own keys, but nobody can sign in,
add a device or manage their account until accounts are back (*Users →
Accounts* shows how many workspaces are owned by an account). Disable
individual accounts to revoke their devices.

Operators and users are separate identities even though they share the WorkOS
environment: an operator signing in to the app gets an ordinary user account,
and neither session is ever accepted by the other side.

### What users see

- Settings → *Cloud sync & agents* shows **Sign in** / **Create account** next
  to *Turn on cloud sync*; the agent approval and OAuth consent screens offer
  **Sign in** first and come back to the same request afterwards. Signing in
  with no workspace turns cloud sync on with a workspace owned by the account.
- A browser that already syncs anonymously and signs in **claims** that
  workspace for the account. Its recovery key keeps working until the owner
  rotates or turns it off on the *Account* page.
- On a **new browser**, signing in connects the account's workspace and pulls
  everything, no recovery key needed. If that browser already has local data
  that is not in the account, or syncs with a different workspace, the app
  **asks**: upload/copy it into the account's workspace, or cancel. Local
  invoices are never discarded and two cloud workspaces are never merged.
- *Account* (`/account`): email, sign out, devices (last synced, revoke),
  *sign out other devices*, *sign out everywhere*, recovery key (rotate /
  create / turn off) and *delete account* (optionally with the workspace; if
  kept, the browser continues anonymously with a fresh recovery key). One
  account has one workspace.
- Signing a device out never disconnects agents or OAuth-connected apps; manage
  those on the *Agents* page. A browser that was signed out elsewhere, or whose
  account the operator disabled, says so in Settings and keeps its local data.
- Account events appear in the workspace's *Activity* log.

## Agent API

AI agents (Claude, ChatGPT, scripts…) can work with your invoices after you
approve them, via REST (`/api/v1`) or a remote MCP server (`/api/mcp`). Full
contract, sync semantics, curl examples and MCP configuration:
[AGENT_API.md](AGENT_API.md); OpenAPI 3.1 at `/api/v1/openapi.json`; a short
pointer for agents at `/llms.txt`.

The browser app owns a **workspace** (`POST /api/v1/workspaces`, anonymous, or
created through a user account) whose token is the user's credential; agents
never get it. They connect in one of two ways:

**MCP clients with OAuth** (simplest): add `https://<your app>/api/mcp` as a
remote MCP server. The client discovers the authorization server
(`/.well-known/oauth-protected-resource/api/mcp`), registers itself (or uses
a Client ID Metadata Document) and opens `/agents/authorize` in your browser,
where you review and narrow the permissions and approve. It then gets
short-lived, rotating tokens that only work on the MCP endpoint, and shows up
on the Agents page marked *OAuth*.

**Other agents** use the device flow:

1. The agent calls `POST /api/v1/agents/register` with its name and the scopes
   it wants (`invoices:read`, `invoices:write`, `invoices:delete`,
   `settings:read`, `clients:read`, `clients:write`, `templates:read`,
   `templates:write`, `activity:read`, `invoices:send`, `recurring:read`,
   `recurring:write`) and shows you a code like `WDJB-MJHT`.
2. You approve it in the app (`/agents/approve?code=…`), optionally with fewer
   scopes.
3. The agent polls `POST /api/v1/agents/token` and receives its API key once.
   Every change it makes is attributed to it (`createdBy` / `updatedBy`), and
   you can revoke it at any time.

What the scopes allow, in short: `clients:read` lets an agent look up your
saved clients and bill one by id (the server fills the client's details and
default terms); `templates:read` with `invoices:write` lets it create invoices
from your templates (explicit values win over the template, the template over
the client's defaults, and those over your settings); `recurring:write` (plus
`invoices:write` and `templates:read`) lets it set up, pause, resume and run
recurring schedules, but **only you** can make a schedule email each invoice
automatically; `activity:read` lets it read its *own* activity entries;
`invoices:send` (marked as sensitive on the approval screen) lets it email an
invoice to the client address you entered yourself, with its own hourly and
daily limits. New scopes are never added to agents approved earlier.

### Connecting an agent (as a user)

1. In the app, open **Settings → Cloud sync & agents** and turn on cloud sync
   (or sign in, if the site offers accounts). Your invoices, clients, templates
   and default settings are then stored on the server so approved agents can
   work with them. Nothing leaves the browser until you turn this on.
2. Open **Agents** (header). Simplest: paste the MCP server URL
   `https://<your app>/api/mcp` into an MCP client that supports OAuth; it
   opens a page in this app where you review the app's name, where it sends
   you back to and the permissions, untick what you do not want and click
   **Approve**. Otherwise copy the prompt under *Connect an agent* into your AI
   tool (it tells the agent to read `/llms.txt` and register), then open the
   link it shows, check that the code matches, untick any permission you do
   not want to give and click **Approve**. Only approve requests you started
   yourself.
3. Invoices the agent creates or edits appear in your dashboard within ~15
   seconds, marked *by &lt;agent&gt;* / *edited by &lt;agent&gt;*. Revoke it on
   the Agents page.
4. See what each agent did on **Activity** (header): a day-by-day timeline
   ("Billing Assistant marked INV-0007 as paid"), filterable by agent, kind of
   action and dates; each invoice page has a *History* section. Activity is
   recorded by the server, so only changes made while cloud sync is on are
   logged (PDFs you download in the browser are generated locally and not
   logged). Entries list which fields changed, never their contents.

To use the same workspace in another browser without an account, reveal the
**recovery key** in Settings → Cloud sync & agents → *Link another browser or
device* and paste it under *Connect existing workspace* there. Keep it secret
(it is the workspace's only credential) and never give it to an agent.

## Invoice status

Every invoice has a status: **draft**, **sent**, **paid** or **void**.
*Overdue* is not stored: an invoice is overdue when it is *sent* and its due
date is before today (the app uses your local date, the API the UTC date).
**Save Invoice** saves a new invoice as a draft; **Save & mark sent** saves
and marks it sent in one click. On the dashboard, the row menu (and the
buttons on the invoice page) mark invoices sent or paid, void them or reopen
them; filter chips show All / Draft / Outstanding / Overdue / Paid with
counts, and the totals strip shows Outstanding, Overdue and Paid this month
per currency (never added across currencies).

Invoices saved before statuses existed (1.x) are shown as **drafts**: the app
cannot know whether they were sent or paid. Allowed changes: draft → sent |
void, sent → paid | void | draft, paid → sent (undo payment) | void, void →
draft | sent (reopen). Agents use the same rules.

## Security model and known limitations

What is protected, and how:

- **Local first**: with cloud sync off the app makes no API requests (one
  exception: the screens that offer turning sync on read the public
  `GET /api/account/config` flag). Data in the browser is as safe as the
  browser profile.
- **Credentials**: every token and key is a 256-bit random secret stored only
  as a SHA-256 hash and sent only in the `Authorization` header. The workspace
  token (recovery key) grants everything in its workspace; agents get their
  own keys with only the approved scopes; OAuth access tokens only work on
  `/api/mcp`. Account and operator sessions are HttpOnly, `SameSite=Strict`
  cookies scoped to `/api/account` and `/api/operator`, with CSRF tokens; the
  invoice API never reads cookies.
- **Consent**: agents are never approved automatically; agent-supplied text is
  rendered as plain text; pages cannot be framed.
- **Browser hardening**: a strict Content-Security-Policy (scripts from this
  origin only plus the hashed theme bootstrap, no `eval`; exceptions for
  react-pdf's WebAssembly are listed in `public/_headers`), `Referrer-Policy`,
  `Permissions-Policy`, `nosniff`; API responses carry `default-src 'none'`.
- **Email**: only workspaces owned by a signed-in account may send (default);
  agents (and unattended recurring emails) can only email a client address the
  user entered, and only invoices whose sender name, email and payment details
  are the user's own or were approved by the user in "Needs your review"
  (however the invoice came to exist, recurring generation included);
  recurring emails are held when an agent changed their template, client or
  invoice; caps count recipients, per workspace (lower for new ones), agent,
  IP and site; the From address is fixed by the operator and the sender name
  is stripped of deceptive characters.
- **Agents**: revoking an agent pauses the recurring schedules it set up;
  workspaces have storage limits.
- **Operator secrets** are encrypted at rest; the console sees metadata only;
  this protects D1 exports, backups and casual database access, **not**
  someone who has both the database and the Worker's secrets.

Known limitations and caveats:

- **Not verified against the real services**: Cloudflare (deploy, Cron
  Triggers, rate limiting, D1 limits), WorkOS AuthKit, Resend and the GitHub
  Actions API are exercised only against local emulators and fakes in this
  repository (workerd + local D1, `workos dev`, fetch-level fakes).
- **Workers Free plan CPU limit** (10 ms per request): server-side PDF
  rendering (PDF downloads by agents, emails with the attached PDF) and the
  PBKDF2 key derivation of the operator console and accounts (600,000
  iterations, ~93 ms in local workerd, once per isolate) exceed it; use the
  Paid plan.
- **Rate limits are approximate**: Workers Rate Limiting is per Cloudflare
  location and eventually consistent; user-code lookups and email caps are
  counted in D1 (consistent).
- **D1 triggers**: "address entered by the user", "sender details approved by
  the user" and "changed by an agent since approval" are maintained by SQLite
  triggers in migrations `0007` and `0011`; tested locally, not on production
  D1. An approved sender value (e.g. an IBAN) is approved for the whole
  workspace, not per invoice.
- **Agent-written invoice text**: the review covers sender name, email,
  payment details and the recipient; an agent with `invoices:send` can still
  write notes and the email message of invoices it sends to the user's
  clients.
- **Email**: no bounce or complaint handling (no Resend webhooks); watch the
  Resend dashboard.
- **OAuth**: public clients only; reusing a rotated refresh token revokes the
  whole grant immediately, with no grace window (a client that retries a
  refresh after a network error is disconnected); access tokens are not
  accepted by the REST API.
- **No CORS** on `/api/v1` and `/api/mcp`: browser-based MCP clients on other
  origins cannot connect; agents call the API server-to-server.
- **Recurring invoices**: only the most recent missed period is generated after
  downtime; daily or custom cadences are not supported.
- **Accounts**: one account owns at most one workspace; no team members yet.
- The operator console's telemetry durations measure I/O wait, not CPU time.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Development

### Tests and checks

```bash
bun run test            # watch mode
bun run test:run        # once
bun run test:coverage   # with coverage
bun run lint && bun run typecheck && bun run test:run && bun run build   # same as CI
```

Tests are split into three Vitest projects: `web` (components, jsdom),
`server` (the Hono API via `app.request()` against a real local D1 in workerd)
and `workerd` (builds the app and runs the production bundle in workerd: SPA
routing, API, MCP and PDF rendering). They never use the network: WorkOS,
Resend and GitHub are faked at the fetch boundary.

CI (`.github/workflows/ci.yml`) runs install, a generated-types check, lint,
typecheck, tests, build and `wrangler deploy --dry-run` on every push and pull
request. Deploying is the separate, opt-in workflow described in
[Deploy to Cloudflare](#deploy-to-cloudflare).

### Project structure

```
worker/index.ts              # Worker entry (thin: builds deps, mounts the API, runs scheduled jobs)
server/                      # API (Hono), testable via createApp(deps)
├── app.ts, deps.ts, auth.ts # Routes, injectable dependencies, bearer auth and scopes
├── db/                      # SQL for the public API (D1), scoped by workspace
├── routes/, services/       # REST routes and use-cases shared by REST and MCP
├── mcp*.ts                  # Remote MCP server and its tools
├── openapi*.ts              # OpenAPI 3.1 document
├── oauth/                   # OAuth authorization server for MCP clients
├── email/                   # Email provider (Resend) and configuration
├── recurring/               # Recurring schedules: service, generation, job, routes, MCP
├── accounts/                # Optional user accounts (cookie-authenticated /api/account)
├── operator/                # Operator console API, settings registry, encryption, telemetry
├── pdf/                     # Server-side PDF + Vite plugin for react-pdf in workerd
└── scheduled.ts             # Cron Trigger job registry
shared/                      # Types and rules used by both the app and the API
                             # (api, activity, invoice-status, recurring, template placeholders, …)
migrations/                  # D1 migrations 0001–0010
src/
├── App.tsx, main.tsx        # Providers and routes; /operator/* loads src/operator/
├── pages/                   # Dashboard, editor, invoice, clients, templates, recurring,
│                            # agents, approve / authorize (oauth/), activity
├── components/              # invoice/ (form, preview, PDF, status, email), clients/,
│                            # templates/, activity/, agents/, sync/, ui/ (shadcn)
├── accounts/                # User accounts: API client, sign-in, /account pages
├── recurring/               # Recurring schedule dialog, badge, react-query API
├── operator/                # Operator console SPA (lazy-loaded)
├── stores/                  # Zustand stores: invoices, settings, clients, templates, cloud sync
├── lib/                     # api/ (typed client), sync/ (sync engine), helpers
└── test/                    # Test setup and in-memory API fakes
```

### Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start the app + API Worker + local D1 (workerd) |
| `bun run dev:operator` | Same, under `workos dev` (local WorkOS emulator for the operator console and accounts) |
| `bun run build` | Build the SPA and the Worker |
| `bun run preview` | Run the production build locally in workerd |
| `bun run deploy` | Build and `wrangler deploy` |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `bun run db:migrate:local` | Apply D1 migrations to the local database |
| `bun run db:migrate:remote` | Apply D1 migrations to the Cloudflare database |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Type-check with TypeScript |
| `bun run test` / `test:run` / `test:coverage` | Tests in watch mode / once / with coverage |

Architecture notes for contributors (and AI coding agents) are in
[AGENTS.md](AGENTS.md); release notes in [CHANGELOG.md](CHANGELOG.md).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.
