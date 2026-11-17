/**
 * Agent registration (device-authorization flow modelled on RFC 8628),
 * approval, token redemption, listing and revocation.
 */
import type {
  AgentRegistrationPreview,
  AgentSummary,
  AgentTokenResponse,
  RegisterAgentResponse,
  Scope,
} from '../../shared/api';
import { TOKEN_PREFIX } from '../../shared/api';
import { parseScopes, requireUser, type Principal } from '../auth';
import { formatUserCode, normalizeUserCode, sha256Hex } from '../crypto';
import type { AppDeps } from '../deps';
import type { RegistrationRow, Repository } from '../db/repository';
import { ApiError, errors } from '../errors';
import { approveAgentSchema, registerAgentSchema, tokenRequestSchema, zodDetails } from '../schemas';
import { createOAuthRepository } from '../oauth/repository';
import { activityWrite, labelOf, type ActivityRequest } from './activity';

interface Ctx {
  repo: Repository;
  deps: AppDeps;
  /** Request origin for the activity log. */
  activity?: ActivityRequest;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import('zod').ZodError } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw errors.validation(zodDetails(result.error));
  return result.data;
}

/** RFC 8628 §3.5 style token-endpoint error (HTTP 400). */
function deviceError(code: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'invalid_grant', message: string, details?: unknown) {
  return new ApiError(400, code, message, details);
}

export function verificationUrls(baseUrl: string, userCode: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    verification_url: `${base}/agents/approve`,
    verification_url_complete: `${base}/agents/approve?code=${encodeURIComponent(userCode)}`,
  };
}

// ---------------------------------------------------------------------------
// Agent side (unauthenticated)
// ---------------------------------------------------------------------------

export async function registerAgent(ctx: Ctx, body: unknown, baseUrl: string): Promise<RegisterAgentResponse> {
  const input = parse(registerAgentSchema, body);
  const now = ctx.deps.clock().getTime();
  const ttl = ctx.deps.config.registrationTtlSeconds;
  // Housekeeping: drop registrations that expired more than a day ago.
  await ctx.repo.purgeExpiredRegistrations(now - DAY_MS);

  const deviceCode = ctx.deps.secrets.generate(TOKEN_PREFIX.deviceCode);
  const deviceCodeHash = await sha256Hex(deviceCode);
  const id = ctx.deps.ids.uuid();
  for (let attempt = 0; attempt < 5; attempt++) {
    const display = ctx.deps.secrets.userCode();
    const userCode = normalizeUserCode(display);
    if (!userCode) throw new Error('user code generator produced an invalid code');
    try {
      await ctx.repo.createRegistration({
        id,
        deviceCodeHash,
        userCode,
        name: input.name,
        description: input.description || null,
        scopes: input.scopes,
        createdAt: now,
        expiresAt: now + ttl * 1000,
      });
      const formatted = formatUserCode(userCode);
      return {
        registration_id: id,
        device_code: deviceCode,
        user_code: formatted,
        ...verificationUrls(baseUrl, formatted),
        expires_in: ttl,
        interval: ctx.deps.config.pollIntervalSeconds,
      };
    } catch (error) {
      // UNIQUE(user_code) collision: draw another code.
      if (!String((error as Error)?.message).includes('UNIQUE')) throw error;
    }
  }
  throw errors.internal();
}

