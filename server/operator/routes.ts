/**
 * /api/operator/* — the private operator-console API. Cookie sessions only:
 * any request carrying an Authorization header is refused, and the public API
 * never reads the operator cookie (it is scoped to /api/operator anyway).
 */
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type {
  AgentsResponse,
  AuditResponse,
  DeploymentsResponse,
  EncryptionStatusResponse,
  OperatorStatusResponse,
  OverviewResponse,
  RecoveryKeyResponse,
  SecurityResponse,
  SessionResponse,
  SettingsResponse,
  SetupStateResponse,
  SetupStep,
  TelemetryResponse,
  WorkspacesResponse,
} from '../../shared/operator';
import { parseScopes } from '../auth';
import type { Repository } from '../db/repository';
import type { AppDeps } from '../deps';
import { clientIp, enforceRateLimit, publicBaseUrl, readJson } from '../http';
import {
  OAUTH_COOKIE,
  OAUTH_PATH,
  assertNotLocked,
  attemptKeys,
  clearSessionCookie,
  clientInfo,
  csrfTokenFor,
  enforceCsrf,
  hashId,
  readSession,
  recordFailure,
  setupSigningKey,
  startSession,
  type OperatorSession,
} from './auth';
import { constantTimeEqual, fromBase64Url, randomBytes, secretsEqual, toBase64Url } from './crypto';
import type { OperatorDb, OperatorStateRow } from './db';
import { OperatorError } from './errors';
import { createGithubClient } from './github';
import { lockedError } from './keystore';
import { SNAPSHOT_TTL_MS, type Actor } from './settings';
import { SETTINGS } from './settings-registry';
import { groupOf, series, summarize } from './telemetry';
import { createWorkosClient, pkcePair } from './workos';

type OpEnv = { Variables: { session: OperatorSession } };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OAUTH_TTL_MS = 10 * 60_000;
const BODY_LIMIT = 16 * 1024;

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw = await readJson(c, BODY_LIMIT);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw OperatorError.validation(parsed.error.issues[0]?.message ?? 'Invalid request body', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

const masterKeyInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('generate') }),
  z.object({ mode: z.literal('passphrase'), passphrase: z.string().max(1024) }),
]);

