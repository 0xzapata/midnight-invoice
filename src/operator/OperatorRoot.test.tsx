import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import OperatorRoot from './OperatorRoot';
import { browserNav, setCsrfToken } from './api';

type Handler = (body: unknown, url: URL) => { status?: number; json?: unknown } | undefined;

/** Minimal in-memory operator API: route "METHOD /path" → handler. Records calls. */
function fakeOperatorApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace('/api/operator', '');
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = routes[`${method} ${path}`];
    const result = handler?.(body, url) ?? { status: 404, json: { error: { code: 'not_found', message: 'Not found' } } };
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.json ?? {}), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetchMock };
}

const unauth = () => ({ status: 401, json: { error: { code: 'operator_unauthenticated', message: 'Sign in' } } });

function renderConsole(path = '/operator') {
  window.history.pushState(null, '', path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<OperatorRoot client={client} />);
}

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setCsrfToken(null);
  assign = vi.spyOn(browserNav, 'assign').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('operator console: entry states', () => {
  it('explains how to enable the console when INITIAL_PASSWORD is unset', async () => {
    const api = fakeOperatorApi({
      'GET /status': () => ({ status: 503, json: { error: { code: 'operator_not_configured', message: 'Operator console not configured' } } }),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    renderConsole();
    expect(await screen.findByRole('heading', { name: 'Operator console not configured' })).toBeInTheDocument();
    expect(screen.getByText(/wrangler secret put INITIAL_PASSWORD/)).toBeInTheDocument();
  });

  it('offers AuthKit sign-in once set up, and recovery when the encryption is locked', async () => {
    let locked = true;
    const api = fakeOperatorApi({
      'GET /status': () => ({ json: { phase: 'ready', encryptionLocked: locked } }),
      'GET /session': unauth,
      'POST /recover': (body) => {
        if ((body as { recoveryKey: string }).recoveryKey !== 'mi_mk_good') return { status: 401, json: { error: { code: 'invalid_credentials', message: 'That recovery key does not match.' } } };
        locked = false;
        return { json: { recovered: true } };
      },
      'POST /auth/login': () => ({ json: { authorizationUrl: 'https://api.workos.com/user_management/authorize?x=1' } }),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const user = userEvent.setup();
    renderConsole();
    expect(await screen.findByRole('heading', { name: 'Encrypted settings are locked' })).toBeInTheDocument();
    const input = screen.getByLabelText(/Recovery key/);
    await user.type(input, 'mi_mk_bad');
    await user.click(screen.getByRole('button', { name: 'Restore access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match');
    await user.clear(input);
    await user.type(input, 'mi_mk_good');
    await user.click(screen.getByRole('button', { name: 'Restore access' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with WorkOS' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://api.workos.com/user_management/authorize?x=1'));
  });
});

describe('operator console: first-run wizard', () => {
  it('bootstrap login → encryption key (shown once, must be confirmed) → WorkOS → AuthKit redirect', async () => {
    let session: unknown = null;
    let step = 'encryption';
    const api = fakeOperatorApi({
      'GET /status': () => ({ json: { phase: 'bootstrap', encryptionLocked: false } }),
      'GET /session': () => (session ? { json: session } : unauth()),
      'POST /bootstrap/login': (body) => {
        if ((body as { password: string }).password !== 'the-initial-password') return { status: 401, json: { error: { code: 'invalid_credentials', message: 'Invalid credentials.' } } };
        session = { kind: 'setup', csrfToken: 'csrf-1', expiresAt: Date.now() + 1e6, operator: null };
        return { json: session };
      },
      'GET /setup': () => ({
        json: {
          step,
          encryption: { initialized: step !== 'encryption', confirmed: step === 'workos' || step === 'identity', source: 'generated' },
          workos: { configured: step === 'identity', clientId: step === 'identity' ? 'client_abc' : null, apiKeyLast4: step === 'identity' ? '7890' : null, redirectUri: 'http://localhost/api/operator/auth/callback' },
          workosEmulator: 'http://localhost:4100',
        },
      }),
      'POST /setup/encryption': () => {
        step = 'encryption_confirm';
        return { json: { recoveryKey: 'mi_mk_ONLY_SHOWN_ONCE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } };
      },
      'POST /setup/encryption/confirm': () => {
        step = 'workos';
        return { json: { step } };
      },
      'POST /setup/workos': (body) => {
        if ((body as { apiKey: string }).apiKey !== 'sk_test_default') return { status: 400, json: { error: { code: 'validation_failed', message: 'WorkOS rejected the API key.' } } };
        step = 'identity';
        return { json: { step } };
      },
      'POST /setup/identity': () => ({ json: { authorizationUrl: 'http://localhost:4100/user_management/authorize?screen_hint=sign-up' } }),
    });
    vi.stubGlobal('fetch', api.fetchMock);
    const user = userEvent.setup();
    renderConsole();

    await user.type(await screen.findByLabelText('Initial password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Start setup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials.');
    await user.clear(screen.getByLabelText('Initial password'));
    await user.type(screen.getByLabelText('Initial password'), 'the-initial-password');
    await user.click(screen.getByRole('button', { name: 'Start setup' }));

    expect(await screen.findByRole('heading', { name: 'Set up the operator console' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Generate a random 256-bit key/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Create master key' }));
    expect(await screen.findByTestId('recovery-key')).toHaveTextContent('mi_mk_ONLY_SHOWN_ONCE');
    const cont = screen.getByRole('button', { name: 'I saved it, continue' });
    expect(cont).toBeDisabled();
    await user.click(screen.getByLabelText(/I have saved the recovery key/));
    await user.click(cont);

    expect(await screen.findByRole('form', { name: 'WorkOS credentials' })).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-key')).not.toBeInTheDocument();
    expect(screen.getByTestId('redirect-uri')).toHaveTextContent('http://localhost/api/operator/auth/callback');
    expect(screen.getByText(/local WorkOS emulator/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key'), 'sk_wrong');
    await user.type(screen.getByLabelText('Client ID'), 'client_emulated');
    await user.click(screen.getByRole('button', { name: 'Verify and save' }));
    expect(await screen.findByText('WorkOS rejected the API key.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('API key'));
    await user.type(screen.getByLabelText('API key'), 'sk_test_default');
    await user.click(screen.getByRole('button', { name: 'Verify and save' }));

    expect(await screen.findByRole('form', { name: 'Operator account' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue to WorkOS' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:4100/user_management/authorize?screen_hint=sign-up'));
    // State-changing calls carry the CSRF token from the setup session.
    const posts = api.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/setup'));
    expect(posts.length).toBeGreaterThanOrEqual(4);
    for (const c of posts) expect(c.headers['x-csrf-token']).toBe('csrf-1');
  });
});

describe('operator console: dashboard', () => {
  const session = { kind: 'full', csrfToken: 'csrf-full', expiresAt: Date.now() + 1e6, operator: { id: 'op1', email: 'owner@example.com' } };
  const overview = {
    generatedAt: Date.now(),
    workspaces: { total: 12, recent: 3, active7d: 5, suspended: 1 },
    invoices: { total: 40, recent: 7, byCreator: { user: { total: 30, recent: 5 }, agent: { total: 10, recent: 2 }, system: { total: 3, recent: 1 } } },
    clients: { total: 9, recent: 2 },
    templates: { total: 4, recent: 1 },
    recurring: { total: 2, active: 1, paused: 1 },
    agents: { active: 4, revoked: 1, pendingRegistrations: 2 },
    api: {
      last24h: { requests: 1234, errors: 2, errorRate: 0.0016, p50Ms: 12, p95Ms: 80 },
      last7d: { requests: 9000, errors: 9, errorRate: 0.001, p50Ms: 11, p95Ms: 90 },
    },
    requestsHourly: Array.from({ length: 24 }, (_, i) => ({ t: Date.now() - (23 - i) * 3_600_000, count: i * 3, errors: 0, p95Ms: 50 })),
    workspacesDaily: [],
    invoicesDaily: [],
  };
  const settingsState = { maintenance: false };
  const routes: Record<string, Handler> = {
    'GET /status': () => ({ json: { phase: 'ready', encryptionLocked: false } }),
    'GET /session': () => ({ json: session }),
    'GET /overview': () => ({ json: overview }),
    'GET /settings': () => ({
      json: {
        configVersion: 3,
        propagationSeconds: 5,
        encryptionLocked: false,
        settings: [
          { key: 'maintenance.enabled', group: 'General', label: 'Maintenance mode', description: 'd', type: 'boolean', secret: false, value: settingsState.maintenance, defaultValue: false, source: 'default', updatedAt: null, updatedBy: null },
          { key: 'registration.workspacesOpen', group: 'General', label: 'New workspaces', description: 'd', type: 'boolean', secret: false, value: true, defaultValue: true, source: 'default', updatedAt: null, updatedBy: null },
          { key: 'registration.agentsOpen', group: 'General', label: 'Agent registrations', description: 'd', type: 'boolean', secret: false, value: true, defaultValue: true, source: 'default', updatedAt: null, updatedBy: null },
          { key: 'github.token', group: 'Deployments', label: 'GitHub token', description: 'd', type: 'secret', secret: true, isSet: true, last4: 'WXYZ', source: 'database', updatedAt: Date.now(), updatedBy: 'owner@example.com' },
        ],
      },
    }),
    'PUT /settings/maintenance.enabled': (body) => {
      settingsState.maintenance = (body as { value: boolean }).value;
      return { json: { ok: true } };
    },
    'GET /workspaces': () => ({
      json: { workspaces: [{ id: 'ws-1234567890', createdAt: new Date().toISOString(), lastActivityAt: Date.now(), invoiceCount: 3, agentCount: 1, clientCount: 2, suspended: false, suspendedAt: null, suspensionReason: null }], next: null },
    }),
    'GET /agents': () => ({ json: { agents: [], next: null } }),
    'POST /workspaces/ws-1234567890/suspend': () => ({ json: { suspended: true } }),
    'GET /accounts': () => ({
      json: {
        enabled: true,
        linkedWorkspaces: 1,
        requiredForNewWorkspaces: false,
        accounts: [
          { id: 'acc-1', email: 'alice@example.com', emailVerified: true, createdAt: Date.now(), lastSignInAt: Date.now(), workspaceId: 'ws-1234567890', activeDevices: 2, disabled: false, disabledAt: null, disabledReason: null },
        ],
        next: null,
      },
    }),
    'POST /accounts/acc-1/disable': () => ({ json: { disabled: true } }),
  };

  it('shows the overview with headline stats and the sidebar', async () => {
    vi.stubGlobal('fetch', fakeOperatorApi(routes).fetchMock);
    renderConsole('/operator');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Saved clients')).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Operator console' })[0]).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /API requests per hour/ })).toBeInTheDocument();
  });

  it('toggles maintenance mode from Settings, sending the CSRF token; secrets are write-only', async () => {
    const api = fakeOperatorApi(routes);
    vi.stubGlobal('fetch', api.fetchMock);
    const user = userEvent.setup();
    renderConsole('/operator/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const quick = screen.getAllByRole('switch', { name: 'Maintenance mode' })[0];
    expect(quick).toHaveAttribute('aria-checked', 'false');
    await user.click(quick);
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/settings/maintenance.enabled', body: { value: true } }));
    expect(api.calls.find((c) => c.method === 'PUT')!.headers['x-csrf-token']).toBe('csrf-full');
    const secret = screen.getByLabelText('GitHub token');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
    expect(screen.getByText(/•••• WXYZ · write-only/)).toBeInTheDocument();
  });

  it('lists accounts in Users and disables one', async () => {
    const api = fakeOperatorApi(routes);
    vi.stubGlobal('fetch', api.fetchMock);
    const user = userEvent.setup();
    renderConsole('/operator/users');
    const table = await screen.findByRole('table', { name: 'Accounts' });
    expect(within(table).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(table).getByText('Verified')).toBeInTheDocument();
    expect(within(table).getByText('ws-12345…')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'abuse');
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.calls.find((c) => c.path === '/accounts/acc-1/disable')).toMatchObject({ method: 'POST', body: { reason: 'abuse' } }));
    expect(api.calls.find((c) => c.path === '/accounts/acc-1/disable')!.headers['x-csrf-token']).toBeTruthy();
  });

  it('shows "Email: not configured" above the Email settings until the key and From address are set', async () => {
    const email = (apiKeySet: boolean, fromAddress: string) => ({
      json: {
        configVersion: 3,
        propagationSeconds: 5,
        encryptionLocked: false,
        settings: [
          { key: 'email.enabled', group: 'Email', label: 'Send invoices by email', description: 'd', type: 'boolean', secret: false, value: true, defaultValue: true, source: 'default', updatedAt: null, updatedBy: null },
          { key: 'resend.apiKey', group: 'Email', label: 'Resend API key', description: 'd', type: 'secret', secret: true, isSet: apiKeySet, last4: null, source: apiKeySet ? 'environment' : 'default', updatedAt: null, updatedBy: null },
          { key: 'email.fromAddress', group: 'Email', label: 'From address', description: 'd', type: 'string', secret: false, value: fromAddress, defaultValue: '', source: 'default', updatedAt: null, updatedBy: null },
        ],
      },
    });
    vi.stubGlobal('fetch', fakeOperatorApi({ ...routes, 'GET /settings': () => email(false, '') }).fetchMock);
    const { unmount } = renderConsole('/operator/settings');
    expect(await screen.findByText('Email: not configured — set the Resend API key and the From address (on a domain verified with Resend)')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', fakeOperatorApi({ ...routes, 'GET /settings': () => email(true, 'invoices@mail.example.org') }).fetchMock);
    renderConsole('/operator/settings');
    expect(await screen.findByText('Email: configured')).toBeInTheDocument();
  });

  it('suspends a workspace from Users and states the privacy boundary', async () => {
    const api = fakeOperatorApi(routes);
    vi.stubGlobal('fetch', api.fetchMock);
    const user = userEvent.setup();
    renderConsole('/operator/users');
    expect(await screen.findByText(/Privacy boundary/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Workspaces' });
    await user.click(within(table).getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'spam');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith('/suspend'))).toMatchObject({ body: { reason: 'spam' } }));
  });
});