export async function redeemDeviceCode(ctx: Ctx, body: unknown): Promise<AgentTokenResponse> {
  const { device_code } = parse(tokenRequestSchema, body);
  const hash = await sha256Hex(device_code);
  const now = ctx.deps.clock().getTime();
  const reg = await ctx.repo.findRegistrationByDeviceCodeHash(hash);
  if (!reg) throw deviceError('invalid_grant', 'Unknown device_code');
  if (reg.status === 'redeemed') throw deviceError('invalid_grant', 'This device_code was already exchanged for an API key');
  if (reg.expires_at <= now) throw deviceError('expired_token', 'The registration expired; register again');
  if (reg.status === 'denied') throw deviceError('access_denied', 'The user denied this agent');
  const interval = ctx.deps.config.pollIntervalSeconds;
  if (reg.status === 'pending') {
    const tooFast = reg.last_polled_at !== null && now - reg.last_polled_at < interval * 1000;
    await ctx.repo.touchRegistrationPoll(reg.id, now);
    if (tooFast) {
      throw deviceError('slow_down', `Polling too fast; wait at least ${interval} seconds between requests`, { interval: interval + 5 });
    }
    throw deviceError('authorization_pending', 'The user has not approved this agent yet', { interval });
  }

  // Approved: exchange exactly once.
  const apiKey = ctx.deps.secrets.generate(TOKEN_PREFIX.agentKey);
  const agentId = ctx.deps.ids.uuid();
  const agent = await ctx.repo.redeemRegistration(
    {
      deviceCodeHash: hash,
      agentId,
      keyHash: await sha256Hex(apiKey),
      nowMs: now,
      createdAt: new Date(now).toISOString(),
    },
    activityWrite(ctx, {
      workspaceId: reg.workspace_id!,
      actor: { type: 'agent', agentId, agentName: reg.name },
      action: 'agent.registered',
      entity: { type: 'agent', id: agentId, label: reg.name },
      // registrationId links the user's agent.approved entry (made before the agent id existed) to this agent.
      changes: { scopes: parseScopes(reg.approved_scopes), registrationId: reg.id },
    }),
  );
  if (!agent) {
    // Lost a race with a concurrent redemption (or it expired in between).
    const latest = await ctx.repo.findRegistrationByDeviceCodeHash(hash);
    if (latest && latest.status !== 'redeemed' && latest.expires_at <= now) {
      throw deviceError('expired_token', 'The registration expired; register again');
    }
    throw deviceError('invalid_grant', 'This device_code was already exchanged for an API key');
  }
  return {
    api_key: apiKey,
    token_type: 'Bearer',
    agent: { id: agent.id, name: agent.name, scopes: parseScopes(agent.scopes), workspace_id: agent.workspace_id },
  };
}

// ---------------------------------------------------------------------------
// User side (workspace token)
// ---------------------------------------------------------------------------

/**
 * Brute-force guard for user-code lookups: a consistent D1 fixed-window
 * counter of *failed* lookups per workspace and per client IP. Once either
 * reaches the limit, further lookups get 429 until the window ends.
 */
async function withUserCodeGuard(
  ctx: Ctx,
  principal: Principal,
  clientIp: string,
  rawCode: string,
): Promise<RegistrationRow> {
  const { userCodeFailureLimit: limit, userCodeFailureWindowSeconds: windowSec } = ctx.deps.config;
  const now = ctx.deps.clock().getTime();
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const keys = [`usercode-fail:ws:${principal.workspaceId}`, `usercode-fail:ip:${clientIp}`];
  for (const key of keys) {
    if ((await ctx.repo.getCounter(key, windowStart)) >= limit) {
      throw errors.rateLimited(Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)));
    }
  }
  const code = normalizeUserCode(rawCode);
  const reg = code ? await ctx.repo.findRegistrationByUserCode(code) : null;
  if (!reg) {
    for (const key of keys) await ctx.repo.incrementCounter(key, windowStart);
    await ctx.repo.purgeCounters(windowStart - DAY_MS);
    throw errors.notFound('No agent registration with this code');
  }
  if (reg.expires_at <= now && reg.status === 'pending') {
    throw errors.gone('This registration expired; ask the agent to register again');
  }
  if (reg.status !== 'pending') {
    throw errors.conflict(`This registration was already ${reg.status === 'redeemed' ? 'approved' : reg.status}`, { status: reg.status === 'redeemed' ? 'approved' : reg.status });
  }
  return reg;
}

