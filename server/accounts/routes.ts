/**
 * /api/account/* — optional user accounts (sign in with WorkOS AuthKit).
 *
 * Why both a cookie and a bearer token: the HttpOnly session cookie proves
 * "this browser signed in as this WorkOS user" and is only accepted here, for
 * account management (it never reaches /api/v1 or /api/mcp, which ignore
 * cookies). Sync, agent approval and MCP keep using a per-device workspace
 * token (`mi_ws_…`) in the Authorization header, minted here for the signed-in
 * browser, so the public API, the sync engine and agents need no change and
 * cookies never become ambient credentials for invoice data.
 */
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  deviceLabelFromUserAgent,
  safeReturnTo,
  type AccountConfigResponse,
  type AccountSessionResponse,
  type AccountWorkspace,
  type DeleteAccountResponse,
  type DeviceTokenResponse,
  type DevicesResponse,
  type RecoveryKeyRotateResponse,
  type SignInError,
} from '../../shared/accounts';
import { TOKEN_PREFIX } from '../../shared/api';
import { bearerToken } from '../auth';
import { sha256Hex } from '../crypto';
import type { Repository } from '../db/repository';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { clientIp, enforceRateLimit, publicBaseUrl, readJson } from '../http';
import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url } from '../operator/crypto';
import { createOperatorDb } from '../operator/db';
import { OperatorError } from '../operator/errors';
import type { TelemetryCollector } from '../operator/telemetry';
import { createWorkosClient, pkcePair } from '../operator/workos';
import { accountActivityContext, accountEntry, accountWriteStatements, recordAccountActivity } from './activity';
import { DISABLED_TOKEN_HASH_PREFIX, type AccountsDb, type OwnedWorkspaceRow } from './db';
import {
  USER_OAUTH_COOKIE,
  USER_OAUTH_PATH,
  USER_SESSION_COOKIE,
  accountError,
  assertSameOrigin,
  clearUserSessionCookie,
  csrfTokenFor,
  enforceCsrf,
  hashId,
  readUserSession,
  sessionIdFromCookie,
  startUserSession,
  type UserSession,
} from './session';

type AccEnv = { Variables: { session: UserSession } };

const OAUTH_TTL_MS = 10 * 60_000;
const BODY_LIMIT = 4 * 1024;
const SYSTEM_ACTOR = { type: 'system' as const, id: null, email: null };

export const CALLBACK_PATH = '/api/account/auth/callback';

export interface AccountRoutesOptions {
  deps: AppDeps;
  repo: Repository;
  adb: AccountsDb;
  telemetry?: TelemetryCollector;
}

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw = await readJson(c, BODY_LIMIT);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw accountError(400, 'validation_failed', parsed.error.issues[0]?.message ?? 'Invalid request body');
  return parsed.data;
}

export function workspaceView(ws: OwnedWorkspaceRow): AccountWorkspace {
  return { id: ws.id, createdAt: ws.created_at, recoveryKeyEnabled: !ws.token_hash.startsWith(DISABLED_TOKEN_HASH_PREFIX) };
}

/**
 * Whether account sign-in can work right now: the operator turned it on, the
 * operator console (and therefore the encrypted settings store) is set up and
 * unlocked, and WorkOS credentials are stored.
 */
