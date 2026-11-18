---
name: midnight-invoice-deploy
description: Deploy, redeploy or troubleshoot the Midnight Invoice production Worker and walk through first-time operator setup (bootstrap password, encryption key, WorkOS, accounts, email). Use for "deploy this", "apply the migrations", "the operator wizard shows an error", or any production-only failure of this project.
---

# Midnight Invoice: deploy and operator setup

Deploy and remote migrations only when the user asks (AGENTS.md). For signing
Wrangler in from a cloud session and general Workers pitfalls, see the
`cloudflare-workers-go-live` skill.

## Facts

- One Worker named `midnight-invoice` (static assets + API), D1 database
  `midnight-invoice`, binding **`DB`** (not the name Wrangler suggests),
  `database_id` committed in `wrangler.jsonc`.
- Production URL: printed by the deploy (`https://midnight-invoice.<subdomain>.workers.dev`).
  `APP_URL` is empty, so the public URL is derived from the request; set it in
  `wrangler.jsonc` when a custom domain is added.
- Crons: `7 * * * *` (recurring), `17 * * * *` (accounts cleanup), `43 3 * * *`
  (activity retention). Each must be in `wrangler.jsonc` and `server/scheduled.ts`.

## Deploy

```bash
bun run lint && bun run typecheck && bun run test:run   # or rely on the pre-commit hook
```
```bash
CI=1 bunx wrangler d1 migrations apply DB --remote
```
```bash
bun run build && CI=1 bunx wrangler deploy
```

Migrations first: a deploy that expects a newer schema fails at runtime.
Commit before or right after deploying so the deployed version matches a
pushed commit; the pre-commit hook runs the whole suite (about five minutes),
so run the commit with a long timeout or in the background.

Smoke test (all should be 200):

```bash
B=https://<production host>
for p in / /api/v1/health /api/v1/openapi.json /.well-known/oauth-authorization-server /llms.txt /operator /api/account/config; do
  curl -sS -o /dev/null -w "$p %{http_code}\n" "$B$p"
done
curl -sS "$B/api/operator/status"          # {"phase":"bootstrap"|"ready","encryptionLocked":false}
curl -sSI "$B/" | grep -i content-security-policy
```

## First-time operator setup

1. `INITIAL_PASSWORD` Worker secret, **at least 24 characters**; shorter keeps
   the console off (503 `operator_not_configured`, reason
   `initial_password_too_short`). Set it with the value on stdin.
2. `/operator` → sign in with it → wizard (30-minute setup session; signing in
   again resumes at the current step):
   - **Encryption key**: random key (recommended; shows a one-time recovery key
     `mi_mk_…` to store offline) or a passphrase (prefer 32+ characters).
   - **WorkOS**: client id and API key. Add the redirect URI the wizard shows.
   - **Operator account**: goes to AuthKit's sign-up screen.
3. After the wizard the bootstrap login is disabled for good. `INITIAL_PASSWORD`
   still wraps the master key in the default mode, so it must stay set; rotate
   it from Operators & security if it was ever exposed, or switch to hardened
   mode (`ENCRYPTION_KEY` secret).
4. Optional, in the console: turn on accounts (add
   `https://<host>/api/account/auth/callback` in WorkOS), Resend key + verified
   domain, GitHub token for Redeploy. Email stays off for everyone until
   accounts are on, unless `email.requireAccount` is turned off.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Internal server error" on *Create master key*, or on the first console request after setup | PBKDF2 above 100,000 iterations (Workers limit; local workerd allows it) | `MAX_PBKDF2_ITERATIONS` in `server/operator/crypto.ts`; never raise the counts above it |
| AuthKit "Page not found" at `…authkit.app/sign-up` | Sign-up disabled in the WorkOS environment | Enable sign-up there; or create the user in WorkOS and change the wizard to the sign-in screen |
| WorkOS error naming the redirect URI | URI not registered | Add the exact operator and account callback URIs |
| 503 `operator_not_configured` | Secret missing or shorter than 24 characters | Set a longer `INITIAL_PASSWORD` |
| Console says the store is locked | `INITIAL_PASSWORD` changed without re-wrap, or wrong `ENCRYPTION_KEY` | `POST /api/operator/recover` with the recovery key (Operators & security) |
| "Exceeded CPU" / error 1102 on PDFs, emails with PDF, first console request per instance | Free plan 10 ms CPU limit | Workers Paid plan |
| Sending email answers 403 `account_required_for_email` | `email.requireAccount` on, workspace has no account | Turn accounts on, or turn the setting off deliberately |
| Agent send answers 403 `invoice_needs_review` | Agent-written sender or bank details not approved | User approves on the invoice's "Needs your review" banner |
| Deploy workflow refuses to run | Repository variable `CLOUDFLARE_DEPLOY` not `true`, or secrets missing | Set the variable and `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` |

WorkOS sign-up does not grant operator access: `/operator` admits only the
`operators` allowlist (first operator via the wizard, later ones invited by
verified email). The same WorkOS environment serves customer accounts, with
separate cookies, tables and keys.

## Not yet verified in production

Cron-driven recurring generation and email, Rate Limiting bindings, real
Resend delivery and bounces, the GitHub redeploy dispatch, the installed PWA
offline, browsers other than Chromium. Check each the first time it is used
and remove it from this list.
