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
import { isOAuthProtocolPath, oauthPolicyResponse } from '../oauth/policy';

type HookEnv = { Variables: { principal?: { workspaceId: string } } };

function policyError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return new ApiError(status, code as ApiError['code'], message, undefined, headers);
}

const MCP_PEEK_LIMIT = 64 * 1024;

const DETAIL = /^[a-z][a-z0-9_]{0,39}$/;
const details = new WeakMap<Request, { label?: string; errorCode?: string; status?: number }>();

/**
 * Lets a route refine its telemetry sample: a fixed `label` appended to the
 * metric name (e.g. an OAuth grant type) and a fixed `errorCode` for errors it
 * answers itself instead of throwing. Only short lowercase identifiers are
 * kept, so ids, names and other request data can never end up in telemetry.
 * `status` (4xx/5xx) counts a failure the transport answers with 2xx — an MCP
 * tool error — with the status class it has over REST.
 */
export function setTelemetryDetail(c: Context, detail: { label?: string; errorCode?: string; status?: number }): void {
  const prev = details.get(c.req.raw) ?? {};
  details.set(c.req.raw, {
    label: detail.label && DETAIL.test(detail.label) ? detail.label : prev.label,
    errorCode: detail.errorCode && DETAIL.test(detail.errorCode) ? detail.errorCode : prev.errorCode,
    status: detail.status && Number.isInteger(detail.status) && detail.status >= 400 && detail.status <= 599 ? detail.status : prev.status,
  });
}

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
  const short = template.replace(/^\/api\/v1/, '').replace(/^\/api\/operator/, '').replace(/^\/api\/account/, '') || '/';
  const sync = c.req.method === 'GET' && (template === '/api/v1/invoices' || template === '/api/v1/clients' || template === '/api/v1/templates') && c.req.query('include_deleted') === 'true';
  return `${c.req.method} ${short}${sync ? ' (sync)' : ''}`;
}

export function createOperatorHook(deps: AppDeps, telemetry: TelemetryCollector) {
  return createMiddleware<HookEnv>(async (c, next) => {
    const started = Date.now();
    const path = c.req.path;
    const service = path.startsWith('/api/operator') ? 'operator' : path === '/api/mcp' ? 'mcp' : path.startsWith('/api/account') ? 'accounts' : 'rest';
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
      // OAuth protocol endpoints answer in OAuth's error shape (and /authorize with the app's error page).
      c.res = isOAuthProtocolPath(path) ? oauthPolicyResponse(c, blocked, deps) : blocked.toResponse();
    } else {
      await next();
    }

    // Console responses (errors included) are never indexed.
    if (service === 'operator') c.res.headers.set('x-robots-tag', 'noindex, nofollow');
    try {
      if (!deps.settings.get('telemetry.enabled')) return;
      const detail = details.get(c.req.raw);
      // A failure the route answers with 2xx (an MCP tool error) is recorded with the status it has over REST.
      const status = detail?.status && c.res.status < 400 ? detail.status : c.res.status;
      const err = blocked ?? (c.error instanceof ApiError ? c.error : null);
      const base = service === 'mcp' ? (mcpName ? await mcpName : c.req.method) : restMetricName(c);
      const name = detail?.label ? `${base} (${detail.label})` : base;
      telemetry.record({
        metric: `${service}|${name}`,
        status,
        durationMs: Date.now() - started,
        at: deps.clock().getTime(),
        errorCode: err ? err.code : detail?.errorCode ?? (status >= 500 ? 'internal_error' : status >= 400 ? `http_${status}` : null),
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
