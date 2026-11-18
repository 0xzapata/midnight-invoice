#!/usr/bin/env node
// Signs Wrangler in when the browser cannot reach Wrangler's localhost callback
// (cloud or remote sessions). Runs the same OAuth + PKCE flow as `wrangler login`
// in two steps, so nothing times out while the user approves.
//
//   node wrangler-oauth.mjs start  <state-dir>
//   node wrangler-oauth.mjs finish <state-dir> '<http://localhost:8976/oauth/callback?...>'
//
// <state-dir> holds the PKCE verifier between the two steps; keep it outside the
// repository. The token is written to Wrangler's config file and never printed.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Wrangler's public OAuth client and its fixed redirect address.
const CLIENT_ID = '54d11594-84e4-41aa-b438-e81b8fa78ee7';
const REDIRECT_URI = 'http://localhost:8976/oauth/callback';
const AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
const TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
// The least a Workers + D1 deploy needs. Add scopes only when a command asks for them.
const SCOPES = [
  'account:read', 'user:read', 'workers:write', 'workers_kv:write', 'workers_routes:write',
  'workers_scripts:write', 'workers_tail:read', 'd1:write', 'zone:read', 'offline_access',
];

const [mode, stateDir, callback] = process.argv.slice(2);
if (!mode || !stateDir) fail('usage: wrangler-oauth.mjs start|finish <state-dir> [callback-url]');
const pkceFile = join(stateDir, 'pkce.json');

if (mode === 'start') {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  writeFileSync(pkceFile, JSON.stringify({ verifier, state }), { mode: 0o600 });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString().replace(/\+/g, '%20');
  console.log(url.toString());
} else if (mode === 'finish') {
  if (!callback) fail('finish needs the callback address the browser landed on');
  const { verifier, state } = JSON.parse(readFileSync(pkceFile, 'utf8'));
  const cb = new URL(callback);
  if (cb.searchParams.get('state') !== state) fail('state mismatch: this callback belongs to another sign-in attempt');
  const code = cb.searchParams.get('code');
  if (!code) fail(`no code in callback (${cb.searchParams.get('error') ?? 'unknown error'})`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: verifier,
  }).toString();
  // curl honours the session's proxy and CA settings; the body goes on stdin, not in argv.
  const out = execFileSync('curl', ['-sS', '-X', 'POST', TOKEN_URL, '-H', 'Content-Type: application/x-www-form-urlencoded', '--data', '@-'], { input: body }).toString();
  let json;
  try { json = JSON.parse(out); } catch { fail(`token endpoint did not answer with JSON: ${out.slice(0, 120)}`); }
  if (!json.access_token) fail(`sign-in refused: ${json.error ?? 'unknown'} ${json.error_description ?? ''}`);
  const expires = new Date(Date.now() + json.expires_in * 1000).toISOString();
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), '.wrangler', 'config');
  mkdirSync(dir, { recursive: true });
  const scopes = String(json.scope ?? '').split(' ').filter(Boolean).map((s) => `"${s}"`).join(', ');
  writeFileSync(
    join(dir, 'default.toml'),
    `oauth_token = "${json.access_token}"\nexpiration_time = "${expires}"\nrefresh_token = "${json.refresh_token ?? ''}"\nscopes = [ ${scopes} ]\n`,
    { mode: 0o600 },
  );
  unlinkSync(pkceFile);
  console.log(`signed in; access token expires ${expires}; refresh token: ${json.refresh_token ? 'yes' : 'no'}`);
} else {
  fail(`unknown mode ${mode}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
