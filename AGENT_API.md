# Midnight Invoice Agent API

Midnight Invoice exposes a REST API (`/api/v1`) and a remote MCP server
(`/api/mcp`) so that AI agents can work with a user's invoices and saved
clients **after the user approves them**. There are no accounts: the browser app owns an anonymous
*workspace*, and agents connect to a workspace in one of three ways:

1. **OAuth** (MCP clients): paste `https://invoices.example.com/api/mcp` into
   an MCP client that supports the MCP authorization flow; the user approves it
   in the app. See [Connect with OAuth](#connect-with-oauth-mcp-clients).
2. **Device flow** (any agent, no browser needed on the agent's side), modelled
   on [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628). See
   [Connecting an agent](#connecting-an-agent).
3. **Static API key**: the `mi_agent_` key from the device flow, configured as
   a Bearer header (for MCP clients without OAuth, and for the REST API).

- Machine-readable contract: `GET /api/v1/openapi.json` (OpenAPI 3.1)
- Short pointer for crawlers/agents: `/llms.txt`
- Shared TypeScript types: [`shared/api.ts`](shared/api.ts), [`shared/types/invoice.ts`](shared/types/invoice.ts), [`shared/types/client.ts`](shared/types/client.ts)

Replace `https://invoices.example.com` below with the deployment's URL
(`http://localhost:8080` under `bun run dev`).

## Credentials

| Credential | Prefix | Who holds it | Grants |
|---|---|---|---|
| Workspace token | `mi_ws_` | The browser app (the user) | Everything in the workspace, incl. approving/revoking agents, settings writes, deleting the workspace |
| Device code | `mi_dc_` | An agent during registration | Only polling `POST /agents/token` |
| Agent API key | `mi_agent_` | An approved agent | The scopes the user approved |
| OAuth access token | `mi_at_` | An MCP client connected with OAuth | The approved scopes, **only at `POST /api/mcp`** (1 hour) |
| OAuth refresh token | `mi_rt_` | An MCP client connected with OAuth | New access tokens at `POST /api/oauth/token` (rotated on every use, 30 days) |
| Authorization code | `mi_ac_` | Briefly, an MCP client | One token exchange (single use, 2 minutes) |

All are 256-bit random secrets (base64url), returned **once**, stored
only as SHA-256 hashes. Send them as `Authorization: Bearer <secret>`.

A workspace can have more than one workspace token: when the site has optional
user accounts, every signed-in browser gets its own `mi_ws_` token for the
account's workspace, revocable on its own, besides the original token (the
recovery key, which the owner may rotate or turn off). They are
indistinguishable to the API and grant the same. Signing in, devices and
recovery-key management are browser-only, cookie-authenticated endpoints under
`/api/account` that are **not** part of this API; agents never need them and
must never ask a user for a workspace token.

### Scopes

| Scope | Allows |
|---|---|
| `invoices:read` | List/get invoices, next invoice number, PDF download |
| `invoices:write` | Create (POST/PUT) and update (PUT/PATCH) invoices, change their status |
| `invoices:delete` | Delete invoices |
| `settings:read` | Read the default sender settings |
| `clients:read` | List/search/get saved clients; bill an invoice to a saved client (`clientId`) |
| `clients:write` | Create, update, archive and delete saved clients |
| `templates:read` | List/search/get invoice templates; with `invoices:write`, create invoices from a template |
| `templates:write` | Create, update, archive and delete invoice templates |
| `activity:read` | Read this agent's **own** entries of the [activity log](#activity-log) (`GET /activity`, `get_my_activity`) |
| `invoices:send` | Email an invoice (PDF attached) to the client on file; sending a draft marks it sent. Sensitive: real email to real people |
| `recurring:read` | List/get [recurring schedules](#recurring-invoices) and their upcoming dates (the preview also needs `templates:read`) |
| `recurring:write` | Create, update, pause, resume, run now and delete recurring schedules. Creating, changing, resuming or running one also needs `invoices:write` + `templates:read` (+ `clients:read` when the schedule or its template bills a saved client). Never automatic emailing (see below) |

There is no separate `clients:delete`: deleting a client is a soft delete of
address-book data that never touches invoices (they keep their own copy of the
client's details), and `clients:write` can already blank every field of a
client, so a separate scope would not protect anything. Scopes are never added
to existing agents: an agent approved before clients existed keeps exactly the
scopes it was granted and must register again to get client access. The
same holds for `templates:read` / `templates:write` (write includes delete,
for the same reason as clients: deleting a template never touches the
invoices made from it).
The same holds for `invoices:send`: no existing agent can send email until
the user approves a new registration that asks for it.

Settings writes, agent management and workspace deletion require the workspace
token; no scope grants them. Neither does choosing automatic emailing for a
recurring schedule (`autoAction: "send_email"`): only the user can turn it on.

## Connect with OAuth (MCP clients)

The MCP endpoint implements the [MCP authorization spec, revision
2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
OAuth 2.1 with PKCE, protected-resource metadata (RFC 9728), authorization
server metadata (RFC 8414), Client ID Metadata Documents and dynamic client
registration (RFC 7591), resource indicators (RFC 8707) and `iss` in
authorization responses (RFC 9207). The same Worker is the authorization
server. For the user it is: paste the URL into the MCP client, approve in the
browser, done.

### Discovery

| What | URL |
|---|---|
| MCP endpoint (the protected resource) | `https://invoices.example.com/api/mcp` |
| Protected resource metadata | `/.well-known/oauth-protected-resource/api/mcp` (also at `/.well-known/oauth-protected-resource`) |
| Authorization server metadata (issuer = the origin) | `/.well-known/oauth-authorization-server` |
| Authorization endpoint (browser) | `GET /api/oauth/authorize` |
| Token endpoint | `POST /api/oauth/token` (form-encoded) |
| Dynamic client registration | `POST /api/oauth/register` (JSON) |
| Revocation (RFC 7009) | `POST /api/oauth/revoke` (form-encoded) |

These OAuth endpoints are outside `/api/v1` and are described by the metadata
documents (which is what OAuth clients read), not by the OpenAPI document; the
OpenAPI document points to them under `x-oauth`. Every `401` from `/api/mcp`
carries `WWW-Authenticate: Bearer realm="midnight-invoice", resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`.
The metadata and the token/register/revoke endpoints allow CORS (`*`, no
cookies); the consent API below does not.

### Example flow

```bash
BASE=https://invoices.example.com

# 1. Register a public client (or use a Client ID Metadata Document URL as client_id)
curl -s -X POST $BASE/api/oauth/register -H 'content-type: application/json' -d '{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://127.0.0.1:33418/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none"
}'
# → 201 {"client_id":"mi_client_…","token_endpoint_auth_method":"none",…}   (never a client secret)
```

2. Send the user's browser to the authorization endpoint (PKCE `S256` and
   `resource` are required):

```
https://invoices.example.com/api/oauth/authorize?response_type=code&client_id=mi_client_…
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A33418%2Fcallback&state=xyz
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256
  &scope=invoices%3Aread%20invoices%3Awrite&resource=https%3A%2F%2Finvoices.example.com%2Fapi%2Fmcp
```

   The user reviews the request at `/agents/authorize`, may untick
   permissions, and approves. The browser then goes to
   `http://127.0.0.1:33418/callback?code=mi_ac_…&state=xyz&iss=https%3A%2F%2Finvoices.example.com`.

3. Exchange the code, then use and refresh the token:

```bash
curl -s -X POST $BASE/api/oauth/token -d grant_type=authorization_code -d code=mi_ac_… \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  -d redirect_uri=http://127.0.0.1:33418/callback -d client_id=mi_client_… \
  -d resource=https://invoices.example.com/api/mcp
# → {"access_token":"mi_at_…","token_type":"Bearer","expires_in":3600,"refresh_token":"mi_rt_…","scope":"invoices:read invoices:write"}

curl -s -X POST $BASE/api/oauth/token -d grant_type=refresh_token -d refresh_token=mi_rt_… -d client_id=mi_client_…
```

An MCP client SDK with OAuth support does all of this from the URL alone (the
official TypeScript SDK is tested against it in `server/oauth-interop.test.ts`).

### Rules

- **Clients**: public clients only (`token_endpoint_auth_method: "none"`; a
  requested secret-based method is replaced by `none`, and token requests
  carrying a client secret are rejected). Redirect URIs: `https:`, `http:` only
  on loopback (`127.0.0.1`, `[::1]`, `localhost`), or a native app's custom
  scheme (`com.example.app:/cb`); never `javascript:`, `data:`, `file:` and
  similar, never a fragment or user info; at most 10. Matching is exact, except
  that a loopback IP redirect URI may use any port (RFC 8252 §7.3). A
  registration never used for a token exchange is deleted after 24 hours.
- **Client ID Metadata Documents**: a `client_id` that is an `https://` URL
  with a path is fetched by the server (redirects are not followed, 5 KB / 5 s
  cap, DNS host names only: no IP literals, `localhost`, single-label or
  internal names, default port only) and must contain `client_id` equal to its
  URL, `client_name` and `redirect_uris`. It is cached per its `Cache-Control`
  (5 minutes to 24 hours).
- **Authorization requests**: `response_type=code`, PKCE `S256` (`plain` and
  missing PKCE are refused), `resource` = the MCP endpoint (required; a
  trailing slash and host case are tolerated). `scope` takes the
  [scopes](#scopes); unknown extra scopes (`openid`, `offline_access`, …) are
  ignored, and a request without `scope` asks for the defaults `invoices:read
  invoices:write settings:read clients:read` (destructive permissions must be
  asked for explicitly). `prompt=none` gets `consent_required`: approval always
  needs the user. If the client or redirect URI is unknown the browser is
  **not** redirected (the app shows an error); every other error is redirected
  to the client with `error`, `error_description`, `state` and `iss`. A request
  must be answered within 10 minutes.
- **Codes**: single use, 2 minutes, bound to client, redirect URI, PKCE
  challenge, resource and the approving workspace. A second use of a code
  revokes the tokens issued for it.
- **Tokens**: opaque and hashed. Access tokens live 1 hour and are
  audience-bound to the MCP endpoint they were issued for (`resource`): the REST
  API (`/api/v1`, which keeps using API keys) rejects them, and so does the same
  server reached under another public URL. Refresh tokens are issued when the
  client registered the `refresh_token` grant, live 30 days and rotate on every
  use; a refresh may narrow `scope`, never widen it. **Reusing** an already
  rotated refresh token revokes the whole grant (every access and refresh token
  issued from that authorization).
- **Revocation**: `POST /api/oauth/revoke` with `token` and `client_id`
  (always `200`); a refresh token revokes its whole grant, an access token only
  itself.

### Agents and consent

An approved OAuth client becomes an **agent** of the workspace, exactly like a
device-flow agent: `GET /api/v1/agents` lists it with `connection: "oauth"`,
its name is the client's `client_name`, invoice changes are attributed to it,
tools are listed by its scopes, and `DELETE /api/v1/agents/:id` revokes it,
which kills its access and refresh tokens immediately. Authorizing the same
client again for the same workspace updates that agent (its scopes become the
newly approved ones, which also narrows older tokens) instead of adding a
second one; after a revoke it creates a new agent.

The consent screen (`/agents/authorize?request=…`) uses three endpoints that
require the **workspace token** (documented in the OpenAPI document):
`GET /api/v1/oauth/requests/:request_id`, `POST …/approve` (optional
`{"scopes": [...]}`, a non-empty subset of the requested scopes) and
`POST …/deny`. Both decisions answer `{"status", "redirectTo"}` and the app
sends the browser there. Why this is safe:

- The workspace token never leaves the app except in the `Authorization`
  header of same-origin `/api/v1` requests; it is never in a URL, cookie or
  redirect. The request id in the consent URL is not a credential.
- No CSRF: the decision endpoints need that header, which browsers never add
  on their own; they send no CORS headers (so a cross-site page cannot get a
  preflight for `Authorization`) and only accept JSON.
- No open redirect: the browser is only ever sent to a redirect URI registered
  for the client and matched at `/authorize`; the server builds the target and
  the app additionally checks it is the redirect URI it showed.
- No code injection or mix-up: codes are bound to the client, redirect URI and
  PKCE verifier, single use and short-lived, and every authorization response
  carries `iss` (advertised with `authorization_response_iss_parameter_supported`).
- No clickjacking: app pages are sent with `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`.
- The client's name, homepage and redirect host are shown as untrusted text,
  with an extra warning when access goes to a program on the device (loopback
  or custom-scheme redirect). Nothing is approved automatically.

## Connecting an agent

```bash
BASE=https://invoices.example.com

# 1. Register (unauthenticated, rate limited)
curl -s -X POST $BASE/api/v1/agents/register \
  -H 'content-type: application/json' \
  -d '{"name":"Claude Desktop","description":"Drafts monthly invoices","scopes":["invoices:read","invoices:write","settings:read"]}'
```

```json
{
  "registration_id": "6f0c…",
  "device_code": "mi_dc_Q2x…",
  "user_code": "WDJB-MJHT",
  "verification_url": "https://invoices.example.com/agents/approve",
  "verification_url_complete": "https://invoices.example.com/agents/approve?code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```

2. Show the user the `user_code` and `verification_url_complete`. In the app
   they see your name, description and requested scopes, and approve (possibly
   with fewer scopes) or deny.

3. Poll until approved, waiting `interval` seconds between requests:

```bash
curl -s -X POST $BASE/api/v1/agents/token \
  -H 'content-type: application/json' \
  -d '{"device_code":"mi_dc_Q2x…"}'
```

While waiting: HTTP 400 `{"error":{"code":"authorization_pending",…}}`.
On approval (returned **exactly once**):

```json
{
  "api_key": "mi_agent_k3J…",
  "token_type": "Bearer",
  "agent": { "id": "a1b2…", "name": "Claude Desktop", "scopes": ["invoices:read", "invoices:write"], "workspace_id": "9f8e…" }
}
```

| `error.code` (HTTP 400) | Meaning | What to do |
|---|---|---|
| `authorization_pending` | User has not decided yet | Keep polling every `interval` s |
| `slow_down` | Polled faster than `interval` | Add 5 s to your interval |
| `access_denied` | User denied | Stop |
| `expired_token` | Registration expired (10 min) | Register again |
| `invalid_grant` | Unknown device code, or already exchanged | Stop; register again if you lost the key |

4. Use the key: `curl -H "Authorization: Bearer mi_agent_k3J…" $BASE/api/v1/agents/me`.
   The user can revoke it at any time; revoked keys get `401` immediately.

## REST endpoints

All bodies are JSON (`Content-Type: application/json`). Errors always look like
`{"error":{"code":"…","message":"…","details":…}}`.

| Method | Path | Auth | Scope | Notes |
|---|---|---|---|---|
| GET | `/api/v1/health` | none | | `{status:"ok",time}` |
| GET | `/api/v1/openapi.json` | none | | OpenAPI 3.1 |
| POST | `/api/v1/workspaces` | none (rate limited) | | → 201 `{workspace:{id,createdAt},token}` |
| GET | `/api/v1/workspace` | workspace token | | `{workspace}` |
| DELETE | `/api/v1/workspace` | workspace token | | 204; deletes all invoices, clients, settings, agents and activity |
| POST | `/api/v1/agents/register` | none (rate limited) | | → 201, see above |
| POST | `/api/v1/agents/token` | none (rate limited) | | see above |
| GET | `/api/v1/agents/registrations/:user_code` | workspace token | | Preview `{registration:{id,userCode,name,description,requestedScopes,createdAt,expiresAt}}` |
| POST | `/api/v1/agents/registrations/:user_code/approve` | workspace token | | Body optional `{scopes}` ⊆ requested → `{registration:{id,status:"approved",scopes}}` |
| POST | `/api/v1/agents/registrations/:user_code/deny` | workspace token | | `{registration:{id,status:"denied"}}` |
| GET | `/api/v1/agents` | workspace token | | `{agents:[{id,name,description,scopes,createdAt,lastUsedAt,revokedAt}]}` (revoked included) |
| GET | `/api/v1/agents/me` | agent key | | `{agent:{id,name,description,scopes,workspace_id,createdAt}}` |
| DELETE | `/api/v1/agents/:id` | workspace token | | 204, immediate, idempotent |
| GET | `/api/v1/activity` | workspace token, or agent key | `activity:read` (agent: own entries only) | [Activity log](#activity-log), newest first |
| GET | `/api/v1/agents/:id/activity` | workspace token, or that agent's key | `activity:read` for agents | Entries by or about one agent |
| GET | `/api/v1/invoices` | any | `invoices:read` | Sync feed, see below |
| POST | `/api/v1/invoices` | any | `invoices:write` | → 201 `{invoice}` + `ETag`, `Location` |
| GET | `/api/v1/invoices/next-number` | any | `invoices:read` | `{invoiceNumber:"INV-0007"}` |
| GET | `/api/v1/invoices/summary` | any | `invoices:read` | Counts and totals per currency, see [Status](#invoice-status) |
| POST | `/api/v1/invoices/:id/mark-sent` | any | `invoices:write` | Optional body `{sentAt}`; `If-Match` → `{invoice}` + `ETag` |
| POST | `/api/v1/invoices/:id/mark-paid` | any | `invoices:write` | Optional body `{paidAt}`; `If-Match` → `{invoice}` + `ETag` |
| POST | `/api/v1/invoices/:id/void` | any | `invoices:write` | `If-Match` → `{invoice}` + `ETag` |
| POST | `/api/v1/invoices/:id/reopen` | any | `invoices:write` | `If-Match` → `{invoice}` + `ETag` |
| GET | `/api/v1/invoices/:id` | any | `invoices:read` | `{invoice}` + `ETag`; 410 if deleted |
| PUT | `/api/v1/invoices/:id` | any | `invoices:write` | Create-or-replace with client UUID → 201/200 |
| PATCH | `/api/v1/invoices/:id` | any | `invoices:write` | Partial update → 200 |
| DELETE | `/api/v1/invoices/:id` | any | `invoices:delete` | Soft delete → 204 |
| GET | `/api/v1/clients` | any | `clients:read` | Search (`q`) and sync feed, see [Clients](#clients) |
| POST | `/api/v1/clients` | any | `clients:write` | → 201 `{client}` + `ETag`, `Location` |
| GET | `/api/v1/clients/:id` | any | `clients:read` | `{client}` + `ETag`; 410 if deleted |
| PUT | `/api/v1/clients/:id` | any | `clients:write` | Create-or-replace with client UUID → 201/200 |
| PATCH | `/api/v1/clients/:id` | any | `clients:write` | Partial update (e.g. `{"archivedAt": "…"}`) → 200 |
| DELETE | `/api/v1/clients/:id` | any | `clients:write` | Soft delete → 204 (invoices unchanged) |
| GET | `/api/v1/templates` | any | `templates:read` | Search (`q`: name or description) and sync feed, see [Templates](#templates) |
| POST | `/api/v1/templates` | any | `templates:write` | → 201 `{template}` + `ETag`, `Location` |
| GET | `/api/v1/templates/:id` | any | `templates:read` | `{template}` + `ETag`; 410 if deleted |
| PUT | `/api/v1/templates/:id` | any | `templates:write` | Create-or-replace with client UUID → 201/200 |
| PATCH | `/api/v1/templates/:id` | any | `templates:write` | Partial update (lineItems replaces the list) → 200 |
| DELETE | `/api/v1/templates/:id` | any | `templates:write` | Soft delete → 204 (invoices unchanged) |
| POST | `/api/v1/templates/:id/instantiate` | any | `invoices:write` + `templates:read` | Optional overrides → 201 `{invoice, template, placeholders, warnings}`, see [Creating an invoice from a template](#creating-an-invoice-from-a-template) |
| POST | `/api/v1/invoices/:id/send` | any | `invoices:send` | Email the invoice with its PDF; optional `Idempotency-Key`; see [Sending invoices by email](#sending-invoices-by-email) |
| GET | `/api/v1/invoices/:id/emails` | any | `invoices:read` | `{emails:[…], delivery:{configured,fromAddress,fromName,pdfTheme,cooldownMinutes}}` (newest first) |
| GET | `/api/v1/invoices/:id/pdf` | any | `invoices:read` | `application/pdf`, styled like the app's invoice preview; optional `?theme=light\|dark` (default `dark`, the app default; anything else → 400) |
| GET | `/api/v1/settings` | any | `settings:read` | `{settings,updatedAt}` (defaults + `updatedAt:null` if never saved) |
| PUT | `/api/v1/settings` | workspace token | | Body = settings object → `{settings,updatedAt}` |
| POST | `/api/mcp` | any | per tool | MCP Streamable HTTP; GET/DELETE → 405 |

"any" = workspace token or agent key.

### Invoices

Request body for `POST` and `PUT` (`InvoiceInput`): the app's invoice fields,
all optional except `lineItems` and `toName` (`toName` may be omitted when
`clientId` names a saved client, see [Billing a saved client](#billing-a-saved-client)):

```json
{
  "toName": "Globex", "toEmail": "ap@globex.example", "toAddress": "1 Main St",
  "lineItems": [{ "description": "Consulting", "quantity": 10, "price": 120 }],
  "dueDate": "2026-12-31", "notes": "Thanks!"
}
```

Defaults on create (POST and PUT): `fromName`, `fromAddress`, `fromEmail`,
`currency`, `taxRate`, `paymentDetails` come from workspace settings;
`issueDate` = today (UTC, `YYYY-MM-DD`); `dueDate`, `notes`, `toAddress`,
`toEmail` = `""`; line-item `id`s are generated; a missing `invoiceNumber`
is allocated atomically as `INV-` + (highest number among live invoices + 1),
zero-padded to 4 digits — the same rule as the app. After defaults the invoice
must pass the app's own form validation (e.g. `fromName` non-empty).

Limits: names 200 chars, addresses 1000, emails 254, notes/payment details
5000, line-item description 1000, invoice number 64, 1–200 line items,
quantity ≤ 1e9, price ≤ 1e12, taxRate 0–100, currency from the app's ISO 4217
list, dates `YYYY-MM-DD`, invoice bodies ≤ 256 KiB, registration/token bodies
≤ 4 KiB. Unknown fields are ignored, so a full response object can be sent back.

Response (`ApiInvoice`) = the app's `Invoice` plus server fields:

```json
{
  "id": "1b9d…", "invoiceNumber": "INV-0001", "issueDate": "2026-11-17", "currency": "EUR",
  "lineItems": [{ "id": "…", "description": "Consulting", "quantity": 10, "price": 120 }],
  "…": "…",
  "version": 1,
  "createdAt": "2026-11-17T10:00:00.000Z",
  "updatedAt": "2026-11-17T10:00:00.000Z",
  "deletedAt": null,
  "revision": 1,
  "createdBy": { "type": "agent", "agentId": "a1b2…", "agentName": "Claude Desktop" },
  "updatedBy": { "type": "user" },
  "subtotal": 1200, "taxAmount": 228, "total": 1428
}
```

Invoices billed to a saved client also carry `"clientId": "<uuid>"` (absent
otherwise).

Totals: `subtotal = Σ quantity × price`, `taxAmount = subtotal × taxRate / 100`,
`total = subtotal + taxAmount`, each rounded to 2 decimals.

### Invoice status

`ApiInvoice` also has `status` (`draft | sent | paid | void`), `sentAt` and
`paidAt` (`YYYY-MM-DD` or `null`) and the derived, never stored, `isOverdue`
and `daysOverdue`.

- **Overdue** = status `sent` and `dueDate` strictly before today. The server
  uses the **UTC** date (the app uses the user's local date, so around
  midnight they can differ by a day). Due today is not overdue; no due date is
  never overdue. `daysOverdue` = whole days since `dueDate`, 0 otherwise.
- **Old invoices** (saved before statuses existed, locally or on the server)
  have no stored status and read as `draft`: nothing says they were sent, and
  calling them `sent` would report long-paid invoices as overdue.
- **Dates**: `sentAt` is set when an invoice becomes `sent` (default today),
  `paidAt` iff it is `paid` (default today); `draft` clears both; `void`
  clears `paidAt` and keeps `sentAt`.
- **Transitions** (one shared function, `shared/invoice-status.ts`, also used
  by the app): draft → sent | void; sent → paid | void | draft; paid → sent
  (undo payment) | void; void → draft | sent. Setting the current status again
  is a no-op (same revision). Anything else is `409 invalid_status_transition`
  with `details: {from, to|action, allowed}`.
- **Endpoints**: `mark-sent` (drafts), `mark-paid` (sent invoices; optional
  `paidAt`), `void` (anything not void), `reopen` (paid → sent; void → sent if
  it had been sent, else draft). They honour `If-Match` like PATCH.
- **Writes**: `POST`/`PUT`-create accept `status`, `sentAt`, `paidAt` (default
  `draft`). `PATCH` with `status` enforces the transitions. `PUT` replace is a
  full-state write used by sync and accepts any status (a series of offline
  changes arrives as one PUT); an omitted `status` keeps the current one.
- **Filters on `GET /invoices`** (combine with the sync parameters below):
  `status=sent,overdue` (comma list, OR; `overdue` is virtual and `sent`
  includes overdue invoices), `due_before=YYYY-MM-DD` / `due_after=…` (strict;
  invoices without a due date never match), `client=` (case-insensitive
  substring of `toName`), `client_id=<uuid>` (invoices billed to that saved client, exact `clientId`; `invoices:read` is enough).
- **`GET /invoices/summary`** (`?oldest_overdue_limit=0..50`, default 5):

```json
{
  "asOf": "2026-11-17",
  "currencies": [
    { "currency": "EUR",
      "draft": { "count": 1, "total": 10 }, "outstanding": { "count": 1, "total": 100 },
      "overdue": { "count": 1, "total": 220 }, "paidThisMonth": { "count": 1, "total": 300 },
      "paidThisYear": { "count": 2, "total": 700 } }
  ],
  "oldestOverdue": [
    { "id": "…", "invoiceNumber": "INV-0003", "toName": "Globex", "currency": "EUR", "total": 220, "dueDate": "2026-11-01", "daysOverdue": 16 }
  ]
}
```

  Amounts are grouped by currency and never summed across currencies;
  `outstanding` = sent and not overdue; paid buckets use `paidAt`; void and
  deleted invoices are excluded.
### Billing a saved client

`POST`, `PUT` and `PATCH /invoices` accept `clientId` (a saved client's id).
The invoice still stores its own copy of the client's details: editing or
deleting the client later never changes existing invoices.

```bash
# "Invoice Globex for 10 hours": find the client, then bill it by id.
curl -s "$BASE/api/v1/clients?q=globex" -H "Authorization: Bearer $KEY"
curl -s -X POST $BASE/api/v1/invoices -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"clientId":"5c1e…","lineItems":[{"description":"Consulting","quantity":10,"price":120}]}'
```

Omitted fields are filled in this order (first that applies wins; a field
sent as `""` counts as given):

| Field | 1. Request | 2. Saved client | 3. Workspace settings | 4. Fallback |
|---|---|---|---|---|
| `toName`, `toAddress`, `toEmail` | value sent | client `name`, `address`, `email` | | `""` |
| `currency` | value sent | `defaultCurrency` | `settings.currency` | `USD` |
| `taxRate` | value sent | `defaultTaxRate` | `settings.taxRate` | `0` |
| `dueDate` | value sent | `issueDate` + `paymentTermsDays` | | `""` |

Sender fields and `paymentDetails` come from settings as before.

Rules:
- Setting or changing `clientId` requires `clients:read` (403
  `insufficient_scope` otherwise) and a live client of the same workspace;
  otherwise 400 `validation_failed` with `details: [{path: "clientId", …}]`
  ("No client with this id exists in this workspace" / "This client was
  deleted"). A client of another workspace is indistinguishable from an
  unknown one.
- An unchanged `clientId` (the invoice already had it) is never re-checked,
  so old invoices stay editable after their client is deleted and agents
  without `clients:read` can edit invoices that carry one.
- `PUT` is a full replace: omitting `clientId` removes the reference.
- `PATCH` with a *different* `clientId` refills the `to*` fields the patch
  omits from the new client; it never changes currency, tax rate or due date
  of an existing invoice. `PATCH {"clientId": null}` unlinks (details kept).

### Sending invoices by email

`POST /api/v1/invoices/:id/send` emails the invoice to the client with the
PDF attached. It needs the `invoices:send` scope (the workspace token has it;
existing agents do not). The body is optional:

```bash
curl -X POST "$BASE/api/v1/invoices/$ID/send" \
  -H "Authorization: Bearer $MI_AGENT_KEY" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"ccMe": true, "message": "Thanks for the project!"}'
# → 200 {"email": {...}, "invoice": {...}, "statusChanged": true, "replayed": false}
```

| Field | Default | Rules |
|---|---|---|
| `to` | the invoice `toEmail` | Workspace token: any deliverable address. **Agents: must be the invoice `toEmail`.** |
| `cc` | `[]` | Workspace token: up to 3 addresses. Agents: only the workspace `fromEmail` (settings). |
| `ccMe` | `false` | Adds the workspace `fromEmail` (settings) to cc |
| `subject` | `Invoice <number> from <fromName>` | One line of plain text, ≤ 200 characters; CR/LF and control characters → 400 |
| `message` | greeting with number, total and due date | Plain text ≤ 2000 characters, replaces the greeting; never HTML (escaped in the HTML part). Invoice number, amount due and due date are always appended. |
| `theme` | server setting (`light`) | Theme of the attached PDF |

Unknown fields (`from`, `replyTo`, `html`, `bcc`, …) are rejected with 400.

- **From / Reply-To.** From is always the server's sending address (set by the
  site operator), with display name `"<invoice fromName> via Midnight Invoice"`;
  Reply-To is the invoice `fromEmail`, so replies reach the sender. Nobody can
  choose the From address.
- **Agents** may only email the invoice's `toEmail`, and only an address the
  **user entered themselves**: an address that was the email of a saved client
  or the `toEmail` of an invoice when the user (workspace token: the app) saved
  that record, or an address this workspace has emailed before. This is
  tracked per address, not per record: an agent editing another field of a
  client or invoice does not un-confirm its address, an address an agent wrote
  (its own new invoice or client, or its edit of an email field) is not
  confirmed, and the user saving that record afterwards confirms it. Otherwise
  `403 recipient_not_allowed` (`details.reason: "address_not_confirmed_by_user"`).
  Always confirm with the user before sending.
- **Sender review (agents).** If an agent created the invoice or changed its
  `fromName`, `fromEmail` or `paymentDetails`, and the user has not saved the
  invoice since, an agent can send it only while those three fields equal the
  workspace defaults (settings, which agents cannot change); payment details
  may also equal those of the template the invoice was created from, when the
  user saved that template last (an agent-edited template, or payment details
  the agent passed when instantiating, do not count). Otherwise
  `403 invoice_needs_review` (`details.fields`): ask the user to open the
  invoice in the app and save it (or send it themselves). This stops an agent
  from redirecting a payment or replies and then emailing the client.
- **Status.** A `draft` becomes `sent` (`sentAt` = today, UTC; same transition
  as `mark-sent`, no `invoices:write` needed) and `statusChanged` is `true`.
  Sending a `sent` or `paid` invoice again is a resend: the status does not
  change. `void` invoices → `409 invalid_status_transition`.
- **Limits** (all configurable by the site operator; defaults): 10 minutes
  between two sends of the same invoice, 20 sends/hour and 50/day per
  workspace, 5/hour and 20/day per agent, 500/day for the whole site. Over a
  limit → `429 rate_limited` with `details.reason` (`invoice_cooldown`,
  `workspace_hourly_limit`, `workspace_daily_cap`, `agent_hourly_limit`,
  `agent_daily_cap`, `site_daily_cap`), `details.retryAfterSeconds` and
  `Retry-After`. Obviously undeliverable addresses (malformed, `example.com`,
  `.test`, `.invalid`, `.local`, IP literals) → 400 without contacting the provider.
- **Idempotency.** Send `Idempotency-Key` (1–255 printable ASCII). Repeating
  the request with the same key and body returns the first result with
  `replayed: true` (header `Idempotent-Replayed: true`) and never sends twice;
  the same key with another body → `409 idempotency_conflict`. A key whose
  attempt failed can be retried: the server tries again with the same
  provider-side key.
- **Failures.** If the provider refuses or fails, the attempt is recorded and
  the answer is `502 email_send_failed` with `details: {reason, retryable,
  email}` (`reason`: `provider_auth_failed`, `provider_rejected`,
  `provider_rate_limited`, `provider_unavailable`, `provider_unreachable`,
  `attachment_too_large`, `pdf_render_failed`). The invoice status is not changed.
- **Not configured.** Without a provider key or sending address on the server:
  `503 email_not_configured`. `GET /invoices/:id/emails` tells you in advance
  (`delivery.configured`).
- `GET /api/v1/invoices/:id/emails` (`invoices:read`) lists the attempts
  (`{id, to, cc, subject, status: "queued"|"sent"|"failed", error, sentBy,
  statusChanged, createdAt, sentAt}`), newest first, max 50. Message bodies are
  not stored. Delivery events (bounces, complaints) are not tracked yet.

### Clients

A saved client (`ApiClientRecord`):

```json
{
  "id": "5c1e…", "name": "Globex Corporation", "email": "ap@globex.example", "address": "1 Globex Way\nSpringfield",
  "defaultCurrency": "EUR", "defaultTaxRate": null, "paymentTermsDays": 30, "notes": "", "archivedAt": null,
  "createdAt": "…", "updatedAt": "…", "deletedAt": null, "revision": 2,
  "createdBy": { "type": "user" }, "updatedBy": { "type": "agent", "agentId": "…", "agentName": "Claude Desktop" },
  "invoiceCount": 3
}
```

- Body of `POST`/`PUT` (`ClientInput`): only `name` is required; `email`,
  `address`, `notes` default to `""`, `defaultCurrency`/`defaultTaxRate`/
  `paymentTermsDays` to `null` (= no client default), `archivedAt` to `null`.
  Limits: name 200, email 254 (valid address or `""`), address 1000, notes
  5000, tax rate 0–100, payment terms 0–3650 whole days, currency from the
  app's ISO 4217 list. Bodies ≤ 32 KiB. Unknown fields are ignored.
- `notes` are private to the user and never printed on invoices.
- **Archive** with `PATCH {"archivedAt": "<ISO time>"}` (`null` to undo):
  archived clients stay listed (with `archivedAt` set) and usable, but the
  app hides them from its client picker. **Delete** is a soft delete.
- `invoiceCount` (live invoices referencing the client) is only included for
  credentials that also have `invoices:read`, and never on tombstones.
- `GET /clients?q=globex` matches a case-insensitive substring of name or
  email. The list follows exactly the same feed contract as `GET /invoices`
  below (`updated_since`, `after_id`, `include_deleted`, `limit`,
  `{clients, syncedAt, hasMore, next}`), and clients have the same revision,
  ETag, `If-Match`/`If-None-Match: *`, tombstone and `410` rules.

### Templates

A template (`ApiTemplate`) is a reusable invoice blueprint:

```json
{
  "id": "9b2f…", "name": "Monthly retainer", "description": "Design retainer, billed on the 1st",
  "clientId": "5c1e…", "invoiceNamePattern": "Retainer {{month_name}} {{year}}",
  "lineItems": [{ "id": "…", "description": "Design retainer – {{prev_month_name}} {{prev_month_year}}", "quantity": 1, "price": 2500 }],
  "taxRate": null, "currency": null, "paymentTermsDays": 14,
  "notes": "Thank you, {{client_name}}! Reference {{invoice_number}}.", "paymentDetails": "",
  "archivedAt": null, "createdAt": "…", "updatedAt": "…", "deletedAt": null, "revision": 1,
  "createdBy": { "type": "user" }, "updatedBy": { "type": "user" }
}
```

- Body of `POST`/`PUT` (`TemplateInput`): only `name` is required. "Not
  set" is `null` for `clientId`, `taxRate`, `currency`, `paymentTermsDays`
  and `""` for the text fields; unset values fall through to the client's
  defaults and the workspace settings when an invoice is created. Limits:
  name 200, description 1000, invoice name 200, 0–200 line items (description
  1–1000), notes/payment details 5000, tax 0–100, terms 0–3650 days. Bodies ≤
  256 KiB. Line ids are generated when omitted.
- `clientId`, when set or changed, must name a live client of the workspace
  and needs `clients:read` (like invoices). An unchanged reference is never
  re-checked, so a template stays editable after its client is deleted.
- Archive with `PATCH {"archivedAt": "…"}` (hidden from the app's
  pickers); delete is a soft delete. Same feed, revision, ETag,
  `If-Match`/`If-None-Match: *`, tombstone and `410` rules as clients.

#### Placeholders

Text in a template's invoice name, line descriptions and notes may contain
`{{month}}` (03), `{{month_name}}` (March), `{{prev_month_name}}` (February), `{{prev_month_year}}` (year of the previous month), `{{year}}`, `{{quarter}}` (Q1), `{{client_name}}` (the Bill To name) and `{{invoice_number}}`. They are resolved when an invoice is created, against its **issue
date** (a calendar date, so no time zone can shift the month). Only these
exact lowercase names are replaced (`{{ month_name }}` with spaces is fine);
nothing is ever evaluated. Unknown names (`{{Month}}`, `{{monthname}}`) and
known ones without a value (`{{client_name}}` on an invoice with no Bill To
name) are left in the text as typed and reported. Payment details are copied
as typed.

### Creating an invoice from a template

```bash
curl -X POST "$BASE/api/v1/templates/$TEMPLATE_ID/instantiate" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"issueDate": "2026-12-01"}'
# → 201 {"invoice": {…"status": "draft", "templateId": "9b2f…", "invoiceName": "Retainer December 2026",
#        "dueDate": "2026-12-15", "lineItems": [{"description": "Design retainer – November 2026", …}]…},
#        "template": {"id": "9b2f…", "name": "Monthly retainer", "revision": 1},
#        "placeholders": {"unknown": [], "unresolved": []}, "warnings": []}
```

- Requires `invoices:write` **and** `templates:read` (plus `clients:read` when
  the invoice is billed to a saved client, as for any invoice). With
  `invoices:read` too, `{{invoice_number}}` uses the number the invoice gets;
  without it (and without an explicit `invoiceNumber`) it stays as typed and a
  warning says why.
- The body is optional: any `InvoicePatch` field (status, sentAt, paidAt and
  templateId are ignored). **Precedence for every field: explicit request
  value → template → client defaults → workspace settings.**
  - `clientId`: request (`null` = no saved client) → the template's client.
    If the template's client was deleted it is skipped with a warning.
  - `lineItems`: request (replaces all template lines, used as given) →
    template lines (with fresh ids).
  - `dueDate`: request → issue date + template `paymentTermsDays` → issue
    date + client terms → none.
  - `taxRate`, `currency`: request → template → client default → settings.
    `paymentDetails`: request → template → settings. `notes`,
    `invoiceName`: request → template → none.
  - Values given in the request are used verbatim (placeholders are only
    resolved in template text).
- The invoice is always a **draft**, an independent snapshot that records
  `templateId`: editing or deleting the template never changes it.
  `templateId` on `POST/PUT/PATCH /invoices` is only that reference (used by
  sync); it does not apply a template.
- A template without line items needs `lineItems` in the request (400
  otherwise).
### Recurring invoices

A schedule generates an invoice from a [template](#templates) on every run
date, on the server (the browser may be closed). Schedules are server state:
the app needs cloud sync for them, and generated invoices reach browsers
through the normal invoice sync.

```bash
# "Bill Globex the usual retainer on the 1st of every month, Berlin time"
curl -X POST "$BASE/api/v1/recurring" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Globex retainer","templateId":"9b2f…","clientId":"c1a…","frequency":"monthly",
       "startDate":"2026-12-01","timezone":"Europe/Berlin"}'
# → 201 {"recurring":{…,"status":"active","nextRunDate":"2026-12-01",
#        "summary":"Every month on the 1st, starting 1 Dec 2026 — next: 1 Dec 2026","revision":1}}
```

| Endpoint | Scope | Does |
|---|---|---|
| `GET /recurring?status=&template_id=` | `recurring:read` | List (oldest first) |
| `POST /recurring` | `recurring:write` (+ `invoices:write`, `templates:read`, `clients:read` for a client) | Create (`status: "paused"` to create paused) |
| `GET/PUT/PATCH/DELETE /recurring/:id` | read / write | ETag = revision, `If-Match` like templates; PUT replaces the configuration (status and history kept); DELETE is soft and idempotent; generated invoices are kept |
| `POST /recurring/:id/pause` / `resume` | `recurring:write` | Idempotent. Resume applies the catch-up policy at once |
| `POST /recurring/:id/run-now` `{period?}` | `recurring:write` | Generates the next period now (201), or returns the invoice already generated for `period` (200) |
| `GET /recurring/:id/preview?count=6` | `recurring:read` + `templates:read` | Upcoming dates + the next invoice rendered (placeholders resolved, totals) + any `problem` |
| `GET /invoices?recurring_id=` | `invoices:read` | A schedule's generated invoices |

Fields: `name`, `templateId` (required, a live template), `clientId` (bills
this saved client instead of the template's default client), `frequency`
(`weekly`, `biweekly`, `monthly`, `quarterly` = every 3 months, `yearly`),
`startDate`, `timezone` (IANA, default `UTC`; the app sends the browser's),
`endDate` (inclusive) or `maxOccurrences`, `autoAction` (`draft` default,
`mark_sent`, `send_email`), `overrides` (`notes`, `taxRate`; null = the
template's). Read-only: `status` (`active`/`paused`/`ended`), `nextRunDate`,
`lastRunDate`, `lastInvoiceId`, `runCount`, `lastError`
(`{code, message, at, period, attempts}`), `retryAt`, `skippedCount`,
`lastSkipped`, `summary`.

**Calendar.** `startDate` is the anchor: weekly schedules run on its weekday,
monthly/quarterly/yearly ones on its day of the month. When that day does not
exist, the run is on the month's last day (the 31st → 30 Apr, 28/29 Feb) and
later months return to the anchor day; 29 Feb → 28 Feb in other years. Run
dates are calendar dates in `timezone`: a period is due once that date has
begun there, and the hourly job (`7 * * * *` UTC) generates it in its first
run after local midnight. DST changes move local midnight but never skip or
repeat a date. Each invoice is dated with its run date, and the template's
placeholders (`{{month_name}}`, …) resolve against that date. A new schedule's
first run date is the first one on or after today; changing the frequency,
start date or time zone recomputes it from today.

**Content.** Same precedence as instantiating the template: schedule client
→ template client; overrides → template → client defaults → workspace
settings. Numbers come from the usual atomic allocator. The invoice records
`templateId` and `recurringId`, `createdBy` is
`{type:"system", recurringId, recurringName}`, and it is otherwise an
ordinary, independent invoice.

**Exactly once.** The invoice id is derived from (schedule, period), a
`recurring_runs` row per period has a unique key, and the schedule advances
with a compare-and-set, all in one D1 transaction: retries, overlapping cron
runs, concurrent isolates and run-now never create a second invoice for a
period (not even after the first was deleted).

**Catch-up.** After downtime, a pause, a suspension or a failure streak only
the most recent missed period is generated; older ones are skipped and
recorded (`skippedCount`, `lastSkipped`). Not configurable: a burst of
back-dated invoices is rarely wanted, and every skip is visible.

**Failures** (template or client deleted, invalid invoice, suspended
workspace, maintenance) are stored in `lastError` and retried with backoff (1
h, 2 h, 4 h … 24 h); one failing schedule never stops the others. Editing the
schedule clears the error. Ended schedules stop; raising `maxOccurrences` or
the end date continues them.

**Automatic emailing (`autoAction: "send_email"`).** Only the user (workspace
or device token) can turn it on; an agent cannot choose it, and cannot change,
resume or run a schedule that has it (it may pause or delete one): emailing a
client every period without review is the user's decision, not something a
consent-screen grant should imply. Turning it on needs email to be set up on
the server (`503 email_not_configured`; `GET /recurring` returns
`email: {configured, reason}` for the app) and a client — the schedule's, or
the template's — whose email address the user entered themselves (`400`
otherwise). Each period's invoice is generated as a draft and then sent with
the [email feature's own send](#sending-invoices-by-email) (PDF attached, to
the client on file), under these rules:

- **Unattended rules**: like an agent's send — only the invoice's `toEmail`,
  only an address the user entered (an agent-edited client email is held as
  `email_address_not_confirmed`), and sender details that are the user's
  (payment details from the settings or from a template the user saved last;
  if an agent changed the template's payment details last, the email is held
  as `email_needs_review` until the user saves the template).
- **Limits**: counted like the user's own sends (workspace hourly/daily
  windows and the site-wide daily cap, never bypassed; held as
  `email_rate_limited` and retried after the window).
- **Exactly once**: the send's idempotency key is `recurring/<schedule>/<period>`
  (and the provider gets a key per message), so a retry after a partial
  failure replays instead of sending twice.
- **Status**: the invoice becomes `sent` only when the email went out (one
  `invoice.emailed` entry, actor system, with `changes.recurring`; no separate
  `invoice.status_changed`).
- **Failures**: the invoice stays a draft; `lastError` gets the reason plus
  `invoiceId`, `sendPending` and `nextAttemptAt`, and only the send is retried
  by the hourly job (backoff 1 h … 24 h, at most 8 attempts; not after the
  invoice was deleted, voided or emailed some other way). The next period's
  invoice is generated on time regardless. Failures also appear in the
  invoice's email history (`invoice.email_failed` for provider errors) and as
  `recurring.run_failed` with the `email_*` reason.

### Activity log

Every write in the workspace leaves one entry in an append-only activity log:
who (the user's browsers or which agent), what, on which invoice/client, when,
and through what (`rest`, or `mcp` + the tool name). Reads are not logged,
except PDF downloads. Writes that change nothing (a sync PUT of identical
content, repeating a status, deleting a tombstone, revoking twice) are not
logged.

```json
{
  "id": "act_mhkx1q2s00004k2j9a1",
  "time": "2026-11-17T10:00:00.000Z",
  "actor": { "type": "agent", "agentId": "a1b2…", "agentName": "Billing Assistant" },
  "action": "invoice.status_changed",
  "entity": { "type": "invoice", "id": "1b9d…", "label": "INV-0007" },
  "changes": { "status": { "from": "sent", "to": "paid" } },
  "source": "mcp", "tool": "set_invoice_status", "requestId": "…"
}
```

| `action` | When | `changes` |
|---|---|---|
| `invoice.created` | POST, PUT that creates, `create_invoice`, `POST /templates/:id/instantiate`, `create_invoice_from_template`, a recurring schedule | `{status:{from:null,to}}` if not a draft; `{template:{id,label}}` when made from a template (one entry; the label is the template name at the time); from a schedule also `{recurring:{id,label}, trigger:"schedule"\|"run_now", skipped?}` (actor = system for scheduled runs, the caller for run-now) |
| `invoice.updated` | PUT/PATCH/`update_invoice` that changed fields | `{fields:[…names]}` |
| `invoice.status_changed` | status changed (mark-sent/-paid/void/reopen, PATCH/PUT `status`, `set_invoice_status`) | `{status:{from,to}, fields?}` |
| `invoice.deleted` | DELETE, `delete_invoice` | |
| `invoice.pdf_downloaded` | `/pdf`, `get_invoice_pdf` (once per actor, invoice and 10 min) | `{theme}` |
| `invoice.emailed` | `POST /invoices/:id/send`, `send_invoice_email` succeeded (one entry; a draft → sent change is folded in, no separate `status_changed`) | `{email:{to (masked, e.g. "b•••@acme.io"), cc (count), resend}, status?}` |
| `invoice.email_failed` | the provider refused or failed | `{email:{to, cc, resend, code}}` |
| `invoice.email_blocked` | an agent's send was refused by the recipient or review rules (once per agent, invoice, reason and hour) | `{email:{to, code}}` |
| `client.created` / `client.updated` / `client.archived` / `client.unarchived` / `client.deleted` | client writes | `{fields}` for updates |
| `template.created` / `template.updated` / `template.archived` / `template.unarchived` / `template.deleted` | template writes (REST, MCP, sync) | `{fields}` (names only, never line text or notes) for updates |
| `settings.updated` | PUT /settings that changed something | `{fields}` |
| `agent.approved` / `agent.denied` | the user decided a registration (entity `agent_registration`) | `{scopes}` granted |
| `agent.registered` | the approved agent redeemed its device code (actor = the agent) | `{scopes}` |
| `agent.revoked` | the user revoked an agent | |
| `agent.revoked_key_used` | a revoked agent's key was used (401; at most once per agent and hour) | |
| `sync.bulk_upload` | the browser uploaded its local data when joining a workspace (one entry per upload) | `{counts:{invoices,clients,templates}}` |
| `sync.bulk_upload` | the browser uploaded its local data when joining a workspace (one entry per upload) | `{counts:{invoices,clients}}` |
| `agent.oauth_authorized` | the user approved an MCP client on the OAuth consent screen (entity: the existing agent when re-authorising, else `oauth_client` with a stable `oc_…` reference and the client's name) | `{scopes, requestedScopes}` (narrowed when they differ) |
| `agent.oauth_denied` | the user denied an MCP client | `{requestedScopes}` |
| `agent.oauth_connected` | an approved MCP client exchanged its code and became an agent (actor = the agent) | `{scopes}` |
| `agent.oauth_scopes_changed` | a re-authorisation changed an OAuth agent's permissions (actor = the agent) | `{scopes, previousScopes}` |
| `recurring.created` / `recurring.updated` / `recurring.paused` / `recurring.resumed` / `recurring.deleted` | schedule writes (REST, MCP); entity `recurring` (label = schedule name) | `{fields}` for updates (names only); `{skipped}` on resume when missed dates were skipped |
| `recurring.ended` | a schedule ran out of dates (end date / number of invoices); actor = system | `{period?}` |
| `recurring.run_failed` | the generator could not create a period's invoice (actor = system; one entry per schedule, period and reason, repeats counted) | `{reason, period, counts:{attempts}}` |
| `agent.oauth_reuse_detected` | a rotated refresh token or a used code came back; the grant was revoked (actor = system; once per grant) | `{credential: "refresh_token" \| "authorization_code"}` |
| `account.workspace_created` / `account.workspace_claimed` | the owner created this workspace with an account / attached it to their account (optional user accounts) | |
| `account.device_signed_in` / `account.device_revoked` | a browser signed in to the owner's account (gets its own workspace token) / was signed out; entity `device` with a label like "Firefox on macOS" | |
| `account.signed_out_other_devices` / `account.signed_out_everywhere` | the owner signed out other devices / every device | `{counts:{devices}}` |
| `account.recovery_key_created` / `_rotated` / `_disabled` | the workspace's original token (recovery key) was created, replaced or turned off | |
| `account.deleted` | the owner deleted their account and kept the workspace | |
| `account.disabled` | the site operator disabled the owning account (actor `system`) | |

New features add `<entity>.<verb>` codes; clients must accept codes they do
not know. Entries never contain document bodies, field values, tokens or keys:
`changes` lists field *names* only. `entity.label` is a snapshot (invoice
number, client or agent name) taken at the time.

`GET /api/v1/activity` filters (all optional, combined with AND):
`actor=user|system|agent:<id>` (who did it), `agent_id=<id>` (by **or about**
that agent, from the user's approval of its registration to its
revocation; `agent.registered` carries `changes.registrationId` for that link; for OAuth agents,
from their connection and re-authorisations), `action=` (comma list
of codes or prefixes, OR: `invoice.,agent.revoked`), `entity_type=`,
`entity_id=`, `since=`/`until=` (ISO date-times, inclusive), `limit` (1–200,
default 50). Results are newest first: `{activity, hasMore, next}`; pass
`before=next.before` for the next (older) page.

- **Workspace token**: reads everything.
- **Agent key**: needs `activity:read` and only ever gets its own entries
  (`actor=agent:<itself>` is implied); asking for the user's or another
  agent's entries is `403 forbidden`. It exists so an agent can check its own
  earlier work ("did I already create November's invoice?") without being
  able to watch the user or other agents.
- `GET /api/v1/agents/:id/activity` = `GET /activity?agent_id=:id` (404 for
  unknown agents); an agent key may only use its own id.
- Retention: by default 365 days and at most the newest 10,000 entries per
  workspace (operator settings), pruned by a daily job. Deleting the
  workspace deletes its activity.
- Bulk uploads: the app sends `X-Midnight-Sync: bulk-upload; batch=<uuid>` on
  the PUTs of its initial upload; creates in one batch are counted in a single
  `sync.bulk_upload` entry. The header is ignored for agent keys.

### Sync semantics

These rules apply to every synced collection: invoices (`/invoices`), saved
clients (`/clients`) and templates (`/templates`). The examples use invoices.

Designed so the browser can mirror its local invoices and pick up agents'
changes.

- **Identity.** Invoice ids are UUIDs, unique per workspace. The browser keeps
  its existing `crypto.randomUUID()` ids and uploads them with `PUT`.
- **Server clock.** `updatedAt` (and `deletedAt`, and `createdAt` unless a
  `PUT` supplies one) is assigned by the database (D1's clock, ms precision)
  inside the write statement. Writes execute serially, so `updatedAt` is
  non-decreasing in commit order. Clients never set `updatedAt`.
- **Revision.** Every write increments `revision` (starts at 1), returned in
  the body and as `ETag: "<revision>"`.
- **Writes are last-write-wins** unless the client sends a precondition:
  - `If-Match: "<revision>"` on PUT/PATCH/DELETE → `412 precondition_failed`
    (with `details.currentRevision`) if the invoice changed meanwhile, or if it
    does not exist.
  - `If-None-Match: *` on PUT → create only; `412` if the id exists (live or
    deleted).
  - PATCH without `If-Match` is still safe against concurrent PATCHes of other
    fields (server-side compare-and-retry).
- **PUT** `/invoices/:id`: absent → created (`201`, body `createdAt` kept if
  given); live → full replace (`200`; `createdAt`/`createdBy` kept; if
  `invoiceNumber` is omitted the current one is kept).
- **Deletes are soft.** `DELETE` sets `deletedAt` (= `updatedAt`), bumps
  `revision` and keeps the row as a tombstone. Deleting a tombstone is a no-op
  `204`; an unknown id is `404`.
- **Tombstones are final.** `GET`, `PATCH`, `PUT` and `/pdf` on a deleted id
  return `410 gone` (`details.deletedAt`). A `PUT` never resurrects a deleted
  invoice; a client receiving `410` should delete its local copy. To restore,
  create a new invoice (new id).
- **Listing / delta feed.** `GET /invoices` returns items ordered by
  `(updatedAt, id)`, at most `limit` (default and max 1000):
  - no `updated_since`: all live invoices;
  - `updated_since=T`: every invoice with `updatedAt >= T` (inclusive, so
    items may repeat across syncs — apply by id, idempotently);
  - `include_deleted=true` adds tombstones (needed for sync);
  - response `{ invoices, syncedAt, hasMore, next }`. If `hasMore`, request
    the next page with `updated_since=next.updated_since&after_id=next.after_id`
    (keyset, strictly after that position, no gaps or repeats). When `hasMore`
    is false, store `syncedAt` (DB time taken in the same transaction before
    the read) and use it as `updated_since` next time: every later write has
    `updatedAt >= syncedAt`.
- **Next number** (`GET /invoices/next-number`) ignores tombstones, like the
  app's local store.

Recommended browser sync loop: `GET /invoices?include_deleted=true&updated_since=<cursor>`
(page until `hasMore` is false) → apply server changes locally (tombstones
delete local copies) → `PUT` local changes with `If-Match` of the last known
revision (or `If-None-Match: *` for never-uploaded invoices) → on `412`, fetch
the invoice and resolve; on `410`, drop the local copy → save `syncedAt`.

## MCP

`POST /api/mcp` is a stateless MCP server over Streamable HTTP (JSON
responses, no sessions, no SSE; `GET`/`DELETE` → `405`). It serves protocol
revision 2026-07-28 and 2025-era clients. Authenticate with an OAuth access
token ([Connect with OAuth](#connect-with-oauth-mcp-clients)) or the same Bearer
key as REST; without one you get `401` with `WWW-Authenticate: Bearer …,
resource_metadata="…"` so OAuth-capable clients can start the flow.

Client configuration with an API key (for clients without OAuth that support
remote HTTP servers with headers; OAuth clients only need the URL):

```json
{
  "mcpServers": {
    "midnight-invoice": {
      "type": "http",
      "url": "https://invoices.example.com/api/mcp",
      "headers": { "Authorization": "Bearer mi_agent_k3J…" }
    }
  }
}
```

Tools (only those your scopes allow are listed; others are rejected):

| Tool | Scope | Annotations | Does |
|---|---|---|---|
| `list_invoices` | `invoices:read` | read-only | `{updated_since?, include_deleted?, limit?, status?: ("draft"\|"sent"\|"paid"\|"void"\|"overdue")[], due_before?, due_after?, client?, client_id?}` → same as `GET /invoices` |
| `get_invoice_summary` | `invoices:read` | read-only | `{oldest_overdue_limit?}` → same as `GET /invoices/summary` |
| `set_invoice_status` | `invoices:write` | destructive, idempotent | `{id, status, paid_at?, sent_at?, expected_revision?}` → `{invoice, changed}`; same transition rules |
| `get_invoice` | `invoices:read` | read-only | `{id}` |
| `get_next_invoice_number` | `invoices:read` | read-only | `{}` |
| `get_invoice_pdf` | `invoices:read` | read-only | `{id, theme?: "light"\|"dark"}` (default `dark`) → embedded `application/pdf` resource (base64) + download URL |
| `create_invoice` | `invoices:write` | not destructive | `InvoiceInput` (defaults as REST) |
| `update_invoice` | `invoices:write` | destructive, idempotent | `{id, expected_revision?, …fields}` (PATCH semantics) |
| `delete_invoice` | `invoices:delete` | destructive, idempotent | `{id}` |
| `get_settings` | `settings:read` | read-only | `{}` |
| `list_clients` | `clients:read` | read-only | `{query?, limit?}` → `{clients, hasMore}` (search by name/email) |
| `get_client` | `clients:read` | read-only | `{id}` |
| `create_client` | `clients:write` | not destructive | `ClientInput` |
| `update_client` | `clients:write` | destructive, idempotent | `{id, expected_revision?, …fields}` (PATCH semantics) |
| `delete_client` | `clients:write` | destructive, idempotent | `{id}` (soft delete; invoices unchanged) |
| `list_templates` | `templates:read` | read-only | `{query?, limit?}` → `{templates, hasMore}` (search by name/description) |
| `get_template` | `templates:read` | read-only | `{id}` |
| `create_template` | `templates:write` | not destructive | `TemplateInput` |
| `update_template` | `templates:write` | destructive, idempotent | `{id, expected_revision?, …fields}` (PATCH semantics) |
| `delete_template` | `templates:write` | destructive, idempotent | `{id}` (soft delete; invoices unchanged) |
| `create_invoice_from_template` | `invoices:write` + `templates:read` | not destructive | `{id, …overrides}` → same as `POST /templates/:id/instantiate` |
| `list_recurring` | `recurring:read` | read-only | `{status?, template_id?}` → `{recurring}` |
| `get_recurring` | `recurring:read` | read-only | `{id}` |
| `preview_recurring` | `recurring:read` (+ `templates:read`) | read-only | `{id, count?}` → same as `GET /recurring/:id/preview` |
| `create_recurring` | `recurring:write` (+ `invoices:write`, `templates:read`) | not destructive | `RecurringInput` |
| `update_recurring` | `recurring:write` (+ same) | destructive, idempotent | `{id, expected_revision?, …fields}` (PATCH semantics) |
| `pause_recurring` / `resume_recurring` | `recurring:write` | idempotent | `{id}` |
| `run_recurring_now` | `recurring:write` (+ same) | idempotent per period | `{id, period?}` → same as `POST /recurring/:id/run-now` |
| `delete_recurring` | `recurring:write` | destructive, idempotent | `{id}` (generated invoices are kept) |
| `get_my_activity` | `activity:read` | read-only | `{action?, entity_type?, entity_id?, since?, until?, before?, limit?}` → this agent's own activity entries (same as `GET /activity`) |
| `send_invoice_email` | `invoices:send` | not read-only, not idempotent, open-world | `{id, cc_me?, subject?, message?, theme?, idempotency_key?}` → same as `POST /invoices/:id/send` (always to the invoice `toEmail`; confirm with the user first) |

`create_invoice` and `update_invoice` accept `clientId` (rules as in
[Billing a saved client](#billing-a-saved-client)); their descriptions tell
the model to look the client up with `list_clients` instead of inventing an
address. `list_templates` and `create_invoice_from_template` tell the model
to prefer an existing template whenever the user mentions one or a recurring
invoice. `create_invoice_from_template` is listed only when the credential
has both of its scopes; `create_invoice`/`update_invoice` do not offer
`templateId`. The recurring tools tell the model to confirm cadence, start
date, time zone and end with the user before creating or changing a schedule,
and to pass `period` to `run_recurring_now`. `list_invoices` takes
`recurring_id` for a schedule's generated invoices.

Tool results carry the JSON as text and as `structuredContent`. Errors are
tool results with `isError: true` and the REST error body as text.

## Errors

| HTTP | `error.code` |
|---|---|
| 400 | `validation_failed` (`details: [{path, message}]`), `invalid_json`, `bad_request`, `invalid_scope`, device-flow codes |
| 401 | `unauthorized` (+ `WWW-Authenticate: Bearer realm="midnight-invoice", error="invalid_token"`) |
| 403 | `insufficient_scope` (`details.requiredScope`, `WWW-Authenticate … error="insufficient_scope"`), `forbidden` (wrong credential type), `workspace_suspended` (the site operator suspended this workspace; applies to its token and all its agents), `registration_closed` (new workspaces / agent registrations are switched off), `recipient_not_allowed` (email recipient rules for agents), `invoice_needs_review` (an agent changed the sender or payment details; the user must review the invoice), `account_required` (`POST /workspaces` only: the site requires a signed-in account for new workspaces) |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `conflict` (registration already decided; rare concurrent-write retry exhaustion; recurring: paused/ended schedule, not the next period), `invalid_status_transition`, `limit_reached` (too many recurring schedules), `idempotency_conflict` (Idempotency-Key reused for another request, or still in progress) |
| 410 | `gone` (deleted invoice or client; expired registration) |
| 412 | `precondition_failed` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (+ `Retry-After`; email limits add `details.reason`) |
| 502 | `email_send_failed` (the email provider refused or failed; `details.email` is the recorded attempt) |
| 503 | `email_not_configured` (no email provider set up on this server), `maintenance` (site in maintenance mode; `message` is the operator's notice, + `Retry-After`; `/health` keeps answering). Treat it and `workspace_suspended` as "pause and retry later", not as a rejection of your request. |
| 503 | `recurring_disabled` (recurring generation switched off by the site; run-now only) |

### Operator controls

The site operator (operator console) can turn dynamic client registration
and Client ID Metadata Documents off (the metadata then omits
`registration_endpoint` / reports `client_id_metadata_document_supported:
false`, and `POST /api/oauth/register` answers `403 access_denied`) and change
the access-token, refresh-token and unused-registration lifetimes (defaults
above). When a workspace is **suspended**, its OAuth access tokens get `403
workspace_suspended` at `/api/mcp`, and refresh and code exchange get `403
{"error":"access_denied"}` (tokens are kept and work again after the
suspension is lifted); the consent API refuses the workspace token. In
**maintenance mode** the OAuth endpoints answer `503
{"error":"temporarily_unavailable"}` with `Retry-After` (and
`/api/oauth/authorize` shows the app's error page); the discovery documents
stay available.

## Rate limits and abuse protection

- `POST /workspaces` and `POST /agents/register`: 10 requests / 60 s per client
  IP and endpoint; `POST /agents/token` and user-code lookups/approvals: 30 / 60 s
  per IP and endpoint (Cloudflare Workers Rate Limiting binding — enforced per
  Cloudflare location and eventually consistent, so treat these as approximate).
- User codes are 8 characters from a 20-letter consonant alphabet (~34.6 bits),
  valid 10 minutes, case-insensitive, dash optional. Failed lookups are counted
  in D1 (consistent): after 10 misses in 10 minutes, the workspace **and** the
  client IP get `429` for the rest of the window.
- Polling faster than `interval` returns `slow_down`.
- OAuth: `POST /api/oauth/register` and Client ID Metadata Document fetches
  share the 10 / 60 s per-IP budget; `/api/oauth/authorize`, `/token`,
  `/revoke` and the consent API use the 30 / 60 s one (`429` with
  `temporarily_unavailable` on the OAuth endpoints).

## Not supported (yet)

CORS on `/api/v1` and `/api/mcp` (the API is same-origin for the app; agents
call it server-to-server), OAuth access tokens on the REST API, confidential
OAuth clients (client secrets, `private_key_jwt`), DPoP, OpenID Connect,
webhooks (including email delivery events such as bounces), per-agent rate limits outside email, pagination of `GET /agents` and
`GET /recurring` (bounded by the per-workspace schedule limit), daily or
custom cron recurring cadences.