function previewOf(reg: RegistrationRow): AgentRegistrationPreview {
  return {
    registration: {
      id: reg.id,
      userCode: formatUserCode(reg.user_code),
      name: reg.name,
      description: reg.description,
      requestedScopes: parseScopes(reg.requested_scopes),
      createdAt: new Date(reg.created_at).toISOString(),
      expiresAt: new Date(reg.expires_at).toISOString(),
    },
  };
}

export async function previewRegistration(ctx: Ctx, principal: Principal, clientIp: string, rawCode: string) {
  requireUser(principal);
  return previewOf(await withUserCodeGuard(ctx, principal, clientIp, rawCode));
}

export async function decideRegistration(
  ctx: Ctx,
  principal: Principal,
  clientIp: string,
  rawCode: string,
  decision: 'approved' | 'denied',
  body: unknown,
) {
  requireUser(principal);
  const reg = await withUserCodeGuard(ctx, principal, clientIp, rawCode);
  const requested = parseScopes(reg.requested_scopes);
  let scopes: Scope[] | null = null;
  if (decision === 'approved') {
    const input = parse(approveAgentSchema, body ?? {});
    scopes = input.scopes ?? requested;
    const extra = scopes.filter((s) => !requested.includes(s));
    if (extra.length > 0) {
      throw errors.invalidScope('Approved scopes must be a subset of the requested scopes', { requested, notRequested: extra });
    }
  }
  const updated = await ctx.repo.decideRegistration(
    {
      userCode: reg.user_code,
      workspaceId: principal.workspaceId,
      decision,
      scopes,
      nowMs: ctx.deps.clock().getTime(),
    },
    activityWrite(
      { ...ctx, principal },
      {
        action: decision === 'approved' ? 'agent.approved' : 'agent.denied',
        entity: { type: 'agent_registration', id: reg.id, label: reg.name },
        changes: scopes ? { scopes } : null,
      },
    ),
  );
  if (!updated) {
    // Decided concurrently or expired between the read and the update.
    const latest = await ctx.repo.findRegistrationByUserCode(reg.user_code);
    if (latest && latest.status === 'pending') throw errors.gone('This registration expired; ask the agent to register again');
    throw errors.conflict('This registration was already decided');
  }
  return decision === 'approved'
    ? { registration: { id: updated.id, status: 'approved' as const, scopes: scopes! } }
    : { registration: { id: updated.id, status: 'denied' as const } };
}

export async function listAgents(ctx: Ctx, principal: Principal): Promise<{ agents: AgentSummary[] }> {
  requireUser(principal);
  const rows = await ctx.repo.listAgents(principal.workspaceId);
  const viaOAuth = await createOAuthRepository(ctx.deps.db).listOAuthAgentIds(principal.workspaceId);
  return {
    agents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      scopes: parseScopes(r.scopes),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
      connection: viaOAuth.has(r.id) ? 'oauth' : 'api_key',
    })),
  };
}

export async function revokeAgent(ctx: Ctx, principal: Principal, agentId: string): Promise<void> {
  requireUser(principal);
  if (agentId.length > 64) throw errors.notFound('Agent not found');
  const revokedAt = ctx.deps.clock().toISOString();
  const result = await ctx.repo.revokeAgent(
    principal.workspaceId,
    agentId,
    revokedAt,
    // Only when this call set revoked_at (repeating a revoke is a no-op and is not logged).
    activityWrite(
      { ...ctx, principal },
      { action: 'agent.revoked', entity: { type: 'agent', id: agentId }, dedupe: { key: `revoked:${agentId}`, mode: 'ignore' } },
      {
        labelSql: labelOf.agent(principal.workspaceId, agentId),
        when: { sql: 'changes() > 0 AND EXISTS (SELECT 1 FROM agents WHERE workspace_id = ? AND id = ? AND revoked_at = ?)', params: [principal.workspaceId, agentId, revokedAt] },
      },
    ),
  );
  if (result === 'not_found') throw errors.notFound('Agent not found');
}