export async function accountsState(deps: AppDeps): Promise<'disabled' | 'unavailable' | 'ready'> {
  if (!deps.settings.get('accounts.enabled')) return 'disabled';
  if (!deps.operator.initialPassword) return 'unavailable';
  try {
    if (!(await deps.settings.keystore.isUnlocked())) return 'unavailable';
    const apiKey = await deps.settings.getSecret('workos.apiKey');
    return apiKey && deps.settings.get('workos.clientId') ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function createAccountRoutes({ deps, repo, adb, telemetry }: AccountRoutesOptions) {
  const app = new Hono<AccEnv>();
  const settings = deps.settings;
  const now = () => deps.clock().getTime();

  function allowedOrigins(c: Context): string[] {
    const out = [new URL(c.req.url).origin];
    if (deps.config.appUrl) {
      try {
        out.push(new URL(deps.config.appUrl).origin);
      } catch {
        // invalid app.url is rejected by settings validation
      }
    }
    return out;
  }

  async function signingKey(create = false): Promise<Uint8Array | null> {
    try {
      let k = await settings.getSecret('accounts.sessionSigningKey');
      if (!k && create) {
        k = toBase64Url(randomBytes(32));
        await settings.set('accounts.sessionSigningKey', k, SYSTEM_ACTOR);
      }
      return k ? fromBase64Url(k) : null;
    } catch (error) {
      deps.logError?.('Account session key unavailable', error);
      return null;
    }
  }

  async function workos() {
    const apiKey = await settings.getSecret('workos.apiKey');
    const clientId = settings.get('workos.clientId');
    if (!apiKey || !clientId) throw accountError(503, 'accounts_unavailable', 'Accounts are not available right now.');
    return createWorkosClient({ apiKey, clientId, baseUrl: deps.operator.workosBaseUrl, fetch: deps.operator.fetch });
  }

  const redirectUri = (c: Context) => `${publicBaseUrl(c, deps.config.appUrl)}${CALLBACK_PATH}`;

  /** Telemetry for the "Account sign-in" group: one sample per completed or failed callback. */
  function recordSignIn(outcome: 'success' | SignInError) {
    if (!telemetry || !settings.get('telemetry.enabled')) return;
    try {
      telemetry.record({
        metric: `accounts|sign-in ${outcome === 'success' ? 'succeeded' : 'failed'}`,
        status: outcome === 'success' ? 200 : outcome === 'rate_limited' ? 429 : outcome === 'accounts_unavailable' ? 503 : 401,
        durationMs: 0,
        at: now(),
        errorCode: outcome === 'success' ? null : outcome,
      });
    } catch (error) {
      deps.logError?.('Telemetry record failed', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    c.header('x-robots-tag', 'noindex, nofollow');
    // /config is public; /sign-out and /device-status work with a device token even after accounts are turned off,
    // so a browser can always detach itself and learn why it was signed out.
    if (c.req.path === '/api/account/config' || c.req.path === '/api/account/sign-out' || c.req.path === '/api/account/device-status') return next();
    const state = await accountsState(deps);
    if (state === 'disabled') throw accountError(404, 'accounts_disabled', 'Accounts are not enabled on this site.');
    if (state === 'unavailable') {
      if (c.req.path === CALLBACK_PATH) return c.redirect('/account/connect?error=accounts_unavailable', 303);
      throw accountError(503, 'accounts_unavailable', 'Accounts are not available right now.');
    }
    await next();
  });

  const session = createMiddleware<AccEnv>(async (c, next) => {
    const s = await readUserSession(c, deps, adb, await signingKey(false));
    if (!s) {
      if (getCookie(c, USER_SESSION_COOKIE)) clearUserSessionCookie(c);
      throw accountError(401, 'unauthorized', 'Sign in to manage your account.');
    }
    await enforceCsrf(c, s, allowedOrigins(c));
    c.set('session', s);
    await next();
  });

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------
  app.get('/config', async (c) => {
    const ready = (await accountsState(deps)) === 'ready';
    return c.json<AccountConfigResponse>({
      enabled: ready,
      requiredForNewWorkspaces: ready && settings.get('accounts.requiredForNewWorkspaces'),
    });
  });

  app.post('/auth/start', async (c) => {
    assertSameOrigin(c, allowedOrigins(c));
    await enforceRateLimit(deps.rateLimiters.create, `account-auth:${clientIp(c)}`);
    const input = await body(
      c,
      z.object({
        intent: z.enum(['sign-in', 'sign-up']).optional(),
        returnTo: z.string().max(200).optional(),
        loginHint: z.email().max(320).optional(),
      }),
    );
    const client = await workos();
    if (!(await signingKey(true))) throw accountError(503, 'accounts_unavailable', 'Accounts are not available right now.');
    const stateValue = toBase64Url(randomBytes(32));
    const nonce = toBase64Url(randomBytes(32));
    const { verifier, challenge } = await pkcePair();
    const t = now();
    await adb.insertOAuthState(
      {
        state_hash: await hashId(stateValue),
        browser_nonce_hash: await hashId(nonce),
        code_verifier: verifier,
        return_to: safeReturnTo(input.returnTo),
        created_at: t,
        expires_at: t + OAUTH_TTL_MS,
      },
      t,
    );
    setCookie(c, USER_OAUTH_COOKIE, nonce, { path: USER_OAUTH_PATH, httpOnly: true, secure: true, sameSite: 'Lax', maxAge: OAUTH_TTL_MS / 1000 });
    return c.json({
      authorizationUrl: client.authorizationUrl({
        redirectUri: redirectUri(c),
        state: stateValue,
        codeChallenge: challenge,
        screenHint: input.intent === 'sign-up' ? 'sign-up' : 'sign-in',
        loginHint: input.loginHint,
      }),
    });
  });

  app.get('/auth/callback', async (c) => {
    // As in the operator flow, the nonce cookie is cleared only once a real state row was consumed.
    let consumed = false;
    const fail = (code: SignInError) => {
      recordSignIn(code);
      if (consumed) deleteCookie(c, USER_OAUTH_COOKIE, { path: USER_OAUTH_PATH, secure: true });
      return c.redirect(`/account/connect?error=${encodeURIComponent(code)}`, 303);
    };
    try {
      await enforceRateLimit(deps.rateLimiters.create, `account-auth:${clientIp(c)}`);
    } catch {
      return fail('rate_limited');
    }
    const stateParam = c.req.query('state') ?? '';
    const code = c.req.query('code') ?? '';
    const nonce = getCookie(c, USER_OAUTH_COOKIE) ?? '';
    if (!stateParam || stateParam.length > 200) return fail('invalid_state');
    const row = await adb.consumeOAuthState(await hashId(stateParam));
    if (!row) return fail('invalid_state');
    consumed = true;
    if (row.expires_at < now()) return fail('invalid_state');
    const nonceOk = constantTimeEqual(new TextEncoder().encode(await hashId(nonce)), new TextEncoder().encode(row.browser_nonce_hash));
    if (!nonce || !nonceOk) return fail('invalid_state');
    if (c.req.query('error') || !code || code.length > 500) return fail('authorization_failed');
    deleteCookie(c, USER_OAUTH_COOKIE, { path: USER_OAUTH_PATH, secure: true });

    let result;
    try {
      result = await (await workos()).authenticateWithCode(code, row.code_verifier);
    } catch (error) {
      if (error instanceof OperatorError && error.code === ('email_verification_required' as ApiError['code'])) return fail('email_not_verified');
      deps.logError?.('AuthKit code exchange failed (account)', error instanceof ApiError ? error.code : error);
      return fail('authorization_failed');
    }
    const { user } = result;
    // Only verified emails may sign in: AuthKit normally verifies before issuing a code, but
    // that depends on the environment's settings (and social providers), so it is enforced here.
    if (!user.emailVerified) return fail('email_not_verified');
    const existing = await adb.findUserByWorkosId(user.id);
    if (existing?.disabled_at) return fail('account_disabled');
    const key = await signingKey(true);
    if (!key) return fail('accounts_unavailable');
    const t = now();
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').slice(0, 120) || null;
    // Identity = WorkOS user id. The email is refreshed from WorkOS on every sign-in (email changes),
    // never used to link a WorkOS user to an existing account.
    const u = await adb.upsertUserOnSignIn({ id: existing?.id ?? deps.ids.uuid(), workosUserId: user.id, email: user.email, name, now: t });
    // No session fixation: any session this browser had is revoked and a new id is issued.
    const previous = await sessionIdFromCookie(c, key);
    const extra = previous ? [adb.revokeSessionStatement(await hashId(previous), t)] : [];
    await startUserSession(c, deps, adb, key, u.id, extra);
    recordSignIn('success');
    return c.redirect(`/account/connect?return_to=${encodeURIComponent(safeReturnTo(row.return_to))}`, 303);
  });

  /**
   * Sign out this browser. Works with the session cookie (CSRF-checked), with
   * this browser's device token in the Authorization header (for a browser
   * whose account session already expired), or both: the session and its
   * device token are revoked. Local data in the browser is never touched.
   */
  app.post('/sign-out', async (c) => {
    assertSameOrigin(c, allowedOrigins(c));
    const t = now();
    const s = await readUserSession(c, deps, adb, await signingKey(false));
    if (s) await enforceCsrf(c, s, allowedOrigins(c));
    let didSomething = false;
    const token = bearerToken(c.req.header('authorization'));
    const revokeAndLog = async (userId: string, deviceId: string) => {
      const device = await adb.findDevice(userId, deviceId);
      if (!device || !(await adb.revokeDevice(userId, deviceId, t))) return false;
      await recordAccountActivity(accountActivityContext(deps, c), accountEntry('account.device_revoked', device.workspace_id, { device: { id: device.id, label: device.device_label } }));
      return true;
    };
    if (token?.startsWith(TOKEN_PREFIX.workspace)) {
      const device = await adb.findActiveDeviceByHash(await sha256Hex(token));
      if (device) didSomething = await revokeAndLog(device.user_id, device.id);
    }
    if (s) {
      if (s.row.device_token_id) await revokeAndLog(s.user.id, s.row.device_token_id);
      await adb.raw.batch([adb.revokeSessionStatement(s.idHash, t)]);
      didSomething = true;
    }
    clearUserSessionCookie(c);
    if (!didSomething) throw accountError(401, 'unauthorized', 'Not signed in.');
    settings.invalidate();
    return c.body(null, 204);
  });

  /**
   * Why a device token stopped working, for the holder of that token only
   * (Bearer): `revoked` (signed out from another device / everywhere),
   * `account_disabled` (by the site operator) or `unknown`. Lets the app say
   * "you were signed out" instead of a generic disconnect.
   */
  app.get('/device-status', async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `account-device-status:${clientIp(c)}`);
    const token = bearerToken(c.req.header('authorization'));
    if (!token?.startsWith(TOKEN_PREFIX.workspace)) throw accountError(400, 'bad_request', 'Send the device token as a Bearer token.');
    const row = await adb.deviceStatusByHash(await sha256Hex(token));
    const status = !row ? 'unknown' : row.disabled_at ? 'account_disabled' : row.revoked_at ? 'revoked' : 'active';
    return c.json({ status });
  });

  // ---------------------------------------------------------------------------
  // Signed in
  // ---------------------------------------------------------------------------
  const authed = new Hono<AccEnv>();
  authed.use('*', session);

  async function ownedOrNull(userId: string) {
    return adb.ownedWorkspace(userId);
  }

  /** Mints a device token for this browser, binding it to the current session. */
  async function mintDevice(
    c: Context<AccEnv>,
    workspaceId: string,
    before: D1PreparedStatement[] = [],
    event?: 'account.workspace_created' | 'account.workspace_claimed',
  ) {
    const s = c.get('session');
    const token = deps.secrets.generate(TOKEN_PREFIX.workspace);
    const id = deps.ids.uuid();
    const t = now();
    const label = deviceLabelFromUserAgent(c.req.header('user-agent'));
    // Activity entries are committed in the same batch as the device token (server/services/activity.ts).
    const actx = accountActivityContext(deps, c);
    await adb.raw.batch([
      ...before,
      adb.insertDeviceTokenStatement({
        id,
        workspace_id: workspaceId,
        user_id: s.user.id,
        token_hash: await sha256Hex(token),
        device_label: label,
        created_at: t,
        revoked_at: null,
      }),
      ...(event ? accountWriteStatements(actx, accountEntry(event, workspaceId)) : []),
      ...accountWriteStatements(actx, accountEntry('account.device_signed_in', workspaceId, { device: { id, label } })),
    ]);
    await replaceSessionDevice(s, id);
    // Suspension is checked against an in-memory set of token hashes: refresh it for the new token.
    settings.invalidate();
    return { token, deviceId: id };
  }

  /** A session owns at most one device token: an older one it minted is revoked when replaced. */
  async function replaceSessionDevice(s: UserSession, deviceId: string) {
    const old = s.row.device_token_id;
    if (old && old !== deviceId) await adb.revokeDevice(s.user.id, old, now());
    await adb.bindSessionDevice(s.idHash, deviceId);
    s.row.device_token_id = deviceId;
  }

  authed.get('/session', async (c) => {
    const s = c.get('session');
    const ws = await ownedOrNull(s.user.id);
    return c.json<AccountSessionResponse>({
      user: { id: s.user.id, email: s.user.email, name: s.user.name, createdAt: s.user.created_at },
      workspace: ws ? workspaceView(ws) : null,
      csrfToken: await csrfTokenFor(s),
      session: { createdAt: s.row.created_at, expiresAt: s.row.expires_at, deviceId: s.row.device_token_id },
    });
  });

  /** Create a workspace for an account that has none (turns cloud sync on). No recovery key until the user asks for one. */
  authed.post('/workspace', async (c) => {
    const s = c.get('session');
    await enforceRateLimit(deps.rateLimiters.create, `workspace:${clientIp(c)}`);
    if (!settings.get('registration.workspacesOpen')) {
      throw accountError(403, 'registration_closed', 'New cloud-sync workspaces are not being accepted right now.');
    }
    if (await ownedOrNull(s.user.id)) throw accountError(409, 'workspace_exists', 'This account already has a workspace.');
    const id = deps.ids.uuid();
    const createdAt = deps.clock().toISOString();
    const disabledHash = `${DISABLED_TOKEN_HASH_PREFIX}${deps.ids.uuid()}`;
    let minted;
    try {
      minted = await mintDevice(c, id, [adb.createWorkspaceStatement(id, disabledHash, createdAt), adb.addOwnerStatement(id, s.user.id, now())], 'account.workspace_created');
    } catch (error) {
      if (await ownedOrNull(s.user.id)) throw accountError(409, 'workspace_exists', 'This account already has a workspace.');
      throw error;
    }
    return c.json<DeviceTokenResponse>(
      { workspace: { id, createdAt, recoveryKeyEnabled: false }, token: minted.token, deviceId: minted.deviceId },
      201,
    );
  });

  /**
   * Claim: attach the anonymous workspace whose token this browser holds (sent
   * as Bearer) to the account, as owner. The original token keeps working as
   * the recovery key; this browser gets its own device token.
   */
  authed.post('/workspace/claim', async (c) => {
    const s = c.get('session');
    await enforceRateLimit(deps.rateLimiters.create, `account-claim:${clientIp(c)}`);
    const token = bearerToken(c.req.header('authorization'));
    if (!token?.startsWith(TOKEN_PREFIX.workspace)) throw accountError(400, 'bad_request', 'Send the workspace token of this browser as a Bearer token.');
    const hash = await sha256Hex(token);
    const device = await adb.findActiveDeviceByHash(hash);
    if (device) {
      throw device.user_id === s.user.id
        ? accountError(409, 'workspace_exists', 'This workspace already belongs to your account.')
        : accountError(409, 'workspace_owned', 'This workspace belongs to another account.');
    }
    const ws = await adb.findWorkspaceByRecoveryHash(hash);
    if (!ws) throw accountError(401, 'unauthorized', 'That workspace token was not accepted.');
    if (await ownedOrNull(s.user.id)) throw accountError(409, 'workspace_exists', 'This account already has a workspace.');
    if (await adb.workspaceOwner(ws.id)) throw accountError(409, 'workspace_owned', 'This workspace belongs to another account.');
    let minted;
    try {
      minted = await mintDevice(c, ws.id, [adb.addOwnerStatement(ws.id, s.user.id, now())], 'account.workspace_claimed');
    } catch (error) {
      // Unique indexes: a concurrent claim won.
      if ((await adb.workspaceOwner(ws.id)) || (await ownedOrNull(s.user.id))) throw accountError(409, 'workspace_owned', 'This workspace was claimed concurrently.');
      throw error;
    }
    return c.json<DeviceTokenResponse>({
      workspace: { id: ws.id, createdAt: ws.created_at, recoveryKeyEnabled: true },
      token: minted.token,
      deviceId: minted.deviceId,
    });
  });

  /**
   * New device: give this browser a device token for the account's workspace.
   * If the browser sends its current token as Bearer: a device token of this
   * account for this workspace is kept (re-bound to the new session); any
   * other device token is revoked because this browser is replacing it.
   */
  authed.post('/workspace/connect', async (c) => {
    const s = c.get('session');
    await enforceRateLimit(deps.rateLimiters.create, `account-connect:${clientIp(c)}`);
    const ws = await ownedOrNull(s.user.id);
    if (!ws) throw accountError(409, 'no_workspace', 'This account has no workspace yet.');
    const current = bearerToken(c.req.header('authorization'));
    if (current?.startsWith(TOKEN_PREFIX.workspace)) {
      const device = await adb.findActiveDeviceByHash(await sha256Hex(current));
      if (device && device.user_id === s.user.id && device.workspace_id === ws.id) {
        await replaceSessionDevice(s, device.id);
        return c.json<DeviceTokenResponse>({ workspace: workspaceView(ws), token: current, deviceId: device.id, reused: true });
      }
      if (device) await adb.revokeDevice(device.user_id, device.id, now());
    }
    const minted = await mintDevice(c, ws.id);
    return c.json<DeviceTokenResponse>({ workspace: workspaceView(ws), token: minted.token, deviceId: minted.deviceId });
  });

  authed.get('/devices', async (c) => {
    const s = c.get('session');
    const rows = await adb.listDevices(s.user.id, now());
    return c.json<DevicesResponse>({
      devices: rows.map((r) => ({
        id: r.id,
        label: r.device_label,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        lastUsedAt: r.last_used_at ?? null,
        signedIn: r.signed_in > 0,
        current: r.id === s.row.device_token_id,
      })),
    });
  });

  authed.delete('/devices/:id', async (c) => {
    const s = c.get('session');
    const id = c.req.param('id');
    const device = await adb.findDevice(s.user.id, id);
    if (!device || !(await adb.revokeDevice(s.user.id, id, now()))) throw accountError(404, 'not_found', 'Device not found.');
    await recordAccountActivity(accountActivityContext(deps, c), accountEntry('account.device_revoked', device.workspace_id, { device: { id, label: device.device_label } }));
    if (id === s.row.device_token_id) clearUserSessionCookie(c);
    settings.invalidate();
    return c.body(null, 204);
  });

  /** "Sign out other devices" (keepThisDevice: true) or "Sign out everywhere". */
  authed.post('/sign-out-everywhere', async (c) => {
    const s = c.get('session');
    const { keepThisDevice } = await body(c, z.object({ keepThisDevice: z.boolean().default(false) }));
    const before = await adb.countActiveDevices(s.user.id);
    await adb.revokeAll(s.user.id, now(), keepThisDevice ? { sessionHash: s.idHash, deviceId: s.row.device_token_id } : undefined);
    const ws = await ownedOrNull(s.user.id);
    const revoked = before - (await adb.countActiveDevices(s.user.id));
    if (ws) {
      await recordAccountActivity(
        accountActivityContext(deps, c),
        accountEntry(keepThisDevice ? 'account.signed_out_other_devices' : 'account.signed_out_everywhere', ws.id, { changes: { counts: { devices: revoked } } }),
      );
    }
    if (!keepThisDevice) clearUserSessionCookie(c);
    settings.invalidate();
    return c.body(null, 204);
  });

  /** New recovery key (the original workspace token is replaced; the old one stops working). Shown once. */
  authed.post('/recovery-key/rotate', async (c) => {
    const s = c.get('session');
    const ws = await ownedOrNull(s.user.id);
    if (!ws) throw accountError(409, 'no_workspace', 'This account has no workspace yet.');
    const recoveryKey = deps.secrets.generate(TOKEN_PREFIX.workspace);
    await adb.setRecoveryTokenHash(ws.id, await sha256Hex(recoveryKey));
    await recordAccountActivity(
      accountActivityContext(deps, c),
      accountEntry(workspaceView(ws).recoveryKeyEnabled ? 'account.recovery_key_rotated' : 'account.recovery_key_created', ws.id),
    );
    settings.invalidate();
    return c.json<RecoveryKeyRotateResponse>({ recoveryKey });
  });

  /** Turns the recovery key off: only signed-in devices (and agents) keep access. */
  authed.post('/recovery-key/disable', async (c) => {
    const s = c.get('session');
    const ws = await ownedOrNull(s.user.id);
    if (!ws) throw accountError(409, 'no_workspace', 'This account has no workspace yet.');
    await adb.setRecoveryTokenHash(ws.id, `${DISABLED_TOKEN_HASH_PREFIX}${deps.ids.uuid()}`);
    if (workspaceView(ws).recoveryKeyEnabled) await recordAccountActivity(accountActivityContext(deps, c), accountEntry('account.recovery_key_disabled', ws.id));
    settings.invalidate();
    return c.json({ workspace: workspaceView({ ...ws, token_hash: DISABLED_TOKEN_HASH_PREFIX }) });
  });

  /**
   * Deletes the account: every session and device token, the membership and
   * the user row. The workspace is deleted too when asked; otherwise it is
   * kept and a fresh recovery key is returned so this browser can keep using
   * it anonymously (other signed-in devices are disconnected).
   */
  authed.delete('/', async (c) => {
    const s = c.get('session');
    const input = await body(c, z.object({ confirm: z.string().max(320), deleteWorkspace: z.boolean() }));
    if (input.confirm.trim().toLowerCase() !== s.user.email) throw accountError(400, 'validation_failed', 'Type your email address to confirm.');
    const ws = await ownedOrNull(s.user.id);
    let recoveryKey: string | null = null;
    if (ws && input.deleteWorkspace) {
      await repo.deleteWorkspace(ws.id);
      await createOperatorDb(deps.db).purgeWorkspaceOperatorRows(ws.id);
    } else if (ws) {
      recoveryKey = deps.secrets.generate(TOKEN_PREFIX.workspace);
      await adb.setRecoveryTokenHash(ws.id, await sha256Hex(recoveryKey));
      await recordAccountActivity(accountActivityContext(deps, c), accountEntry('account.deleted', ws.id));
    }
    await adb.deleteUser(s.user.id);
    clearUserSessionCookie(c);
    settings.invalidate();
    return c.json<DeleteAccountResponse>({ deletedWorkspace: !!ws && input.deleteWorkspace, recoveryKey });
  });

  app.route('/', authed);
  return app;
}

