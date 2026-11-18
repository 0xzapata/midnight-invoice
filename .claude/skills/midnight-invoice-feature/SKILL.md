---
name: midnight-invoice-feature
description: Checklist for adding or changing a feature in Midnight Invoice so every cross-cutting surface stays consistent (migration, repository, service, REST, MCP, OpenAPI, scopes, activity log, telemetry, workspace deletion, sync, docs). Use before starting any change that touches the API, the database, agent permissions or email in this project.
---

# Midnight Invoice: feature checklist

AGENTS.md is the architecture reference; this is the order of work and the
tests that will fail if a surface is missed. Read the AGENTS.md section for the
area first.

## Order of work

1. **Schema**: a new numbered file in `migrations/` (never edit an applied one;
   production has 0001–0011). A table with `workspace_id` must be emptied in
   `repo.deleteWorkspace` and seeded in `server/workspace-deletion.test.ts`.
2. **SQL** only in the repository files (`server/db/*`, or the feature
   folder's own `repository.ts` / `db.ts`): parameterised, scoped by
   `workspace_id`, atomic steps as one statement or `db.batch()`.
3. **Service** in `server/services/` (or the feature folder), shared by REST
   and MCP. Every mutating use-case records exactly one activity entry
   (`activityWrite` attached to the write; `recordActivity` when there is no
   write). No-op writes record none.
4. **REST route**, **MCP tool** (registered only for granted scopes),
   **OpenAPI fragment**, `shared/api.ts` types.
5. **Scopes**: `SCOPES` + `SCOPE_DESCRIPTIONS` in `shared/api.ts`,
   `src/components/agents/scopes.ts`. A new scope is never added to existing
   agents.
6. **Activity**: code in `ACTIVITY_ACTIONS`, a sentence in
   `src/components/activity/describe.ts`, optional group, AGENT_API.md.
7. **Telemetry**: the route must land in a named group
   (`server/operator/hooks.ts`); details only as fixed identifiers via
   `setTelemetryDetail`.
8. **Settings**: declare once in `server/operator/settings-registry.ts`; read
   with `deps.settings.get()` / `getSecret()`.
9. **Browser**: store with a version + migration, `emitLocalChange` on user
   edits, a sync descriptor if it is a synced collection (AGENTS.md "Adding a
   synced collection"), `src/test/fakeApi.ts` routes.
10. **Docs**: README, AGENT_API.md, `public/llms.txt`, AGENTS.md, CHANGELOG
    under the current version.

## Tests that enforce it

- `server/openapi.test.ts` — routes and OpenAPI agree; operator and account
  routes stay out of the public docs.
- `server/docs-consistency.test.ts` — scopes, MCP tools, activity sentences,
  telemetry groups and the version agree across code and docs.
- `server/workspace-deletion.test.ts` — every workspace table is emptied.
- `src/accounts/localOnly.test.tsx` — no request with cloud sync off.
- `worker/worker.test.ts` — the built bundle, PDF text, the CSP hash.

## Rules that are easy to break

- **Agents and money**: an agent must not get its own sender name, sender
  email or payment details in front of a client. Anything that produces or
  sends an invoice (new generators, new send paths, "system" actors) goes
  through `sendInvoiceEmail` and the `sender_approved_values` /
  `email_confirmed_recipients` rules; a user save approves only the field the
  user actually changed. Add a test in `server/security-review.test.ts` for any
  new path.
- **Reserved prefixes**: server idempotency keys start with `internal:`;
  clients cannot use that prefix.
- **Production limits**: PBKDF2 at most 100,000 iterations
  (`MAX_PBKDF2_ITERATIONS`); keep per-request CPU small; local workerd does not
  enforce either.
- **CSP**: no inline scripts, no eval, no third-party origins. A new library
  that needs one is a design decision, not a header tweak; re-check the built
  app in a browser.
- **PDF and preview** are one layout: change `InvoicePreview.tsx` and
  `InvoicePDF.tsx` together, colours via `invoiceTheme.ts`, fonts via
  `pdfFonts.ts`.
- **UI tests**: use `fill()` from `src/test/userInput.ts` and
  `userEvent.setup({ delay: null })`; per-keystroke typing times out under load.
- **Credentials**: tokens only in the `Authorization` header; never in URLs,
  logs, errors, toasts, telemetry or activity entries.

## Before handing back

```bash
bun run lint && bun run typecheck && bun run test:run && bun run build
```

Report test counts, behaviour changes, anything checked only against local
emulators, and decisions left for the user.