export function createOperatorRoutes(deps: AppDeps, repo: Repository, odb: OperatorDb) {
  const app = new Hono<OpEnv>();
  const settings = deps.settings;
  const keystore = settings.keystore;
  const now = () => deps.clock().getTime();
  let setupKeyCache: { salt: string; key: Uint8Array } | null = null;

  const initialPassword = () => deps.operator.initialPassword ?? '';

  async function state(): Promise<OperatorStateRow> {
    return (await odb.getState()) ?? (await odb.ensureState(now(), toBase64Url(randomBytes(16))));
  }

  async function setupKey(): Promise<Uint8Array> {
    const s = await state();
    if (setupKeyCache?.salt !== s.setup_salt) setupKeyCache = { salt: s.setup_salt, key: await setupSigningKey(initialPassword(), s.setup_salt) };
    return setupKeyCache.key;
  }

  async function fullKey(create = false): Promise<Uint8Array | null> {
    try {
      if (!(await keystore.isUnlocked())) return null;
      await settings.refresh();
      let k = await settings.getSecret('operator.sessionSigningKey');
      if (!k && create) {
        k = toBase64Url(randomBytes(32));
        await settings.set('operator.sessionSigningKey', k, { type: 'system', id: null, email: null });
      }
      return k ? fromBase64Url(k) : null;
    } catch (error) {
      deps.logError?.('Operator session key unavailable', error);
      return null;
    }
  }

  const keys = { setup: async () => setupKey(), full: async () => fullKey(false) };

  function allowedOrigins(c: Context): string[] {
    const out = [new URL(c.req.url).origin];
    if (deps.config.appUrl) {
      try {
        out.push(new URL(deps.config.appUrl).origin);
      } catch {
        // invalid app.url is rejected by validation; ignore here
      }
    }
    return out;
  }

  /** Unauthenticated POSTs (login, recovery) still require a same-origin browser request. */
  function requireSameOrigin(c: Context) {
    const origin = c.req.header('origin');
    if (origin ? !allowedOrigins(c).includes(origin) : c.req.header('sec-fetch-site') !== undefined && c.req.header('sec-fetch-site') !== 'same-origin') {
      throw OperatorError.csrf();
    }
  }

  const actorOf = (c: Context<OpEnv>): Actor => {
    const s = c.get('session');
    return { type: s.kind === 'full' ? 'operator' : 'bootstrap', id: s.operator?.id ?? null, email: s.operator?.email ?? null, ip: clientInfo(c).ip };
  };
  const audit = (c: Context<OpEnv>, action: string, target?: string | null, detail?: Record<string, unknown> | null) => {
    const a = actorOf(c);
    return odb.audit({ at: now(), actorType: a.type, actorId: a.id, actorEmail: a.email, action, target, detail, ip: a.ip });
  };

  const redirectUri = (c: Context) => `${publicBaseUrl(c, deps.config.appUrl)}/api/operator/auth/callback`;

  async function workos() {
    const apiKey = await settings.getSecret('workos.apiKey');
    const clientId = settings.get('workos.clientId');
    if (!apiKey || !clientId) throw OperatorError.conflict('workos_not_configured', 'WorkOS credentials are not configured.');
    return createWorkosClient({ apiKey, clientId, baseUrl: deps.operator.workosBaseUrl, fetch: deps.operator.fetch });
  }

  async function startOAuth(c: Context, purpose: 'setup' | 'login', setupSessionHash: string | null, loginHint?: string) {
    const client = await workos();
    const stateValue = toBase64Url(randomBytes(32));
    const nonce = toBase64Url(randomBytes(32));
    const { verifier, challenge } = await pkcePair();
    const t = now();
    await odb.insertOAuthState({
      state_hash: await hashId(stateValue),
      browser_nonce_hash: await hashId(nonce),
      code_verifier: verifier,
      purpose,
      setup_session_hash: setupSessionHash,
      created_at: t,
      expires_at: t + OAUTH_TTL_MS,
    });
    setCookie(c, OAUTH_COOKIE, nonce, { path: OAUTH_PATH, httpOnly: true, secure: true, sameSite: 'Lax', maxAge: OAUTH_TTL_MS / 1000 });
    return client.authorizationUrl({
      redirectUri: redirectUri(c),
      state: stateValue,
      codeChallenge: challenge,
      screenHint: purpose === 'setup' ? 'sign-up' : 'sign-in',
      loginHint,
    });
  }

  async function setupStep(): Promise<SetupStep> {
    const s = await state();
    if (!s.mk_kcv) return 'encryption';
    if (!s.mk_confirmed_at) return 'encryption_confirm';
    await settings.refresh(true);
    const list = await settings.list();
    const apiKey = list.find((x) => x.key === 'workos.apiKey');
    if (!settings.get('workos.clientId') || !apiKey?.isSet) return 'workos';
    return 'identity';
  }

  async function requireStep(...allowed: SetupStep[]) {
    const step = await setupStep();
    if (!allowed.includes(step)) throw OperatorError.conflict('wrong_step', `This setup step is not available now (current step: ${step}).`);
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    c.header('x-robots-tag', 'noindex, nofollow');
    if (!deps.operator.initialPassword) throw OperatorError.notConfigured();
    if (c.req.header('authorization')) {
      throw OperatorError.unauthenticated('The operator console does not accept API tokens or agent keys.');
    }
    await next();
  });

  const session = (kind: 'setup' | 'full' | 'any') =>
    createMiddleware<OpEnv>(async (c, next) => {
      const s = await readSession(c, deps, odb, keys);
      if (!s) {
        clearSessionCookie(c);
        throw OperatorError.unauthenticated();
      }
      if (kind !== 'any' && s.kind !== kind) {
        throw OperatorError.forbidden(s.kind === 'setup' ? 'A setup session can only be used for the setup wizard.' : 'Setup is already complete.');
      }
      if (s.kind === 'setup' && (await state()).bootstrap_completed_at) {
        clearSessionCookie(c);
        throw OperatorError.unauthenticated('Setup is complete. Sign in with WorkOS.');
      }
      await enforceCsrf(c, s, allowedOrigins(c));
      c.set('session', s);
      await next();
    });

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------
  app.get('/status', async (c) => {
    const s = await state();
    const enc = s.mk_kcv && s.mk_confirmed_at ? (await keystore.status()).state === 'locked' : false;
    return c.json<OperatorStatusResponse>({ phase: s.bootstrap_completed_at ? 'ready' : 'bootstrap', encryptionLocked: enc });
  });

  app.post('/bootstrap/login', async (c) => {
    requireSameOrigin(c);
    const s = await state();
    if (s.bootstrap_completed_at) throw OperatorError.forbidden('The bootstrap login is disabled. Sign in with WorkOS.');
    const ip = clientInfo(c).ip;
    const keysFor = attemptKeys('bootstrap', ip);
    await enforceRateLimit(deps.rateLimiters.create, `operator-bootstrap:${clientIp(c)}`);
    await assertNotLocked(odb, keysFor, now());
    const { password } = await body(c, z.object({ password: z.string().max(1024) }));
    if (!(await secretsEqual(password, initialPassword()))) {
      await recordFailure(odb, keysFor, now());
      await odb.audit({ at: now(), actorType: 'bootstrap', action: 'bootstrap.login_failed', ip });
      throw new OperatorError(401, 'invalid_credentials', 'Invalid credentials.');
    }
    await odb.clearAttempts(keysFor.ip);
    const { csrfToken, expiresAt } = await startSession(c, deps, odb, 'setup', await setupKey(), null, [
      odb.auditStatement({ at: now(), actorType: 'bootstrap', action: 'bootstrap.login', ip }),
    ]);
    return c.json<SessionResponse>({ kind: 'setup', csrfToken, expiresAt, operator: null });
  });

  app.post('/auth/login', async (c) => {
    requireSameOrigin(c);
    const s = await state();
    if (!s.bootstrap_completed_at) throw OperatorError.conflict('setup_pending', 'Complete the first-run setup first.');
    await enforceRateLimit(deps.rateLimiters.create, `operator-login:${clientIp(c)}`);
    if (!(await keystore.isUnlocked())) throw lockedError((await keystore.status()).problem);
    await settings.refresh();
    return c.json({ authorizationUrl: await startOAuth(c, 'login', null) });
  });

  app.get('/auth/callback', async (c) => {
    // The nonce cookie is only cleared once a real state row was consumed, so a forged
    // callback cannot cancel a sign-in that is in progress in this browser.
    let consumed = false;
    const fail = (code: string) => {
      if (consumed) deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_PATH, secure: true });
      return c.redirect(`/operator?error=${encodeURIComponent(code)}`, 303);
    };
    const stateParam = c.req.query('state') ?? '';
    const code = c.req.query('code') ?? '';
    const nonce = getCookie(c, OAUTH_COOKIE) ?? '';
    if (!stateParam || stateParam.length > 200) return fail('invalid_state');
    const row = await odb.consumeOAuthState(await hashId(stateParam));
    if (!row) return fail('invalid_state');
    consumed = true;
    if (row.expires_at < now()) return fail('invalid_state');
    const nonceOk = constantTimeEqual(new TextEncoder().encode(await hashId(nonce)), new TextEncoder().encode(row.browser_nonce_hash));
    if (!nonce || !nonceOk) return fail('invalid_state');
    if (c.req.query('error') || !code || code.length > 500) return fail('authorization_failed');
    deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_PATH, secure: true });

    await settings.refresh();
    let result;
    try {
      result = await (await workos()).authenticateWithCode(code, row.code_verifier);
    } catch (error) {
      deps.logError?.('AuthKit code exchange failed', error instanceof OperatorError ? error.code : error);
      return fail('authorization_failed');
    }
    const { user } = result;
    const t = now();
    const ip = clientInfo(c).ip;
    const signingKey = await fullKey(true);
    if (!signingKey) return fail('encryption_locked');

    if (row.purpose === 'setup') {
      const st = await state();
      const setupSession = row.setup_session_hash ? await odb.findSession(row.setup_session_hash) : null;
      if (st.bootstrap_completed_at || !setupSession || setupSession.revoked_at || setupSession.expires_at < t) return fail('setup_expired');
      const operatorId = deps.ids.uuid();
      try {
        await startSession(c, deps, odb, 'full', signingKey, operatorId, [
          odb.updateStateStatement({ bootstrap_completed_at: t }, { bootstrap_completed_at: null }),
          odb.insertFirstOperatorStatement(
            { id: operatorId, workos_user_id: user.id, email: user.email, added_at: t, added_by: 'bootstrap', last_sign_in_at: t },
            t,
          ),
          odb.revokeSetupSessionsStatement(t),
          odb.bumpConfigVersionStatement(),
          odb.auditStatement({ at: t, actorType: 'operator', actorId: operatorId, actorEmail: user.email, action: 'bootstrap.completed', target: user.id, ip }),
        ]);
      } catch (error) {
        deps.logError?.('Bootstrap completion failed', error);
        clearSessionCookie(c);
        return fail('setup_failed');
      }
      if (!(await odb.findOperatorByWorkosId(user.id))) {
        clearSessionCookie(c);
        return fail('setup_failed');
      }
      return c.redirect('/operator', 303);
    }

    // Sign-in: the WorkOS user must be on the allowlist (by user id, or by verified email for invited operators).
    let op = await odb.findOperatorByWorkosId(user.id);
    if (!op && user.emailVerified) {
      const invited = await odb.findUnboundOperatorByEmail(user.email);
      if (invited && (await odb.bindOperator(invited.id, user.id, t))) op = await odb.findOperator(invited.id);
    }
    if (!op) {
      await odb.audit({ at: t, actorType: 'operator', actorEmail: user.email, actorId: null, action: 'auth.denied', target: user.id, ip });
      return fail('not_an_operator');
    }
    await odb.touchOperatorSignIn(op.id, t);
    await startSession(c, deps, odb, 'full', signingKey, op.id, [
      odb.auditStatement({ at: t, actorType: 'operator', actorId: op.id, actorEmail: op.email, action: 'auth.sign_in', detail: { method: result.authenticationMethod }, ip }),
    ]);
    return c.redirect('/operator', 303);
  });

  app.post('/recover', async (c) => {
    requireSameOrigin(c);
    const ip = clientInfo(c).ip;
    const k = attemptKeys('recovery', ip);
    await enforceRateLimit(deps.rateLimiters.create, `operator-recover:${clientIp(c)}`);
    await assertNotLocked(odb, k, now());
    const { recoveryKey } = await body(c, z.object({ recoveryKey: z.string().min(1).max(1024) }));
    const ok = await keystore.recover(recoveryKey);
    if (!ok) {
      await recordFailure(odb, k, now());
      await odb.audit({ at: now(), actorType: 'recovery', action: 'encryption.recovery_failed', ip });
      throw new OperatorError(401, 'invalid_credentials', 'That recovery key does not match.');
    }
    await odb.clearAttempts(k.ip);
    await odb.audit({ at: now(), actorType: 'recovery', action: 'encryption.recovered', ip });
    settings.invalidate();
    return c.json({ recovered: true });
  });

  // ---------------------------------------------------------------------------
  // Any session
  // ---------------------------------------------------------------------------
  app.get('/session', session('any'), async (c) => {
    const s = c.get('session');
    return c.json<SessionResponse>({
      kind: s.kind,
      csrfToken: await csrfTokenFor(s),
      expiresAt: s.row.expires_at,
      operator: s.operator ? { id: s.operator.id, email: s.operator.email } : null,
    });
  });

  app.post('/logout', session('any'), async (c) => {
    const s = c.get('session');
    const a = actorOf(c);
    await odb.raw.batch([
      odb.revokeSessionStatement(s.idHash, now()),
      odb.auditStatement({ at: now(), actorType: a.type, actorId: a.id, actorEmail: a.email, action: 'auth.sign_out', ip: a.ip }),
    ]);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------------------
  // Setup wizard (setup session only)
  // ---------------------------------------------------------------------------
  app.get('/setup', session('setup'), async (c) => {
    const s = await state();
    const step = await setupStep();
    const list = await settings.list();
    const apiKey = list.find((x) => x.key === 'workos.apiKey');
    return c.json<SetupStateResponse>({
      step,
      encryption: { initialized: !!s.mk_kcv, confirmed: !!s.mk_confirmed_at, source: s.mk_kcv ? (s.mk_passphrase_salt ? 'passphrase' : 'generated') : null },
      workos: {
        configured: step === 'identity',
        clientId: settings.get('workos.clientId') || null,
        apiKeyLast4: apiKey?.last4 ?? null,
        redirectUri: redirectUri(c),
      },
      workosEmulator: deps.operator.workosBaseUrl ?? null,
    });
  });

  app.post('/setup/encryption', session('setup'), async (c) => {
    await requireStep('encryption', 'encryption_confirm');
    const input = await body(c, masterKeyInput);
    const result = await keystore.initialize(input);
    await audit(c, 'encryption.master_key_created', null, { source: input.mode === 'generate' ? 'generated' : 'passphrase' });
    settings.invalidate();
    return c.json<RecoveryKeyResponse>({ recoveryKey: result.recoveryKey });
  });

  app.post('/setup/encryption/confirm', session('setup'), async (c) => {
    await requireStep('encryption_confirm');
    await body(c, z.object({ saved: z.literal(true, { message: 'Confirm that the recovery key is saved' }) }));
    await keystore.confirm();
    await audit(c, 'encryption.recovery_key_confirmed');
    return c.json({ step: await setupStep() });
  });

  app.post('/setup/workos', session('setup'), async (c) => {
    await requireStep('workos', 'identity');
    const input = await body(c, z.object({ apiKey: z.string().trim().min(1).max(500), clientId: z.string().trim().min(1).max(200) }));
    for (const [key, value] of [['workos.apiKey', input.apiKey], ['workos.clientId', input.clientId]] as const) {
      const parsed = SETTINGS[key].schema.safeParse(value);
      if (!parsed.success) throw OperatorError.validation(parsed.error.issues[0]?.message ?? 'Invalid value', { field: key });
    }
    const problems = await createWorkosClient({
      apiKey: input.apiKey,
      clientId: input.clientId,
      baseUrl: deps.operator.workosBaseUrl,
      fetch: deps.operator.fetch,
    }).validateCredentials();
    if (problems.length) throw OperatorError.validation(problems.join(' '), { problems });
    const actor = actorOf(c);
    await settings.set('workos.clientId', input.clientId, actor);
    await settings.set('workos.apiKey', input.apiKey, actor);
    return c.json({ step: await setupStep() });
  });

  app.post('/setup/identity', session('setup'), async (c) => {
    await requireStep('identity');
    const { loginHint } = await body(c, z.object({ loginHint: z.email().max(320).optional() }));
    if (!(await fullKey(true))) throw lockedError((await keystore.status()).problem);
    const url = await startOAuth(c, 'setup', c.get('session').idHash, loginHint);
    await audit(c, 'bootstrap.identity_started');
    return c.json({ authorizationUrl: url });
  });

  // ---------------------------------------------------------------------------
  // Dashboard (full operator session)
  // ---------------------------------------------------------------------------
  const full = new Hono<OpEnv>();
  full.use('*', session('full'));

  full.get('/overview', async (c) => {
    const t = now();
    const since7 = t - 7 * DAY;
    const counts = await odb.overviewCounts(new Date(since7).toISOString(), since7, t);
    const rows = (await odb.rollups('h', since7)).filter((r) => !r.metric.startsWith('operator|'));
    const rows24 = rows.filter((r) => r.bucket >= t - DAY);
    const stats = (rs: typeof rows) => {
      const { total } = summarize(rs);
      return { requests: total.count, errors: total.errors, errorRate: total.errorRate, p50Ms: total.p50Ms, p95Ms: total.p95Ms };
    };
    const by = (creator: string) => {
      const r = counts.invoicesByCreator.find((x) => x.creator === creator);
      return { total: r?.total ?? 0, recent: r?.recent ?? 0 };
    };
    const since14 = new Date(t - 14 * DAY).toISOString();
    return c.json<OverviewResponse>({
      generatedAt: t,
      workspaces: {
        total: counts.workspaces.total ?? 0,
        recent: counts.workspaces.recent ?? 0,
        active7d: counts.activeWorkspaces,
        suspended: counts.suspended,
      },
      invoices: { total: counts.invoices.total ?? 0, recent: counts.invoices.recent ?? 0, byCreator: { user: by('user'), agent: by('agent') } },
      clients: { total: counts.clients.total ?? 0, recent: counts.clients.recent ?? 0 },
      agents: { active: counts.agents.active ?? 0, revoked: counts.agents.revoked ?? 0, pendingRegistrations: counts.pendingRegistrations },
      api: { last24h: stats(rows24), last7d: stats(rows) },
      requestsHourly: series(rows24, t - DAY + HOUR, t, HOUR),
      workspacesDaily: await odb.dailyCreations('workspaces', since14),
      invoicesDaily: await odb.dailyCreations('invoices', since14),
    });
  });

  full.get('/telemetry', async (c) => {
    const range = (['1h', '24h', '7d'] as const).find((r) => r === c.req.query('range')) ?? '24h';
    const t = now();
    const span = range === '1h' ? HOUR : range === '24h' ? DAY : 7 * DAY;
    const rows = range === '1h' ? await odb.rollups('m', t - span) : await odb.rollups('h', t - span);
    const { metrics, total } = summarize(rows);
    const groupMap = new Map<string, typeof rows>();
    for (const r of rows) {
      const g = groupOf(r.metric).group;
      groupMap.set(g, [...(groupMap.get(g) ?? []), r]);
    }
    const groups = [...groupMap.entries()]
      .map(([group, rs]) => {
        const s = summarize(rs).total;
        return { group, service: groupOf(rs[0].metric).service, requests: s.count, errors: s.errors, errorRate: s.errorRate, p50Ms: s.p50Ms, p95Ms: s.p95Ms };
      })
      .sort((a, b) => b.requests - a.requests);
    const funnelRows = await odb.registrationFunnel(t - span, t);
    const n = (status: string) => funnelRows.find((r) => r.status === status)?.n ?? 0;
    const expired = funnelRows.reduce((a, r) => a + (r.expired ?? 0), 0);
    let d1: TelemetryResponse['d1'];
    try {
      d1 = { ok: true, ...(await odb.probe()) };
    } catch {
      d1 = { ok: false, latencyMs: null, sizeBytes: null, migration: null, error: 'D1 probe failed' };
    }
    const step = range === '1h' ? 60_000 : range === '24h' ? HOUR : 6 * HOUR;
    return c.json<TelemetryResponse>({
      range,
      generatedAt: t,
      totals: {
        requests: total.count,
        errors: total.errors,
        errorRate: total.errorRate,
        p50Ms: total.p50Ms,
        p95Ms: total.p95Ms,
        authFailures: total.authFailures,
        rateLimited: total.rateLimited,
        clientErrors: total.clientErrors,
        maintenance: total.maintenance,
      },
      groups,
      metrics,
      series: series(rows, t - span + step, t, step),
      registrationFunnel: {
        registered: funnelRows.reduce((a, r) => a + r.n, 0),
        approved: n('approved') + n('redeemed'),
        redeemed: n('redeemed'),
        denied: n('denied'),
        expired,
        pending: Math.max(0, n('pending') - (funnelRows.find((r) => r.status === 'pending')?.expired ?? 0)),
      },
      recentErrors: await odb.recentErrors(50),
      d1,
      notes: [
        'Static assets are served by Cloudflare before the Worker runs, so they are not counted here (see the Cloudflare dashboard).',
        'Durations are measured inside the Worker; on Cloudflare the clock only advances across I/O, so they reflect D1/subrequest time rather than CPU.',
        'Agent registrations are counted from D1 rows; expired registrations are purged after a while.',
      ],
    });
  });

  const cursor = {
    encode: (parts: string[]) => btoa(JSON.stringify(parts)).replace(/=+$/, ''),
    decode: (v: string | undefined): string[] | null => {
      if (!v) return null;
      try {
        const parsed = JSON.parse(atob(v)) as unknown;
        return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? (parsed as string[]) : null;
      } catch {
        return null;
      }
    },
  };

  full.get('/workspaces', async (c) => {
    const limit = 50;
    const after = cursor.decode(c.req.query('cursor'));
    const search = (c.req.query('q') ?? '').trim().slice(0, 64);
    const statusQ = c.req.query('status');
    const status = statusQ === 'suspended' || statusQ === 'active' ? statusQ : 'all';
    const rows = await odb.listWorkspaces({ search: search || undefined, status, afterCreated: after?.[0], afterId: after?.[1], limit: limit + 1 });
    const page = rows.slice(0, limit);
    return c.json<WorkspacesResponse>({
      workspaces: page.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        lastActivityAt: r.last_seen_at,
        invoiceCount: r.invoice_count,
        agentCount: r.agent_count,
        clientCount: r.client_count,
        suspended: r.suspended_at !== null,
        suspendedAt: r.suspended_at,
        suspensionReason: r.suspension_reason,
      })),
      next: rows.length > limit ? cursor.encode([page[page.length - 1].created_at, page[page.length - 1].id]) : null,
    });
  });

  full.post('/workspaces/:id/suspend', async (c) => {
    const id = c.req.param('id');
    const { reason } = await body(c, z.object({ reason: z.string().trim().max(200).optional() }));
    const a = actorOf(c);
    if (!(await odb.workspaceExists(id))) throw OperatorError.notFound('Workspace not found');
    await odb.suspendWorkspace(id, now(), a.email ?? 'operator', reason || null, {
      at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'workspace.suspend', target: id, detail: reason ? { reason } : null, ip: a.ip,
    });
    settings.invalidate();
    await settings.refresh(true);
    return c.json({ suspended: true });
  });

  full.post('/workspaces/:id/unsuspend', async (c) => {
    const id = c.req.param('id');
    const a = actorOf(c);
    const changed = await odb.unsuspendWorkspace(id, { at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'workspace.unsuspend', target: id, ip: a.ip });
    if (!changed) throw OperatorError.notFound('Workspace is not suspended');
    settings.invalidate();
    await settings.refresh(true);
    return c.json({ suspended: false });
  });

  full.delete('/workspaces/:id', async (c) => {
    const id = c.req.param('id');
    const { confirm } = await body(c, z.object({ confirm: z.string() }));
    if (confirm !== id) throw OperatorError.validation('Type the workspace id to confirm deletion.', { field: 'confirm' });
    if (!(await odb.workspaceExists(id))) throw OperatorError.notFound('Workspace not found');
    await repo.deleteWorkspace(id); // invoices, clients, settings, agents, registrations
    await odb.purgeWorkspaceOperatorRows(id);
    await audit(c, 'workspace.delete', id);
    settings.invalidate();
    return c.body(null, 204);
  });

  full.get('/agents', async (c) => {
    const limit = 50;
    const statusQ = c.req.query('status');
    const status = statusQ === 'active' || statusQ === 'revoked' ? statusQ : 'all';
    const before = cursor.decode(c.req.query('cursor'))?.[0];
    const rows = await odb.listAgents({ search: (c.req.query('q') ?? '').trim().slice(0, 64) || undefined, status, before, limit: limit + 1 });
    const page = rows.slice(0, limit);
    return c.json<AgentsResponse>({
      agents: page.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        scopes: parseScopes(r.scopes),
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        revokedAt: r.revoked_at,
      })),
      next: rows.length > limit ? cursor.encode([page[page.length - 1].created_at]) : null,
    });
  });

  full.post('/agents/:id/revoke', async (c) => {
    const agent = await odb.findAgent(c.req.param('id'));
    if (!agent) throw OperatorError.notFound('Agent not found');
    const result = await repo.revokeAgent(agent.workspace_id, agent.id, new Date(now()).toISOString());
    if (result === 'revoked') await audit(c, 'agent.revoke', agent.id, { workspaceId: agent.workspace_id });
    settings.invalidate();
    return c.json({ result });
  });

  full.get('/settings', async (c) => {
    const list = await settings.list();
    return c.json<SettingsResponse>({
      settings: list.map((s) => ({ ...s, options: s.options ? [...s.options] : undefined })) as SettingsResponse['settings'],
      configVersion: settings.configVersion,
      propagationSeconds: SNAPSHOT_TTL_MS / 1000,
      encryptionLocked: !(await keystore.isUnlocked()),
    });
  });

  full.put('/settings/:key', async (c) => {
    const { value } = await body(c, z.object({ value: z.unknown() }));
    await settings.set(c.req.param('key'), value, actorOf(c));
    return c.json({ ok: true, configVersion: settings.configVersion });
  });

  full.delete('/settings/:key', async (c) => {
    await settings.reset(c.req.param('key'), actorOf(c));
    return c.json({ ok: true, configVersion: settings.configVersion });
  });

  full.post('/runtime/reload', async (c) => {
    const a = actorOf(c);
    await odb.raw.batch([
      odb.bumpConfigVersionStatement(),
      odb.auditStatement({ at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'runtime.reload', ip: a.ip }),
    ]);
    settings.invalidate();
    await settings.refresh(true);
    return c.json({ configVersion: settings.configVersion, propagationSeconds: SNAPSHOT_TTL_MS / 1000 });
  });

  async function github() {
    const token = await settings.getSecret('github.token');
    const repository = settings.get('github.repository');
    const missing = [!token && 'github.token', !repository && 'github.repository'].filter(Boolean) as string[];
    return {
      missing,
      client:
        missing.length === 0
          ? createGithubClient({ apiUrl: settings.get('github.apiUrl'), token: token!, repository, workflow: settings.get('github.workflow'), fetch: deps.operator.fetch })
          : null,
    };
  }

  full.get('/deployments', async (c) => {
    let gh: Awaited<ReturnType<typeof github>> = { missing: [], client: null };
    let runsError: string | null = null;
    try {
      gh = await github();
    } catch (error) {
      runsError = error instanceof OperatorError ? error.message : 'GitHub settings unavailable';
    }
    let runs: DeploymentsResponse['runs'] = [];
    if (gh.client) {
      try {
        runs = await gh.client.listRuns(10);
      } catch (error) {
        runsError = error instanceof OperatorError ? error.message : 'Could not load workflow runs';
      }
    }
    const vm = deps.operator.versionMetadata;
    return c.json<DeploymentsResponse>({
      configured: !!gh.client,
      missing: gh.missing,
      repository: settings.get('github.repository') || null,
      workflow: settings.get('github.workflow') || null,
      ref: settings.get('github.ref') || null,
      runs,
      runsError,
      version: { id: vm?.id ?? null, tag: vm?.tag ?? null, timestamp: vm?.timestamp ?? null },
      build: { sha: deps.operator.build?.sha ?? null, time: deps.operator.build?.time ?? null },
      configVersion: settings.configVersion,
      propagationSeconds: SNAPSHOT_TTL_MS / 1000,
    });
  });

  full.post('/deployments/redeploy', async (c) => {
    const gh = await github();
    if (!gh.client) throw OperatorError.conflict('deploy_not_configured', `Configure ${gh.missing.join(', ')} in Settings first.`);
    const ref = settings.get('github.ref') || 'main';
    await gh.client.dispatch(ref);
    await audit(c, 'deploy.redeploy', `${settings.get('github.repository')}:${settings.get('github.workflow')}@${ref}`);
    return c.json({ dispatched: true, ref }, 202);
  });

  full.get('/audit', async (c) => {
    const limit = 100;
    const before = Number(cursor.decode(c.req.query('cursor'))?.[0] ?? 0) || undefined;
    const rows = await odb.listAudit({
      action: (c.req.query('action') ?? '').trim().slice(0, 64) || undefined,
      actor: (c.req.query('actor') ?? '').trim().slice(0, 120) || undefined,
      before,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    return c.json<AuditResponse>({
      entries: page.map((r) => {
        let detail: Record<string, unknown> | null;
        try {
          detail = r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null;
        } catch {
          detail = null;
        }
        return { id: r.id, at: r.at, actorType: r.actor_type, actorId: r.actor_id, actorEmail: r.actor_email, action: r.action, target: r.target, detail, ip: r.ip };
      }),
      next: rows.length > limit ? cursor.encode([String(page[page.length - 1].id)]) : null,
    });
  });

  full.get('/security', async (c) => {
    const s = c.get('session');
    const [operators, sessions, encryption] = await Promise.all([odb.listOperators(), odb.listActiveSessions(now()), keystore.status()]);
    return c.json<SecurityResponse>({
      operators: operators.map((o) => ({
        id: o.id,
        email: o.email,
        workosUserId: o.workos_user_id,
        addedAt: o.added_at,
        addedBy: o.added_by,
        lastSignInAt: o.last_sign_in_at,
        pending: !o.workos_user_id,
      })),
      sessions: sessions.map((r) => ({
        id: r.id_hash,
        kind: r.kind,
        email: r.email,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        ip: r.ip,
        userAgent: r.user_agent,
        current: r.id_hash === s.idHash,
      })),
      encryption: encryption as EncryptionStatusResponse,
    });
  });

  full.post('/operators', async (c) => {
    const { email } = await body(c, z.object({ email: z.email().max(320) }));
    const a = actorOf(c);
    const id = deps.ids.uuid();
    try {
      await odb.raw.batch([
        odb.insertOperatorStatement({ id, workos_user_id: null, email: email.toLowerCase(), added_at: now(), added_by: a.email, last_sign_in_at: null }),
        odb.auditStatement({ at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'operator.add', target: email.toLowerCase(), ip: a.ip }),
      ]);
    } catch {
      throw OperatorError.conflict('operator_exists', 'That email is already on the allowlist.');
    }
    return c.json({ id }, 201);
  });

  full.delete('/operators/:id', async (c) => {
    const a = actorOf(c);
    const target = await odb.findOperator(c.req.param('id'));
    const result = await odb.deleteOperatorUnlessLast(c.req.param('id'), {
      at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'operator.remove', target: target?.email ?? c.req.param('id'), ip: a.ip,
    });
    if (result === 'last') throw OperatorError.conflict('last_operator', 'The last operator cannot be removed.');
    if (result === 'not_found') throw OperatorError.notFound('Operator not found');
    return c.body(null, 204);
  });

  full.delete('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[0-9a-f]{64}$/.test(id)) throw OperatorError.notFound('Session not found');
    const a = actorOf(c);
    await odb.raw.batch([
      odb.revokeSessionStatement(id, now()),
      odb.auditStatement({ at: now(), actorType: 'operator', actorId: a.id, actorEmail: a.email, action: 'session.revoke', target: id.slice(0, 12), ip: a.ip }),
    ]);
    if (id === c.get('session').idHash) clearSessionCookie(c);
    return c.body(null, 204);
  });

  full.post('/security/rotate-dek', async (c) => {
    const result = await keystore.rotateDek();
    await audit(c, 'encryption.dek_rotated', null, { dekVersion: result.dekVersion, reencrypted: result.reencrypted });
    settings.invalidate();
    return c.json(result);
  });

  full.post('/security/rotate-master', async (c) => {
    const input = await body(c, masterKeyInput);
    const result = await keystore.rotateMaster(input);
    await audit(c, result.pending ? 'encryption.master_rotation_prepared' : 'encryption.master_rotated', null, {
      source: input.mode === 'generate' ? 'generated' : 'passphrase',
    });
    settings.invalidate();
    return c.json<RecoveryKeyResponse>(result);
  });

  full.post('/security/rewrap', async (c) => {
    const { newInitialPassword } = await body(c, z.object({ newInitialPassword: z.string().max(1024) }));
    await keystore.prepareRewrap(newInitialPassword);
    await audit(c, 'encryption.rewrap_prepared');
    settings.invalidate();
    return c.json({ pending: true });
  });

  full.post('/security/cancel-pending', async (c) => {
    await keystore.cancelPending();
    await audit(c, 'encryption.pending_cancelled');
    settings.invalidate();
    return c.json({ ok: true });
  });

  full.post('/security/hardened', async (c) => {
    const { enabled } = await body(c, z.object({ enabled: z.boolean() }));
    if (enabled) await keystore.enableEnvMode();
    else await keystore.disableEnvMode();
    await audit(c, enabled ? 'encryption.hardened_enabled' : 'encryption.hardened_disabled');
    settings.invalidate();
    return c.json<EncryptionStatusResponse>((await keystore.status()) as EncryptionStatusResponse);
  });

  app.route('/', full);
  return app;
}
