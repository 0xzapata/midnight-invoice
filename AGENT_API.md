# Midnight Invoice Agent API

Midnight Invoice exposes a REST API (`/api/v1`) and a remote MCP server
(`/api/mcp`) so that AI agents can work with a user's invoices **after the user
approves them**. There are no accounts: the browser app owns an anonymous
*workspace*, and agents connect to a workspace with a device-authorization
flow modelled on [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628).

- Machine-readable contract: `GET /api/v1/openapi.json` (OpenAPI 3.1)
- Short pointer for crawlers/agents: `/llms.txt`
- Shared TypeScript types: [`shared/api.ts`](shared/api.ts), [`shared/types/invoice.ts`](shared/types/invoice.ts)

Replace `https://invoices.example.com` below with the deployment's URL
(`http://localhost:8080` under `bun run dev`).

## Credentials

| Credential | Prefix | Who holds it | Grants |
|---|---|---|---|
| Workspace token | `mi_ws_` | The browser app (the user) | Everything in the workspace, incl. approving/revoking agents, settings writes, deleting the workspace |
| Device code | `mi_dc_` | An agent during registration | Only polling `POST /agents/token` |
| Agent API key | `mi_agent_` | An approved agent | The scopes the user approved |

All three are 256-bit random secrets (base64url), returned **once**, stored
only as SHA-256 hashes. Send them as `Authorization: Bearer <secret>`.

### Scopes

| Scope | Allows |
|---|---|
| `invoices:read` | List/get invoices, next invoice number, PDF download |
| `invoices:write` | Create (POST/PUT) and update (PUT/PATCH) invoices |
| `invoices:delete` | Delete invoices |
| `settings:read` | Read the default sender settings |

Settings writes, agent management and workspace deletion require the workspace
token; no scope grants them.

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
| DELETE | `/api/v1/workspace` | workspace token | | 204; deletes all invoices, settings, agents |
| POST | `/api/v1/agents/register` | none (rate limited) | | → 201, see above |
| POST | `/api/v1/agents/token` | none (rate limited) | | see above |
| GET | `/api/v1/agents/registrations/:user_code` | workspace token | | Preview `{registration:{id,userCode,name,description,requestedScopes,createdAt,expiresAt}}` |
| POST | `/api/v1/agents/registrations/:user_code/approve` | workspace token | | Body optional `{scopes}` ⊆ requested → `{registration:{id,status:"approved",scopes}}` |
| POST | `/api/v1/agents/registrations/:user_code/deny` | workspace token | | `{registration:{id,status:"denied"}}` |
| GET | `/api/v1/agents` | workspace token | | `{agents:[{id,name,description,scopes,createdAt,lastUsedAt,revokedAt}]}` (revoked included) |
| GET | `/api/v1/agents/me` | agent key | | `{agent:{id,name,description,scopes,workspace_id,createdAt}}` |
| DELETE | `/api/v1/agents/:id` | workspace token | | 204, immediate, idempotent |
| GET | `/api/v1/invoices` | any | `invoices:read` | Sync feed, see below |
| POST | `/api/v1/invoices` | any | `invoices:write` | → 201 `{invoice}` + `ETag`, `Location` |
| GET | `/api/v1/invoices/next-number` | any | `invoices:read` | `{invoiceNumber:"INV-0007"}` |
| GET | `/api/v1/invoices/:id` | any | `invoices:read` | `{invoice}` + `ETag`; 410 if deleted |
| PUT | `/api/v1/invoices/:id` | any | `invoices:write` | Create-or-replace with client UUID → 201/200 |
| PATCH | `/api/v1/invoices/:id` | any | `invoices:write` | Partial update → 200 |
| DELETE | `/api/v1/invoices/:id` | any | `invoices:delete` | Soft delete → 204 |
| GET | `/api/v1/invoices/:id/pdf` | any | `invoices:read` | `application/pdf`, styled like the app's invoice preview; optional `?theme=light\|dark` (default `dark`, the app default; anything else → 400) |
| GET | `/api/v1/settings` | any | `settings:read` | `{settings,updatedAt}` (defaults + `updatedAt:null` if never saved) |
| PUT | `/api/v1/settings` | workspace token | | Body = settings object → `{settings,updatedAt}` |
| POST | `/api/mcp` | any | per tool | MCP Streamable HTTP; GET/DELETE → 405 |

"any" = workspace token or agent key.

### Invoices

Request body for `POST` and `PUT` (`InvoiceInput`): the app's invoice fields,
all optional except `toName` and `lineItems`:

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

Totals: `subtotal = Σ quantity × price`, `taxAmount = subtotal × taxRate / 100`,
`total = subtotal + taxAmount`, each rounded to 2 decimals.

### Sync semantics

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
revision 2026-07-28 and 2025-era clients. Authenticate with the same Bearer
key; without one you get `401` with `WWW-Authenticate: Bearer …`.

Client configuration (clients that support remote HTTP servers with headers):

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
| `list_invoices` | `invoices:read` | read-only | `{updated_since?, include_deleted?, limit?}` → same as `GET /invoices` |
| `get_invoice` | `invoices:read` | read-only | `{id}` |
| `get_next_invoice_number` | `invoices:read` | read-only | `{}` |
| `get_invoice_pdf` | `invoices:read` | read-only | `{id, theme?: "light"\|"dark"}` (default `dark`) → embedded `application/pdf` resource (base64) + download URL |
| `create_invoice` | `invoices:write` | not destructive | `InvoiceInput` (defaults as REST) |
| `update_invoice` | `invoices:write` | destructive, idempotent | `{id, expected_revision?, …fields}` (PATCH semantics) |
| `delete_invoice` | `invoices:delete` | destructive, idempotent | `{id}` |
| `get_settings` | `settings:read` | read-only | `{}` |

Tool results carry the JSON as text and as `structuredContent`. Errors are
tool results with `isError: true` and the REST error body as text.

## Errors

| HTTP | `error.code` |
|---|---|
| 400 | `validation_failed` (`details: [{path, message}]`), `invalid_json`, `bad_request`, `invalid_scope`, device-flow codes |
| 401 | `unauthorized` (+ `WWW-Authenticate: Bearer realm="midnight-invoice", error="invalid_token"`) |
| 403 | `insufficient_scope` (`details.requiredScope`, `WWW-Authenticate … error="insufficient_scope"`), `forbidden` (wrong credential type) |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `conflict` (registration already decided; rare concurrent-write retry exhaustion) |
| 410 | `gone` (deleted invoice; expired registration) |
| 412 | `precondition_failed` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (+ `Retry-After`) |

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

## Not supported (yet)

CORS (the API is same-origin for the app; agents call it server-to-server),
OAuth/dynamic client registration for MCP, webhooks, per-agent rate limits,
pagination of `GET /agents`.
