/**
 * Midnight Invoice API (Hono). `createApp(deps)` is pure wiring: tests call
 * `app.request(...)` with test deps; worker/index.ts builds deps from the
 * Worker env. Contract: shared/api.ts, server/openapi.ts, AGENT_API.md.
 */
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { CreateWorkspaceResponse, HealthResponse } from '../shared/api';
import { TOKEN_PREFIX } from '../shared/api';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { authenticate, requireUser, type Principal } from './auth';
import { sha256Hex } from './crypto';
import { createRepository, type Repository } from './db/repository';
import type { AppDeps } from './deps';
import { ApiError, errors } from './errors';
import { clientIp, enforceRateLimit, publicBaseUrl, readJson, readJsonRequired, runInBackground } from './http';
import { createMcpEndpoint } from './mcp';
import { installOperator } from './operator';
import { buildOpenApiDocument } from './openapi';
import { parsePdfTheme, pdfFilename, renderInvoicePdf } from './pdf/render';
import { LIMITS, listInvoicesQuerySchema, settingsSchema, zodDetails } from './schemas';
import * as agents from './services/agents';
import * as invoices from './services/invoices';

export type AppEnv = { Variables: { principal: Principal } };

export function createApp(deps: AppDeps) {
  const repo: Repository = createRepository(deps.db);
  const mcp = createMcpEndpoint(deps, repo);
  const app = new Hono<AppEnv>();

  app.onError((error, c) => {
    if (error instanceof ApiError) return error.toResponse();
    deps.logError?.(`Unhandled error on ${c.req.method} ${c.req.path}`, error);
    return errors.internal().toResponse();
  });
  app.notFound((c) => errors.notFound(`No route for ${c.req.method} ${c.req.path}`).toResponse());

  // API responses are never cacheable by shared caches and never sniffed.
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
    c.res.headers.set('x-content-type-options', 'nosniff');
  });

  // Operator console: runtime settings + policy + telemetry hook for /api/*, and /api/operator routes.
  installOperator(app, deps, repo);

  /** Bearer auth for workspace tokens and agent keys. */
  const auth = createMiddleware<AppEnv>(async (c, next) => {
    const principal = await authenticate(repo, c.req.header('authorization'));
    c.set('principal', principal);
    if (principal.type === 'agent') {
      const now = deps.clock();
      const throttleMs = deps.config.lastUsedThrottleSeconds * 1000;
      const last = principal.lastUsedAt ? Date.parse(principal.lastUsedAt) : 0;
      if (now.getTime() - last >= throttleMs) {
        runInBackground(
          c,
          repo
            .touchAgentLastUsed(principal.workspaceId, principal.agentId, now.toISOString(), new Date(now.getTime() - throttleMs).toISOString())
            .catch((error) => deps.logError?.('Failed to update agent lastUsedAt', error)),
        );
      }
    }
    await next();
  });

  const svc = (c: Context<AppEnv>): invoices.ServiceContext => ({ repo, deps, principal: c.get('principal') });
  const withEtag = (c: Context<AppEnv>, invoice: { revision: number }) => c.header('etag', invoices.etagOf(invoice));

  const v1 = new Hono<AppEnv>();

  // --- Meta -----------------------------------------------------------------
  v1.get('/health', (c) => c.json<HealthResponse>({ status: 'ok', time: deps.clock().toISOString() }));
  v1.get('/openapi.json', (c) => {
    c.header('cache-control', 'public, max-age=300');
    return c.json(buildOpenApiDocument(publicBaseUrl(c, deps.config.appUrl)));
  });

  // --- Workspaces -----------------------------------------------------------
  v1.post('/workspaces', async (c) => {
    await enforceRateLimit(deps.rateLimiters.create, `workspace:${clientIp(c)}`);
    const token = deps.secrets.generate(TOKEN_PREFIX.workspace);
    const ws = await repo.createWorkspace(deps.ids.uuid(), await sha256Hex(token), deps.clock().toISOString());
    return c.json<CreateWorkspaceResponse>({ workspace: { id: ws.id, createdAt: ws.created_at }, token }, 201);
  });
  v1.get('/workspace', auth, async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    const ws = await repo.findWorkspace(principal.workspaceId);
    if (!ws) throw errors.unauthorized();
    return c.json({ workspace: { id: ws.id, createdAt: ws.created_at } });
  });
  v1.delete('/workspace', auth, async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    await repo.deleteWorkspace(principal.workspaceId);
    return c.body(null, 204);
  });

  // --- Agents: device flow ----------------------------------------------------
  v1.post('/agents/register', async (c) => {
    await enforceRateLimit(deps.rateLimiters.create, `register:${clientIp(c)}`);
    const body = await readJsonRequired(c, LIMITS.smallBodyBytes);
    return c.json(await agents.registerAgent({ repo, deps }, body, publicBaseUrl(c, deps.config.appUrl)), 201);
  });
  v1.post('/agents/token', async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `token:${clientIp(c)}`);
    const body = await readJsonRequired(c, LIMITS.smallBodyBytes);
    return c.json(await agents.redeemDeviceCode({ repo, deps }, body));
  });
  v1.get('/agents/registrations/:user_code', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `usercode:${clientIp(c)}`);
    return c.json(await agents.previewRegistration({ repo, deps }, c.get('principal'), clientIp(c), c.req.param('user_code')));
  });
  v1.post('/agents/registrations/:user_code/approve', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `usercode:${clientIp(c)}`);
    const body = await readJson(c, LIMITS.smallBodyBytes);
    return c.json(
      await agents.decideRegistration({ repo, deps }, c.get('principal'), clientIp(c), c.req.param('user_code'), 'approved', body),
    );
  });
  v1.post('/agents/registrations/:user_code/deny', auth, async (c) => {
    await enforceRateLimit(deps.rateLimiters.poll, `usercode:${clientIp(c)}`);
    return c.json(
      await agents.decideRegistration({ repo, deps }, c.get('principal'), clientIp(c), c.req.param('user_code'), 'denied', undefined),
    );
  });

  // --- Agents: management -----------------------------------------------------
  v1.get('/agents', auth, async (c) => c.json(await agents.listAgents({ repo, deps }, c.get('principal'))));
  v1.get('/agents/me', auth, (c) => {
    const p = c.get('principal');
    if (p.type !== 'agent') throw errors.forbidden('This endpoint requires an agent API key');
    return c.json({
      agent: {
        id: p.agentId,
        name: p.agentName,
        description: p.agentDescription,
        scopes: [...p.scopes],
        workspace_id: p.workspaceId,
        createdAt: p.agentCreatedAt,
      },
    });
  });
  v1.delete('/agents/:id', auth, async (c) => {
    await agents.revokeAgent({ repo, deps }, c.get('principal'), c.req.param('id'));
    return c.body(null, 204);
  });

  // --- Invoices ---------------------------------------------------------------
  v1.get('/invoices', auth, async (c) => {
    const parsed = listInvoicesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error), 'Invalid query parameters');
    const q = parsed.data;
    return c.json(
      await invoices.listInvoices(svc(c), {
        updatedSince: q.updated_since,
        afterId: q.after_id,
        includeDeleted: q.include_deleted === 'true',
        limit: q.limit,
      }),
    );
  });
  v1.post('/invoices', auth, async (c) => {
    const invoice = await invoices.createInvoice(svc(c), await readJsonRequired(c, LIMITS.invoiceBodyBytes));
    withEtag(c, invoice);
    c.header('location', `/api/v1/invoices/${invoice.id}`);
    return c.json({ invoice }, 201);
  });
  v1.get('/invoices/next-number', auth, async (c) => c.json({ invoiceNumber: await invoices.nextInvoiceNumber(svc(c)) }));
  v1.get('/invoices/:id', auth, async (c) => {
    const invoice = await invoices.getInvoice(svc(c), c.req.param('id'));
    withEtag(c, invoice);
    return c.json({ invoice });
  });
  v1.put('/invoices/:id', auth, async (c) => {
    const body = await readJsonRequired(c, LIMITS.invoiceBodyBytes);
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch !== undefined && ifNoneMatch.trim() !== '*') throw errors.badRequest('Only If-None-Match: * is supported');
    const { invoice, created } = await invoices.putInvoice(svc(c), c.req.param('id'), body, {
      ifMatch: invoices.parseIfMatch(c.req.header('if-match')),
      ifNoneMatchAny: ifNoneMatch !== undefined,
    });
    withEtag(c, invoice);
    return c.json({ invoice }, created ? 201 : 200);
  });
  v1.patch('/invoices/:id', auth, async (c) => {
    const body = await readJsonRequired(c, LIMITS.invoiceBodyBytes);
    const invoice = await invoices.patchInvoice(svc(c), c.req.param('id'), body, {
      ifMatch: invoices.parseIfMatch(c.req.header('if-match')),
    });
    withEtag(c, invoice);
    return c.json({ invoice });
  });
  v1.delete('/invoices/:id', auth, async (c) => {
    await invoices.deleteInvoice(svc(c), c.req.param('id'), { ifMatch: invoices.parseIfMatch(c.req.header('if-match')) });
    return c.body(null, 204);
  });
  v1.get('/invoices/:id/pdf', auth, async (c) => {
    const theme = parsePdfTheme(c.req.query('theme'));
    const invoice = await invoices.getInvoice(svc(c), c.req.param('id'));
    const bytes = await renderInvoicePdf(invoice, deps.readAsset, theme);
    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${pdfFilename(invoice.invoiceNumber)}"`,
        'cache-control': 'private, no-store',
        etag: invoices.etagOf(invoice),
      },
    });
  });

  // --- Settings ---------------------------------------------------------------
  v1.get('/settings', auth, async (c) => c.json(await invoices.getSettings(svc(c))));
  v1.put('/settings', auth, async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...((await readJsonRequired(c, LIMITS.invoiceBodyBytes)) as object) });
    if (!parsed.success) throw errors.validation(zodDetails(parsed.error));
    const { updatedAt } = await repo.putSettings(principal.workspaceId, parsed.data);
    return c.json({ settings: parsed.data, updatedAt });
  });

  app.route('/api/v1', v1);

  // --- MCP (Streamable HTTP, stateless, JSON responses) -------------------------
  app.post('/api/mcp', auth, async (c) => {
    const response = await mcp(c.req.raw, c.get('principal'), publicBaseUrl(c, deps.config.appUrl));
    return response;
  });
  app.on(['GET', 'DELETE', 'PUT', 'PATCH'], '/api/mcp', () => errors.methodNotAllowed('POST').toResponse());

  return app;
}

export type App = ReturnType<typeof createApp>;
