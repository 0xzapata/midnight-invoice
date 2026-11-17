# Midnight Invoice Agent API

Midnight Invoice exposes a REST API (`/api/v1`) and a remote MCP server
(`/api/mcp`) so that AI agents can work with a user's invoices and saved
clients **after the user approves them**. There are no accounts: the browser app owns an anonymous
*workspace*, and agents connect to a workspace with a device-authorization
flow modelled on [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628).

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

All three are 256-bit random secrets (base64url), returned **once**, stored
only as SHA-256 hashes. Send them as `Authorization: Bearer <secret>`.

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

There is no separate `clients:delete`: deleting a client is a soft delete of
address-book data that never touches invoices (they keep their own copy of the
client's details), and `clients:write` can already blank every field of a
client, so a separate scope would not protect anything. Scopes are never added
to existing agents: an agent approved before clients existed keeps exactly the
scopes it was granted and must register again to get client access. The
same holds for `templates:read` / `templates:write` (write includes delete,
for the same reason as clients: deleting a template never touches the
invoices made from it).

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

`create_invoice` and `update_invoice` accept `clientId` (rules as in
[Billing a saved client](#billing-a-saved-client)); their descriptions tell
the model to look the client up with `list_clients` instead of inventing an
address. `list_templates` and `create_invoice_from_template` tell the model
to prefer an existing template whenever the user mentions one or a recurring
invoice. `create_invoice_from_template` is listed only when the credential
has both of its scopes; `create_invoice`/`update_invoice` do not offer
`templateId`.

Tool results carry the JSON as text and as `structuredContent`. Errors are
tool results with `isError: true` and the REST error body as text.

## Errors

| HTTP | `error.code` |
|---|---|
| 400 | `validation_failed` (`details: [{path, message}]`), `invalid_json`, `bad_request`, `invalid_scope`, device-flow codes |
| 401 | `unauthorized` (+ `WWW-Authenticate: Bearer realm="midnight-invoice", error="invalid_token"`) |
| 403 | `insufficient_scope` (`details.requiredScope`, `WWW-Authenticate … error="insufficient_scope"`), `forbidden` (wrong credential type), `workspace_suspended` (the site operator suspended this workspace; applies to its token and all its agents), `registration_closed` (new workspaces / agent registrations are switched off) |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `conflict` (registration already decided; rare concurrent-write retry exhaustion), `invalid_status_transition` |
| 410 | `gone` (deleted invoice or client; expired registration) |
| 412 | `precondition_failed` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (+ `Retry-After`) |
| 503 | `maintenance` (site in maintenance mode; `message` is the operator's notice, + `Retry-After`; `/health` keeps answering). Treat it and `workspace_suspended` as "pause and retry later", not as a rejection of your request. |

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
