/**
 * In-memory fake of the Midnight Invoice API (`/api/v1`) for jsdom tests:
 * `vi.stubGlobal('fetch', fake.fetch)`. Implements the parts of the contract
 * the browser uses (AGENT_API.md), including the sync feed (inclusive
 * `updated_since`, keyset paging, tombstones), revisions with If-Match /
 * If-None-Match, 410 for deleted invoices and settings.
 */
import { vi } from 'vitest';
import type { Actor } from '@/types/invoice';
import type { AgentSummary, ApiInvoice, InvoiceInput, Scope } from '../../shared/api';
import { DEFAULT_SETTINGS, type DefaultSettings } from '../../shared/settings';
import { daysOverdue, isOverdue, normalizeStatusFields, utcToday } from '../../shared/invoice-status';

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (req: RecordedRequest) => Response | undefined;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const apiError = (status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) =>
  json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } }, headers);

export const FAKE_TOKEN = `mi_ws_${'A'.repeat(43)}`;

export function createFakeApi() {
  let now = Date.parse('2026-11-17T10:00:00.000Z');
  const tick = () => new Date((now += 1000)).toISOString();
  const invoices = new Map<string, ApiInvoice>();
  const state = {
    token: FAKE_TOKEN,
    tokenValid: true,
    offline: false,
    pageSize: 1000,
    settings: { settings: { ...DEFAULT_SETTINGS } as DefaultSettings, updatedAt: null as string | null },
    agents: [] as AgentSummary[],
    workspace: { id: 'ws-1', createdAt: '2026-11-17T09:00:00.000Z' },
  };
  const requests: RecordedRequest[] = [];
  const handlers: Handler[] = [];

  function build(id: string, input: InvoiceInput, actor: Actor, existing?: ApiInvoice): ApiInvoice {
    const lineItems = input.lineItems.map((li, i) => ({ id: li.id ?? `${id}-li-${i}`, description: li.description, quantity: li.quantity, price: li.price }));
    const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.price, 0);
    const taxRate = input.taxRate ?? state.settings.settings.taxRate;
    const at = tick();
    const status = normalizeStatusFields(input.status === undefined && existing ? existing : input, at.slice(0, 10));
    const dueDate = input.dueDate ?? '';
    const today = utcToday(new Date(at));
    return {
      ...status,
      isOverdue: isOverdue({ ...status, dueDate }, today),
      daysOverdue: daysOverdue({ ...status, dueDate }, today),
      version: 1,
      id,
      invoiceNumber: input.invoiceNumber ?? existing?.invoiceNumber ?? `INV-${String(invoices.size + 1).padStart(4, '0')}`,
      ...(input.invoiceName ? { invoiceName: input.invoiceName } : {}),
      issueDate: input.issueDate ?? at.slice(0, 10),
      dueDate: input.dueDate ?? '',
      fromName: input.fromName ?? state.settings.settings.fromName,
      fromAddress: input.fromAddress ?? state.settings.settings.fromAddress,
      fromEmail: input.fromEmail ?? state.settings.settings.fromEmail,
      toName: input.toName,
      toAddress: input.toAddress ?? '',
      toEmail: input.toEmail ?? '',
      lineItems,
      taxRate,
      notes: input.notes ?? '',
      paymentDetails: input.paymentDetails ?? state.settings.settings.paymentDetails,
      currency: input.currency ?? state.settings.settings.currency,
      createdAt: existing?.createdAt ?? input.createdAt ?? at,
      updatedAt: at,
      deletedAt: null,
      revision: (existing?.revision ?? 0) + 1,
      createdBy: existing?.createdBy ?? actor,
      updatedBy: actor,
      subtotal,
      taxAmount: (subtotal * taxRate) / 100,
      total: subtotal * (1 + taxRate / 100),
    };
  }

  function validate(input: InvoiceInput): Response | undefined {
    const details: { path: string; message: string }[] = [];
    const fromName = input.fromName ?? state.settings.settings.fromName;
    if (!fromName) details.push({ path: 'fromName', message: 'Your name/company is required' });
    if (!input.toName) details.push({ path: 'toName', message: 'Client name/company is required' });
    input.lineItems?.forEach((li, i) => {
      if (!li.description) details.push({ path: `lineItems.${i}.description`, message: 'Description is required' });
    });
    return details.length ? apiError(400, 'validation_failed', 'Request validation failed', details) : undefined;
  }

  const ifMatchOf = (h: Record<string, string>) => {
    const v = h['if-match'];
    return v === undefined ? undefined : Number(v.replace(/"/g, ''));
  };

  function route(req: RecordedRequest): Response {
    const { method, path, query, headers, body } = req;
    if (method === 'POST' && path === '/workspaces') return json(201, { workspace: state.workspace, token: state.token });

    const auth = headers.authorization;
    if (!auth || auth !== `Bearer ${state.token}` || !state.tokenValid) {
      return apiError(401, 'unauthorized', 'Missing or invalid bearer token');
    }

    if (path === '/workspace') {
      if (method === 'GET') return json(200, { workspace: state.workspace });
      if (method === 'DELETE') {
        state.tokenValid = false;
        return new Response(null, { status: 204 });
      }
    }
    if (path === '/settings') {
      if (method === 'GET') return json(200, state.settings);
      if (method === 'PUT') {
        state.settings = { settings: { ...(body as DefaultSettings) }, updatedAt: tick() };
        return json(200, state.settings);
      }
    }
    if (path === '/agents' && method === 'GET') return json(200, { agents: state.agents });
    const agentMatch = /^\/agents\/([^/]+)$/.exec(path);
    if (agentMatch && method === 'DELETE') {
      const agent = state.agents.find((a) => a.id === agentMatch[1]);
      if (!agent) return apiError(404, 'not_found', 'Agent not found');
      agent.revokedAt ??= tick();
      return new Response(null, { status: 204 });
    }

    if (path === '/invoices' && method === 'GET') {
      const since = query.get('updated_since');
      const afterId = query.get('after_id');
      const includeDeleted = query.get('include_deleted') === 'true';
      const syncedAt = new Date(now).toISOString();
      const all = [...invoices.values()]
        .filter((inv) => includeDeleted || !inv.deletedAt)
        .filter((inv) => {
          if (!since) return true;
          if (afterId) return inv.updatedAt > since || (inv.updatedAt === since && inv.id > afterId);
          return inv.updatedAt >= since;
        })
        .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt.localeCompare(b.updatedAt)));
      const page = all.slice(0, state.pageSize);
      const hasMore = all.length > state.pageSize;
      const last = page[page.length - 1];
      return json(200, {
        invoices: structuredClone(page),
        syncedAt,
        hasMore,
        next: hasMore ? { updated_since: last.updatedAt, after_id: last.id } : null,
      });
    }

    const invMatch = /^\/invoices\/([^/]+)$/.exec(path);
    if (invMatch) {
      const id = invMatch[1];
      const existing = invoices.get(id);
      const ifMatch = ifMatchOf(headers);
      if (method === 'GET') {
        if (!existing) return apiError(404, 'not_found', 'Invoice not found');
        if (existing.deletedAt) return apiError(410, 'gone', 'Invoice was deleted', { id, deletedAt: existing.deletedAt });
        return json(200, { invoice: structuredClone(existing) }, { etag: `"${existing.revision}"` });
      }
      if (method === 'PUT') {
        const input = body as InvoiceInput;
        if (existing && headers['if-none-match'] === '*') return apiError(412, 'precondition_failed', 'Invoice already exists', { id, currentRevision: existing.revision });
        if (existing?.deletedAt) return apiError(410, 'gone', 'Invoice was deleted and cannot be recreated with the same id', { id });
        if (!existing && ifMatch !== undefined) return apiError(412, 'precondition_failed', 'Invoice does not exist', { id });
        if (existing && ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        const invalid = validate(input);
        if (invalid) return invalid;
        const saved = build(id, input, { type: 'user' }, existing);
        invoices.set(id, saved);
        return json(existing ? 200 : 201, { invoice: structuredClone(saved) }, { etag: `"${saved.revision}"` });
      }
      if (method === 'DELETE') {
        if (!existing) return apiError(404, 'not_found', 'Invoice not found');
        if (existing.deletedAt) {
          return ifMatch !== undefined
            ? apiError(412, 'precondition_failed', 'Invoice was already deleted', { id, currentRevision: existing.revision })
            : new Response(null, { status: 204 });
        }
        if (ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        const at = tick();
        invoices.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: { type: 'user' } });
        return new Response(null, { status: 204 });
      }
    }
    return apiError(404, 'not_found', `No route for ${method} ${path}`);
  }

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (state.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input), 'http://localhost');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^\/api\/v1/, ''),
      query: url.searchParams,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    for (const handler of handlers) {
      const response = handler(req);
      if (response) return response;
    }
    return route(req);
  });

  /** Helpers that act like an agent (or another device) writing directly on the server. */
  const agentActor = (name: string): Actor => ({ type: 'agent', agentId: `agent-${name}`, agentName: name });
  const server = {
    create(id: string, input: InvoiceInput, actor: Actor = agentActor('Claude Desktop')): ApiInvoice {
      const inv = build(id, input, actor);
      invoices.set(id, inv);
      return structuredClone(inv);
    },
    update(id: string, patch: Partial<InvoiceInput>, actor: Actor = agentActor('Claude Desktop')): ApiInvoice {
      const existing = invoices.get(id)!;
      const inv = build(id, { ...existing, ...patch } as InvoiceInput, actor, existing);
      invoices.set(id, inv);
      return structuredClone(inv);
    },
    remove(id: string, actor: Actor = agentActor('Claude Desktop')): void {
      const existing = invoices.get(id)!;
      const at = tick();
      invoices.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: actor });
    },
    get: (id: string) => invoices.get(id),
    all: () => [...invoices.values()],
  };

  return {
    fetch: fetchImpl,
    state,
    requests,
    server,
    agentActor,
    /** Requests other than the read-only feed polling, as "METHOD /path". */
    writes: () => requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`),
    /** Intercepts requests; return undefined to fall through to the fake server. */
    use(handler: Handler) {
      handlers.push(handler);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
    json,
    apiError,
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export const ALL_SCOPES: Scope[] = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'];
