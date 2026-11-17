import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi, type RecordedRequest } from '@/test/fakeApi';
import AuthorizeAgent from './AuthorizeAgent';
import { browser, checkRedirectTarget } from './consent';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = 'Rq'.repeat(22);
const REDIRECT = 'http://127.0.0.1:53682/callback';
let fake: FakeApi;
let leaveTo: ReturnType<typeof vi.spyOn>;

function preview(overrides: Record<string, unknown> = {}) {
  return {
    request: {
      id: ID,
      client: { kind: 'dcr', name: '<img src=x onerror=alert(1)> Claude', metadataHost: null, clientUri: null },
      redirect: { uri: REDIRECT, kind: 'loopback', display: '127.0.0.1:53682' },
      requestedScopes: ['invoices:read', 'invoices:write', 'invoices:delete'],
      scopesDefaulted: false,
      existingAgent: null,
      createdAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
      ...overrides,
    },
  };
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/agents/authorize" element={<AuthorizeAgent />} />
            <Route path="/agents" element={<div>Agents page</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
const oauthRequests = () => fake.requests.filter((r) => r.path.startsWith('/oauth/'));
function serve(respond: (req: RecordedRequest) => Response) {
  fake.use((req) => (req.path.startsWith('/oauth/requests/') ? respond(req) : undefined));
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  leaveTo = vi.spyOn(browser, 'leaveTo').mockImplementation(() => undefined);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  leaveTo.mockRestore();
  vi.unstubAllGlobals();
});

describe('AuthorizeAgent (OAuth consent screen)', () => {
  it('shows the request as untrusted plain text and never decides on its own', async () => {
    connect();
    serve((req) => (req.method === 'GET' ? fake.json(200, preview()) : fake.apiError(500, 'internal_error', 'unexpected')));
    const { container } = renderAt(`/agents/authorize?request=${ID}`);

    expect(await screen.findByTestId('client-name')).toHaveTextContent('<img src=x onerror=alert(1)> Claude');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByTestId('redirect-display')).toHaveTextContent('127.0.0.1:53682');
    expect(screen.getByText('(a program on this computer)')).toBeInTheDocument();
    expect(screen.getByTestId('local-redirect-warning')).toBeInTheDocument();
    expect(screen.getByText(/Only approve if you started this yourself/)).toBeInTheDocument();
    expect(screen.getByText(/registered itself \(not verified\)/)).toBeInTheDocument();
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(oauthRequests().map((r) => `${r.method} ${r.path}`)).toEqual([`GET /oauth/requests/${ID}`]);
    // The workspace token only travels in the Authorization header.
    expect(oauthRequests()[0].headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(oauthRequests()[0].query.toString()).toBe('');
    expect(leaveTo).not.toHaveBeenCalled();
  });

  it('approves with narrowed scopes, then sends the browser back to the client', async () => {
    connect();
    let body: unknown;
    const redirectTo = `${REDIRECT}?code=mi_ac_x&state=s&iss=${encodeURIComponent('https://app.test')}`;
    serve((req) => {
      if (req.method === 'GET') return fake.json(200, preview());
      body = req.body;
      return fake.json(200, { status: 'approved', scopes: ['invoices:read', 'invoices:write'], redirectTo });
    });
    const user = userEvent.setup();
    renderAt(`/agents/authorize?request=${ID}`);
    await user.click(await screen.findByRole('checkbox', { name: /Delete invoices/ }));
    await user.click(screen.getByRole('button', { name: 'Approve 2 of 3 permissions' }));

    expect(await screen.findByText('Access approved')).toBeInTheDocument();
    expect(body).toEqual({ scopes: ['invoices:read', 'invoices:write'] });
    expect(oauthRequests().slice(-1)[0]).toMatchObject({ method: 'POST', path: `/oauth/requests/${ID}/approve` });
    expect(leaveTo).toHaveBeenCalledWith(redirectTo);
    expect(screen.getByRole('link', { name: 'Continue to 127.0.0.1:53682' })).toHaveAttribute('href', redirectTo);
  });

  it('denies and returns access_denied to the client', async () => {
    connect();
    const redirectTo = `${REDIRECT}?error=access_denied&state=s`;
    serve((req) => (req.method === 'GET' ? fake.json(200, preview()) : fake.json(200, { status: 'denied', redirectTo })));
    const user = userEvent.setup();
    renderAt(`/agents/authorize?request=${ID}`);
    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Request denied')).toBeInTheDocument();
    expect(oauthRequests().slice(-1)[0]?.path).toBe(`/oauth/requests/${ID}/deny`);
    expect(leaveTo).toHaveBeenCalledWith(redirectTo);
  });

  it('refuses to follow a redirect target that is not the reviewed redirect URI', async () => {
    connect();
    serve((req) => (req.method === 'GET' ? fake.json(200, preview()) : fake.json(200, { status: 'approved', scopes: ['invoices:read'], redirectTo: 'https://evil.example/cb?code=x' })));
    const user = userEvent.setup();
    renderAt(`/agents/authorize?request=${ID}`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Could not return to the app')).toBeInTheDocument();
    expect(leaveTo).not.toHaveBeenCalled();
  });

  it('requires at least one permission', async () => {
    connect();
    serve(() => fake.json(200, preview({ requestedScopes: ['invoices:read'] })));
    const user = userEvent.setup();
    renderAt(`/agents/authorize?request=${ID}`);
    await user.click(await screen.findByRole('checkbox', { name: /View invoices/ }));
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeDisabled();
  });

  it('shows metadata-document clients, default scopes and an existing connection', async () => {
    connect();
    serve(() =>
      fake.json(
        200,
        preview({
          client: { kind: 'cimd', name: 'Hosted Connector', metadataHost: 'tools.example.com', clientUri: null },
          redirect: { uri: 'https://tools.example.com/cb', kind: 'https', display: 'tools.example.com' },
          scopesDefaulted: true,
          existingAgent: { id: 'a1', name: 'Hosted Connector', scopes: ['invoices:read'] },
        }),
      ),
    );
    renderAt(`/agents/authorize?request=${ID}`);
    expect(await screen.findByText(/details published at/)).toBeInTheDocument();
    expect(screen.getAllByText('tools.example.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/\(a website\)/)).toBeInTheDocument();
    expect(screen.queryByTestId('local-redirect-warning')).toBeNull();
    expect(screen.getByText(/did not ask for specific permissions/)).toBeInTheDocument();
    expect(screen.getByTestId('existing-agent')).toHaveTextContent('already connected');
  });

  it.each([
    [404, 'not_found', undefined, 'No such request'],
    [409, 'conflict', { status: 'denied' }, 'This request was already denied'],
    [410, 'gone', undefined, 'This request expired'],
  ])('explains a %i', async (status, code, details, title) => {
    connect();
    serve(() => fake.apiError(status, code, 'x', details));
    renderAt(`/agents/authorize?request=${ID}`);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('treats an expired request as expired without asking the server', async () => {
    connect();
    serve(() => fake.json(200, preview({ expiresAt: new Date(Date.now() - 1000).toISOString() })));
    renderAt(`/agents/authorize?request=${ID}`);
    expect(await screen.findByText('This request expired')).toBeInTheDocument();
  });

  it('asks to enable cloud sync first, without calling the API', async () => {
    renderAt(`/agents/authorize?request=${ID}`);
    expect(screen.getByText('An app is asking to connect')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turn on cloud sync/i })).toBeInTheDocument();
    expect(oauthRequests()).toEqual([]);
  });

  it('shows fixed text for errors found before review, never text from the URL', () => {
    renderAt(`/agents/authorize?error=invalid_redirect_uri`);
    expect(screen.getByText('This link cannot be used')).toBeInTheDocument();
    expect(screen.getByText(/you were not sent back to it/)).toBeInTheDocument();
  });

  it('explains maintenance mode', () => {
    renderAt('/agents/authorize?error=temporarily_unavailable');
    expect(screen.getByText('Temporarily unavailable')).toBeInTheDocument();
  });

  it('maps unknown error codes to a generic message', () => {
    renderAt(`/agents/authorize?error=${encodeURIComponent('<b>pwned</b>')}`);
    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByText(/pwned/)).toBeNull();
  });

  it('has nothing to review without a request id', () => {
    connect();
    renderAt('/agents/authorize');
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
    expect(oauthRequests()).toEqual([]);
  });
});

describe('checkRedirectTarget', () => {
  it('only accepts the reviewed redirect URI', () => {
    expect(checkRedirectTarget(`${REDIRECT}?code=1`, REDIRECT)?.href).toBe(`${REDIRECT}?code=1`);
    expect(checkRedirectTarget('cursor://anysphere.cursor/cb?code=1', 'cursor://anysphere.cursor/cb')).not.toBeNull();
    expect(checkRedirectTarget('http://127.0.0.1:1/callback?code=1', REDIRECT)).toBeNull();
    expect(checkRedirectTarget('javascript:alert(1)', 'javascript:alert(1)')).toBeNull();
    expect(checkRedirectTarget('not a url', REDIRECT)).toBeNull();
  });
});
