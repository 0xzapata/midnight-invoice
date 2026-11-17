import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi, type RecordedRequest } from '@/test/fakeApi';
import ApproveAgent from './ApproveAgent';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const CODE = 'WDJB-MJHT';
let fake: FakeApi;

function registration(overrides: Record<string, unknown> = {}) {
  return {
    registration: {
      id: 'reg-1',
      userCode: CODE,
      name: '<img src=x onerror=alert(1)> Evil Bot',
      description: 'Drafts monthly invoices\n<b>not bold</b>',
      requestedScopes: ['invoices:read', 'invoices:write', 'invoices:delete'],
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
      ...overrides,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/agents/approve" element={<><ApproveAgent /><LocationProbe /></>} />
            <Route path="/agents" element={<div>Agents page</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
const registrationRequests = () => fake.requests.filter((r) => r.path.startsWith('/agents/registrations/'));

function serveRegistration(respond: (req: RecordedRequest) => Response) {
  fake.use((req) => (req.path.startsWith('/agents/registrations/') ? respond(req) : undefined));
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe('ApproveAgent', () => {
  it('prefills the code from the URL, shows the request as plain text and never approves on its own', async () => {
    connect();
    serveRegistration((req) => (req.method === 'GET' ? fake.json(200, registration()) : fake.apiError(500, 'internal_error', 'unexpected')));
    const { container } = renderAt('/agents/approve?code=wdjb mjht');

    expect(await screen.findByTestId('agent-name')).toHaveTextContent('<img src=x onerror=alert(1)> Evil Bot');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/is asking for access to this workspace’s invoices/)).toBeInTheDocument();
    expect(screen.getByText(/Only approve if you started this yourself/)).toBeInTheDocument();
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();

    // Looked up with the normalised code; nothing was decided.
    expect(registrationRequests().map((r) => `${r.method} ${r.path}`)).toEqual([`GET /agents/registrations/${CODE}`]);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
  });

  it('approves with narrowed scopes and tells the user to return to their agent', async () => {
    connect();
    let approveBody: unknown;
    serveRegistration((req) => {
      if (req.method === 'GET') return fake.json(200, registration());
      approveBody = req.body;
      return fake.json(200, { registration: { id: 'reg-1', status: 'approved', scopes: ['invoices:read', 'invoices:write'] } });
    });
    const user = userEvent.setup();
    renderAt(`/agents/approve?code=${CODE}`);

    await user.click(await screen.findByRole('checkbox', { name: /Delete invoices/ }));
    const approve = screen.getByRole('button', { name: 'Approve 2 of 3 permissions' });
    await user.click(approve);

    expect(await screen.findByText('Agent approved')).toBeInTheDocument();
    expect(screen.getByText(/Return to your agent/)).toBeInTheDocument();
    expect(approveBody).toEqual({ scopes: ['invoices:read', 'invoices:write'] });
    expect(registrationRequests().slice(-1)[0]?.path).toBe(`/agents/registrations/${CODE}/approve`);
  });

  it('requires at least one permission to approve', async () => {
    connect();
    serveRegistration(() => fake.json(200, registration({ requestedScopes: ['invoices:read'] })));
    const user = userEvent.setup();
    renderAt(`/agents/approve?code=${CODE}`);
    await user.click(await screen.findByRole('checkbox', { name: /View invoices/ }));
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeDisabled();
    expect(screen.getByText(/Select at least one permission/)).toBeInTheDocument();
  });

  it('denies', async () => {
    connect();
    serveRegistration((req) => (req.method === 'GET' ? fake.json(200, registration()) : fake.json(200, { registration: { id: 'reg-1', status: 'denied' } })));
    const user = userEvent.setup();
    renderAt(`/agents/approve?code=${CODE}`);
    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Request denied')).toBeInTheDocument();
    expect(registrationRequests().slice(-1)[0]?.path).toBe(`/agents/registrations/${CODE}/deny`);
  });

  it.each([
    [404, 'not_found', undefined, 'No request with this code'],
    [409, 'conflict', { status: 'approved' }, 'This request was already approved'],
    [410, 'gone', undefined, 'This request expired'],
  ])('explains a %i from the lookup', async (status, code, details, title) => {
    connect();
    serveRegistration(() => fake.apiError(status, code, 'x', details));
    renderAt(`/agents/approve?code=${CODE}`);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('explains rate limiting with the wait time', async () => {
    connect();
    serveRegistration(() => fake.apiError(429, 'rate_limited', 'Too many requests', undefined, { 'retry-after': '300' }));
    renderAt(`/agents/approve?code=${CODE}`);
    expect(await screen.findByText('Too many attempts')).toBeInTheDocument();
    expect(screen.getByText(/wait 5 minutes/)).toBeInTheDocument();
  });

  it('shows the expired state when the countdown runs out', async () => {
    connect();
    serveRegistration(() => fake.json(200, registration({ expiresAt: new Date(Date.now() - 1000).toISOString() })));
    renderAt(`/agents/approve?code=${CODE}`);
    expect(await screen.findByText('This request expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
  });

  it('shows an approval that raced to 409 as already decided', async () => {
    connect();
    serveRegistration((req) =>
      req.method === 'GET' ? fake.json(200, registration()) : fake.apiError(409, 'conflict', 'already', { status: 'denied' }),
    );
    const user = userEvent.setup();
    renderAt(`/agents/approve?code=${CODE}`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This request was already denied')).toBeInTheDocument();
  });

  it('when cloud sync is off: explains, offers to enable it, then continues with the same code', async () => {
    serveRegistration(() => fake.json(200, registration()));
    const user = userEvent.setup();
    renderAt(`/agents/approve?code=${CODE}`);

    expect(screen.getByText(`Code ${CODE}`)).toBeInTheDocument();
    expect(screen.getByText(/cloud sync is not turned on in this browser yet/)).toBeInTheDocument();
    expect(registrationRequests()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Turn on cloud sync' }));
    expect(await screen.findByTestId('agent-name')).toBeInTheDocument();
    expect(fake.writes()[0]).toBe('POST /workspaces');
    expect(screen.getByTestId('location')).toHaveTextContent(`/agents/approve?code=${CODE}`);
    expect(registrationRequests().map((r) => r.method)).toEqual(['GET']);
  });

  it('accepts a manually typed code, forgiving case and separators', async () => {
    connect();
    serveRegistration(() => fake.json(200, registration()));
    const user = userEvent.setup();
    renderAt('/agents/approve');

    const input = screen.getByLabelText('Code');
    await user.type(input, 'wdjb');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/8 letters/);

    await user.clear(input);
    await user.type(input, ' wdjb mjht ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?code=${CODE}`));
    expect(await screen.findByTestId('agent-name')).toBeInTheDocument();
  });

  it('labels every permission in plain language', async () => {
    connect();
    serveRegistration(() => fake.json(200, registration({ requestedScopes: ['invoices:read', 'invoices:write', 'invoices:delete', 'settings:read'] })));
    renderAt(`/agents/approve?code=${CODE}`);
    const group = await screen.findByRole('group', { name: 'Permissions requested' });
    for (const label of ['View invoices', 'Create and edit invoices', 'Delete invoices', 'Read your default details']) {
      expect(within(group).getByRole('checkbox', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});
