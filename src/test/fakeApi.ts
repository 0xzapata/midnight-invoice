/**
 * In-memory fake of the Midnight Invoice API (`/api/v1`) for jsdom tests:
 * `vi.stubGlobal('fetch', fake.fetch)`. Implements the parts of the contract
 * the browser uses (AGENT_API.md), including the sync feed (inclusive
 * `updated_since`, keyset paging, tombstones), revisions with If-Match /
 * If-None-Match, 410 for deleted invoices and settings. Clients
 * (`/clients`) follow the same contract, and an invoice write that sets a
 * `clientId` the fake does not have (live) is rejected with 400, like the
 * real server. Templates (`/templates`) follow the same contract (and the
 * same rule for their `clientId`). `GET /activity` and `GET /agents/:id/activity`
 * serve `state.activity` (seed it with `server.addActivity`) with the real filters.
 */
import { vi } from 'vitest';
import type { Actor } from '@/types/invoice';
import type { AgentSummary, ApiClientRecord, ApiInvoice, ApiTemplate, ClientInput, InvoiceEmail, InvoiceInput, Scope, SendInvoiceEmailRequest, TemplateInput } from '../../shared/api';
import type { ActivityEntry } from '../../shared/activity';
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
  const clients = new Map<string, ApiClientRecord>();
  const templates = new Map<string, ApiTemplate>();
  const state = {
    token: FAKE_TOKEN,
    tokenValid: true,
    offline: false,
    pageSize: 1000,
    settings: { settings: { ...DEFAULT_SETTINGS } as DefaultSettings, updatedAt: null as string | null },
    agents: [] as AgentSummary[],
    /** Activity log entries (any order; served newest first by id). */
    activity: [] as ActivityEntry[],
    workspace: { id: 'ws-1', createdAt: '2026-11-17T09:00:00.000Z' },
    /** POST /invoices/:id/send behaviour (email configured on the "server"). */
    email: { configured: true, fromAddress: 'invoices@mail.midnight.app', fromName: 'Midnight Invoice', pdfTheme: 'light' as 'light' | 'dark', cooldownMinutes: 10 },
  };
  const emails = new Map<string, InvoiceEmail[]>();
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
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.recurringId ? { recurringId: input.recurringId } : {}),
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

  function buildClient(id: string, input: ClientInput, actor: Actor, existing?: ApiClientRecord): ApiClientRecord {
    const at = tick();
    return {
      id,
      name: input.name,
      email: input.email ?? '',
      address: input.address ?? '',
      defaultCurrency: input.defaultCurrency ?? null,
      defaultTaxRate: input.defaultTaxRate ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      notes: input.notes ?? '',
      archivedAt: input.archivedAt ?? null,
      createdAt: existing?.createdAt ?? input.createdAt ?? at,
      updatedAt: at,
      deletedAt: null,
      revision: (existing?.revision ?? 0) + 1,
      createdBy: existing?.createdBy ?? actor,
      updatedBy: actor,
    };
  }

  function buildTemplate(id: string, input: TemplateInput, actor: Actor, existing?: ApiTemplate): ApiTemplate {
    const at = tick();
    return {
      id,
      name: input.name,
      description: input.description ?? '',
      clientId: input.clientId ?? null,
      lineItems: (input.lineItems ?? []).map((li, i) => ({ id: li.id ?? `${id}-tl-${i}`, description: li.description, quantity: li.quantity, price: li.price })),
      taxRate: input.taxRate ?? null,
      currency: input.currency ?? null,
      notes: input.notes ?? '',
      paymentDetails: input.paymentDetails ?? '',
      paymentTermsDays: input.paymentTermsDays ?? null,
      invoiceNamePattern: input.invoiceNamePattern ?? '',
      archivedAt: input.archivedAt ?? null,
      createdAt: existing?.createdAt ?? input.createdAt ?? at,
      updatedAt: at,
      deletedAt: null,
      revision: (existing?.revision ?? 0) + 1,
      createdBy: existing?.createdBy ?? actor,
      updatedBy: actor,
    };
  }

  /** The real server's rule: a newly set or changed clientId must name a live client. */
  function validateClientRef(input: { clientId?: string | null }, existing?: { clientId?: string | null }): Response | undefined {
    if (!input.clientId || input.clientId === existing?.clientId) return undefined;
    const client = clients.get(input.clientId);
    if (!client) return apiError(400, 'validation_failed', 'Unknown client', [{ path: 'clientId', message: 'No client with this id exists in this workspace' }]);
    if (client.deletedAt) return apiError(400, 'validation_failed', 'Client was deleted', [{ path: 'clientId', message: 'This client was deleted' }]);
    return undefined;
  }

  /** Delta feed shared by /invoices and /clients. */
  function feed<T extends { id: string; updatedAt: string; deletedAt: string | null }>(items: Iterable<T>, query: URLSearchParams) {
    const since = query.get('updated_since');
    const afterId = query.get('after_id');
    const includeDeleted = query.get('include_deleted') === 'true';
    const syncedAt = new Date(now).toISOString();
    const all = [...items]
      .filter((it) => includeDeleted || !it.deletedAt)
      .filter((it) => {
        if (!since) return true;
        if (afterId) return it.updatedAt > since || (it.updatedAt === since && it.id > afterId);
        return it.updatedAt >= since;
      })
      .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt.localeCompare(b.updatedAt)));
    const page = all.slice(0, state.pageSize);
    const hasMore = all.length > state.pageSize;
    const last = page[page.length - 1];
    return { page: structuredClone(page), syncedAt, hasMore, next: hasMore ? { updated_since: last.updatedAt, after_id: last.id } : null };
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
    const agentActivity = /^\/agents\/([^/]+)\/activity$/.exec(path);
    if ((path === '/activity' || agentActivity) && method === 'GET') {
      const actor = query.get('actor');
      const involving = agentActivity?.[1] ?? query.get('agent_id');
      const prefixes = query.get('action')?.split(',').filter(Boolean) ?? [];
      const limit = Number(query.get('limit') ?? 50);
      const before = query.get('before');
      const all = [...state.activity]
        .sort((a, b) => b.id.localeCompare(a.id))
        .filter((e) => !actor || (actor === 'user' ? e.actor.type === 'user' : actor === `agent:${e.actor.type === 'agent' ? e.actor.agentId : ''}`))
        .filter((e) => !involving || (e.actor.type === 'agent' && e.actor.agentId === involving) || (e.entity?.type === 'agent' && e.entity.id === involving))
        .filter((e) => prefixes.length === 0 || prefixes.some((p) => e.action.startsWith(p)))
        .filter((e) => !query.get('entity_type') || e.entity?.type === query.get('entity_type'))
        .filter((e) => !query.get('entity_id') || e.entity?.id === query.get('entity_id'))
        .filter((e) => !query.get('since') || e.time >= query.get('since')!)
        .filter((e) => !query.get('until') || e.time <= query.get('until')!)
        .filter((e) => !before || e.id < before);
      const page = all.slice(0, limit);
      const hasMore = all.length > limit;
      return json(200, { activity: structuredClone(page), hasMore, next: hasMore ? { before: page[page.length - 1].id } : null });
    }
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
        const invalid = validate(input) ?? validateClientRef(input, existing);
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
    const sendMatch = /^\/invoices\/([^/]+)\/(send|emails)$/.exec(path);
    if (sendMatch) {
      const [, id, action] = sendMatch;
      const existing = invoices.get(id);
      if (!existing) return apiError(404, 'not_found', 'Invoice not found');
      if (existing.deletedAt) return apiError(410, 'gone', 'Invoice was deleted', { id });
      if (action === 'emails' && method === 'GET') {
        return json(200, { emails: structuredClone(emails.get(id) ?? []), delivery: { ...state.email, fromAddress: state.email.configured ? state.email.fromAddress : null } });
      }
      if (action === 'send' && method === 'POST') {
        if (!state.email.configured) return apiError(503, 'email_not_configured', 'Email is not available: This server has no email provider API key yet.');
        if (existing.status === 'void') return apiError(409, 'invalid_status_transition', 'Void invoices cannot be sent');
        const req = (body ?? {}) as SendInvoiceEmailRequest;
        const to = req.to ?? existing.toEmail;
        const at = tick();
        const statusChanged = existing.status === 'draft';
        const invoice = statusChanged
          ? { ...existing, status: 'sent' as const, sentAt: at.slice(0, 10), revision: existing.revision + 1, updatedAt: at }
          : existing;
        invoices.set(id, invoice);
        const email: InvoiceEmail = {
          id: `email-${(emails.get(id)?.length ?? 0) + 1}`,
          invoiceId: id,
          to,
          cc: req.ccMe ? [state.settings.settings.fromEmail] : [],
          subject: req.subject ?? `Invoice ${existing.invoiceNumber}`,
          status: 'sent',
          error: null,
          sentBy: { type: 'user' },
          statusChanged,
          createdAt: at,
          sentAt: at,
        };
        emails.set(id, [email, ...(emails.get(id) ?? [])]);
        state.activity.push({
          id: `act_${String(state.activity.length + 1).padStart(19, '0')}`,
          time: at,
          actor: { type: 'user' },
          action: 'invoice.emailed',
          entity: { type: 'invoice', id, label: existing.invoiceNumber },
          changes: {
            email: { to: `${to[0]}•••${to.slice(to.lastIndexOf('@'))}`, cc: email.cc.length, resend: !statusChanged },
            ...(statusChanged ? { status: { from: 'draft' as const, to: 'sent' as const } } : {}),
          },
          source: 'rest',
          tool: null,
          requestId: null,
        });
        return json(200, { email, invoice: structuredClone(invoice), statusChanged, replayed: false });
      }
    }
    if (path === '/clients' && method === 'GET') {
      const { page, syncedAt, hasMore, next } = feed(clients.values(), query);
      return json(200, { clients: page, syncedAt, hasMore, next });
    }
    const clientMatch = /^\/clients\/([^/]+)$/.exec(path);
    if (clientMatch) {
      const id = clientMatch[1];
      const existing = clients.get(id);
      const ifMatch = ifMatchOf(headers);
      if (method === 'GET') {
        if (!existing) return apiError(404, 'not_found', 'Client not found');
        if (existing.deletedAt) return apiError(410, 'gone', 'Client was deleted', { id, deletedAt: existing.deletedAt });
        return json(200, { client: structuredClone(existing) }, { etag: `"${existing.revision}"` });
      }
      if (method === 'PUT') {
        const input = body as ClientInput;
        if (existing && headers['if-none-match'] === '*') return apiError(412, 'precondition_failed', 'Client already exists', { id, currentRevision: existing.revision });
        if (existing?.deletedAt) return apiError(410, 'gone', 'Client was deleted and cannot be recreated with the same id', { id });
        if (!existing && ifMatch !== undefined) return apiError(412, 'precondition_failed', 'Client does not exist', { id });
        if (existing && ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        if (!input.name?.trim()) return apiError(400, 'validation_failed', 'Request validation failed', [{ path: 'name', message: 'Client name is required' }]);
        const saved = buildClient(id, input, { type: 'user' }, existing);
        clients.set(id, saved);
        return json(existing ? 200 : 201, { client: structuredClone(saved) }, { etag: `"${saved.revision}"` });
      }
      if (method === 'DELETE') {
        if (!existing) return apiError(404, 'not_found', 'Client not found');
        if (existing.deletedAt) {
          return ifMatch !== undefined
            ? apiError(412, 'precondition_failed', 'Client was already deleted', { id, currentRevision: existing.revision })
            : new Response(null, { status: 204 });
        }
        if (ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        const at = tick();
        clients.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: { type: 'user' } });
        return new Response(null, { status: 204 });
      }
    }
    if (path === '/templates' && method === 'GET') {
      const { page, syncedAt, hasMore, next } = feed(templates.values(), query);
      return json(200, { templates: page, syncedAt, hasMore, next });
    }
    const templateMatch = /^\/templates\/([^/]+)$/.exec(path);
    if (templateMatch) {
      const id = templateMatch[1];
      const existing = templates.get(id);
      const ifMatch = ifMatchOf(headers);
      if (method === 'GET') {
        if (!existing) return apiError(404, 'not_found', 'Template not found');
        if (existing.deletedAt) return apiError(410, 'gone', 'Template was deleted', { id, deletedAt: existing.deletedAt });
        return json(200, { template: structuredClone(existing) }, { etag: `"${existing.revision}"` });
      }
      if (method === 'PUT') {
        const input = body as TemplateInput;
        if (existing && headers['if-none-match'] === '*') return apiError(412, 'precondition_failed', 'Template already exists', { id, currentRevision: existing.revision });
        if (existing?.deletedAt) return apiError(410, 'gone', 'Template was deleted and cannot be recreated with the same id', { id });
        if (!existing && ifMatch !== undefined) return apiError(412, 'precondition_failed', 'Template does not exist', { id });
        if (existing && ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        if (!input.name?.trim()) return apiError(400, 'validation_failed', 'Request validation failed', [{ path: 'name', message: 'Template name is required' }]);
        const invalid = validateClientRef(input, existing);
        if (invalid) return invalid;
        const saved = buildTemplate(id, input, { type: 'user' }, existing);
        templates.set(id, saved);
        return json(existing ? 200 : 201, { template: structuredClone(saved) }, { etag: `"${saved.revision}"` });
      }
      if (method === 'DELETE') {
        if (!existing) return apiError(404, 'not_found', 'Template not found');
        if (existing.deletedAt) {
          return ifMatch !== undefined
            ? apiError(412, 'precondition_failed', 'Template was already deleted', { id, currentRevision: existing.revision })
            : new Response(null, { status: 204 });
        }
        if (ifMatch !== undefined && ifMatch !== existing.revision) {
          return apiError(412, 'precondition_failed', 'Revision mismatch', { id, currentRevision: existing.revision });
        }
        const at = tick();
        templates.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: { type: 'user' } });
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
    createClient(id: string, input: ClientInput, actor: Actor = agentActor('Claude Desktop')): ApiClientRecord {
      const c = buildClient(id, input, actor);
      clients.set(id, c);
      return structuredClone(c);
    },
    updateClient(id: string, patch: Partial<ClientInput>, actor: Actor = agentActor('Claude Desktop')): ApiClientRecord {
      const existing = clients.get(id)!;
      const c = buildClient(id, { ...existing, ...patch } as ClientInput, actor, existing);
      clients.set(id, c);
      return structuredClone(c);
    },
    removeClient(id: string, actor: Actor = agentActor('Claude Desktop')): void {
      const existing = clients.get(id)!;
      const at = tick();
      clients.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: actor });
    },
    getClient: (id: string) => clients.get(id),
    allClients: () => [...clients.values()],
    createTemplate(id: string, input: TemplateInput, actor: Actor = agentActor('Claude Desktop')): ApiTemplate {
      const t = buildTemplate(id, input, actor);
      templates.set(id, t);
      return structuredClone(t);
    },
    updateTemplate(id: string, patch: Partial<TemplateInput>, actor: Actor = agentActor('Claude Desktop')): ApiTemplate {
      const existing = templates.get(id)!;
      const t = buildTemplate(id, { ...existing, ...patch } as TemplateInput, actor, existing);
      templates.set(id, t);
      return structuredClone(t);
    },
    removeTemplate(id: string, actor: Actor = agentActor('Claude Desktop')): void {
      const existing = templates.get(id)!;
      const at = tick();
      templates.set(id, { ...existing, deletedAt: at, updatedAt: at, revision: existing.revision + 1, updatedBy: actor });
    },
    getTemplate: (id: string) => templates.get(id),
    allTemplates: () => [...templates.values()],
    /** Email history per invoice (newest first), e.g. to seed a failed send. */
    emails,
    /** Appends an activity entry (ids increase with each call, so later = newer). */
    addActivity(entry: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry {
      const full: ActivityEntry = {
        id: `act_${String(state.activity.length + 1).padStart(19, '0')}`,
        time: tick(),
        actor: { type: 'user' },
        entity: null,
        changes: null,
        source: 'rest',
        tool: null,
        requestId: null,
        ...entry,
      };
      state.activity.push(full);
      return full;
    },
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

export const ALL_SCOPES: Scope[] = ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read', 'clients:read', 'clients:write', 'templates:read', 'templates:write', 'activity:read', 'invoices:send', 'recurring:read', 'recurring:write'];
