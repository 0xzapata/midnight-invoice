/**
 * The one request hook the operator feature adds in front of every /api route:
 * refreshes the runtime-settings snapshot, applies operator policy
 * (maintenance mode, closed registration, suspended workspaces) to the public
 * API and MCP, and records telemetry. Policy checks use the in-memory snapshot
 * only (no extra D1 query per request); telemetry is flushed in the background.
 */
import { createMiddleware } from 'hono/factory';
import { matchedRoutes, routePath } from 'hono/route';
import type { Context } from 'hono';
import { bearerToken } from '../auth';
import { sha256Hex } from '../crypto';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { runInBackground } from '../http';
import type { TelemetryCollector } from './telemetry';

type HookEnv = { Variables: { principal?: { workspaceId: string } } };

function policyError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return new ApiError(status, code as ApiError['code'], message, undefined, headers);
}

const MCP_PEEK_LIMIT = 64 * 1024;

async function mcpMetricName(c: Context): Promise<string> {
  try {
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > MCP_PEEK_LIMIT || !c.req.raw.body) return 'request';
    const reader = c.req.raw.clone().body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MCP_PEEK_LIMIT) {
        await reader.cancel();
        return 'request';
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const ch of chunks) {
      bytes.set(ch, offset);
      offset += ch.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const msg = (Array.isArray(body) ? body[0] : body) as { method?: unknown; params?: { name?: unknown } } | undefined;
    const method = typeof msg?.method === 'string' ? msg.method : 'request';
    const name = method === 'tools/call' && typeof msg?.params?.name === 'string' ? `tool ${msg.params.name}` : method;
    return /^[\w/.: -]{1,64}$/.test(name) ? name : 'other';
  } catch {
    return 'invalid';
  }
}

function restMetricName(c: Context): string {
  let template = '(unmatched)';
  try {
    // The responding route, or (when a guard answered first) the endpoint the request matched.
    const p = routePath(c);
    if (p && !p.endsWith('*')) template = p;
    else {
      const endpoint = matchedRoutes(c).filter((r) => r.method !== 'ALL' && !r.path.endsWith('*')).pop();
      if (endpoint) template = endpoint.path;
    }
  } catch {
    // keep "(unmatched)"
  }
  const short = template.replace(/^\/api\/v1/, '').replace(/^\/api\/operator/, '') || '/';
  const sync = c.req.method === 'GET' && (template === '/api/v1/invoices' || template === '/api/v1/clients') && c.req.query('include_deleted') === 'true';
  return `${c.req.method} ${short}${sync ? ' (sync)' : ''}`;
}

export function createOperatorHook(deps: AppDeps, telemetry: TelemetryCollector) {
  return createMiddleware<HookEnv>(async (c, next) => {
    const started = Date.now();
    const path = c.req.path;
    const service = path.startsWith('/api/operator') ? 'operator' : path === '/api/mcp' ? 'mcp' : 'rest';
    await deps.settings.refresh();

    let blocked: ApiError | null = null;
    if (service !== 'operator') {
      const s = deps.settings;
      if (s.get('maintenance.enabled') && path !== '/api/v1/health') {
        blocked = policyError(503, 'maintenance', s.get('maintenance.message'), { 'retry-after': '300' });
      } else if (c.req.method === 'POST' && path === '/api/v1/workspaces' && !s.get('registration.workspacesOpen')) {
        blocked = policyError(403, 'registration_closed', 'New cloud-sync workspaces are not being accepted right now.');
      } else if (c.req.method === 'POST' && path === '/api/v1/agents/register' && !s.get('registration.agentsOpen')) {
        blocked = policyError(403, 'registration_closed', 'New agent registrations are not being accepted right now.');
      } else {
        const token = bearerToken(c.req.header('authorization'));
        if (token && s.isSuspendedCredentialHash(await sha256Hex(token))) {
          blocked = policyError(403, 'workspace_suspended', 'This workspace has been suspended by the site operator.');
        }
      }
    }

    const mcpName = service === 'mcp' && c.req.method === 'POST' ? mcpMetricName(c) : null;
    if (blocked) {
      c.res = blocked.toResponse();
    } else {
      await next();
    }

    // Console responses (errors included) are never indexed.
    if (service === 'operator') c.res.headers.set('x-robots-tag', 'noindex, nofollow');
    try {
      if (!deps.settings.get('telemetry.enabled')) return;
      const status = c.res.status;
      const err = blocked ?? (c.error instanceof ApiError ? c.error : null);
      const name = service === 'mcp' ? (mcpName ? await mcpName : c.req.method) : restMetricName(c);
      telemetry.record({
        metric: `${service}|${name}`,
        status,
        durationMs: Date.now() - started,
        at: deps.clock().getTime(),
        errorCode: err ? err.code : status >= 500 ? 'internal_error' : status >= 400 ? `http_${status}` : null,
        ray: c.req.header('cf-ray')?.slice(0, 40) ?? null,
        workspaceId: c.get('principal')?.workspaceId ?? null,
      });
      const flush = telemetry.scheduleFlush();
      if (flush) runInBackground(c, flush);
    } catch (error) {
      deps.logError?.('Telemetry record failed', error);
    }
  });
}
