---
name: cloudflare-workers-go-live
description: Take a Cloudflare Workers + D1 project from "passes locally" to deployed and smoke-tested, including signing Wrangler in from a remote or cloud session where the localhost OAuth callback cannot be reached. Use when asked to deploy a Worker, set Worker secrets, apply remote D1 migrations, or when a first production deploy fails in ways local tests did not. Portable across projects.
---

# Cloudflare Workers: first production deploy

Only deploy, run remote migrations or set secrets when the user asked for it.

## Order of operations

1. **Create the database** (the user, or you once signed in): `wrangler d1 create <name>`.
   Put the returned `database_id` in the Wrangler config. Keep the **binding
   name the code expects** — the snippet Wrangler prints suggests a binding named
   after the database, which is usually not what the code reads.
2. **Apply migrations to the remote database** before the first deploy.
3. **Build and deploy.**
4. **Set secrets** with the value on stdin, never on the command line:
   `printf '%s' "$VALUE" | wrangler secret put NAME`. A Worker must exist first;
   setting a secret creates a new version.
5. **Smoke-test the live URL**: the home page, a health endpoint, one
   authenticated-surface status endpoint, any discovery documents, and the
   security headers. Say that this checks that addresses answer, not that the
   flows work.

Use `CI=1` on Wrangler commands so nothing waits for a prompt.

## Signing in from a remote session

`wrangler login` listens on `localhost:8976` and gives up after a short wait.
In a cloud session the user's browser cannot reach that listener, and by the
time they paste the callback address Wrangler has usually timed out.

Preferred order:

1. A short-lived **API token** entered through a secure credential form (never
   pasted into chat). Template "Edit Cloudflare Workers" plus `D1: Edit`.
2. If the user wants the OAuth link: run the PKCE flow yourself so nothing
   times out. `scripts/wrangler-oauth.mjs` in this skill does it:

```bash
node .claude/skills/cloudflare-workers-go-live/scripts/wrangler-oauth.mjs start <state-dir>
# send the printed link; the user approves and pastes the localhost callback address
node .claude/skills/cloudflare-workers-go-live/scripts/wrangler-oauth.mjs finish <state-dir> '<pasted callback url>'
wrangler whoami
```

   Keep `<state-dir>` outside the repository. The script asks only for the
   Workers and D1 scopes, checks `state`, never prints the token, and writes
   Wrangler's own config file. Wrangler then warns about "missing scopes";
   that is expected. Cloudflare's code expires within minutes, so exchange it
   as soon as it arrives.

Tell the user how to revoke: dashboard → My Profile → Access Management →
Connected Applications (or delete the API token).

## Network allowlist (restricted sessions)

A sandboxed session needs these hosts allowed, each for a stated reason:

- `api.cloudflare.com` — every Wrangler API call, asset upload included
- `dash.cloudflare.com` — OAuth authorize and token exchange
- the deployed hostname (`<worker>.<subdomain>.workers.dev` or the custom
  domain) — the smoke test

`sparrow.cloudflare.com` is telemetry; refusals there are harmless.
`wrangler tail` needs a further host and may simply not work; do not depend on
it for diagnosis.

## Production differs from local workerd

Local tests cannot catch these. Check for them before the first deploy and
suspect them first when production fails with a bare 500:

- **PBKDF2 is capped at 100,000 iterations per call** in production. Local
  workerd accepts more. Guard it in code (throw above the cap) so tests fail the
  way production does.
- **CPU time**: 10 ms per request on the Free plan. Key derivation, PDF
  rendering and other heavy work need the Paid plan; say so before the user
  hits it.
- **Cron triggers, Rate Limiting bindings, `_headers` handling and D1 trigger
  behaviour** are only really exercised in production.
- `vars` that are empty in config (a public URL, for instance) fall back to
  whatever the code derives from the request; confirm the derived value in a
  discovery document or redirect.

## Secrets hygiene

- A secret pasted into the chat is used: have the user rotate it after setup.
- Check stated constraints before setting a secret (minimum length, format);
  a too-short bootstrap password can silently keep a feature off.
- Never commit a secret or write it into docs, logs or commit messages.

## When a hosted identity provider page 404s

If the redirect lands on the provider's own domain and that page says "not
found", the app built a valid request and the provider has no such screen —
most often sign-up is disabled in that environment. A wrong redirect URI
normally produces an explicit provider error instead. Being on an operator
allowlist, not being able to sign up, is what should gate privileged access.
