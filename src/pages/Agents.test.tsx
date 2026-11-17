import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import Agents from './Agents';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

let fake: FakeApi;

function Probe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/approve" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
  fake.state.agents = [
    {
      id: 'agent-1',
      name: 'Claude Desktop',
      description: 'Drafts monthly invoices',
      scopes: ['invoices:read', 'invoices:write'],
      createdAt: '2026-11-10T10:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      id: 'agent-2',
      name: 'Old script',
      description: null,
      scopes: ['invoices:read'],
      createdAt: '2026-10-01T10:00:00.000Z',
      lastUsedAt: '2026-10-02T10:00:00.000Z',
      revokedAt: '2026-10-03T10:00:00.000Z',
    },
  ];
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });

describe('Agents page', () => {
  it('lists connected agents with their permissions and status', async () => {
    connect();
    renderPage();
    const list = await screen.findByRole('list', { name: 'Connected agents' });
    const row = within(list).getByText('Claude Desktop').closest('li')!;
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText('View')).toBeInTheDocument();
    expect(within(row).getByText('Create & edit')).toBeInTheDocument();
    expect(within(row).getByText(/Connected Nov 10, 2026 · Last used never/)).toBeInTheDocument();
    // Revoked agents are tucked away, not mixed in.
    expect(within(list).queryByText('Old script')).not.toBeInTheDocument();
    expect(screen.getByText('Revoked agents (1)')).toBeInTheDocument();
  });

  it('revokes an agent after confirmation and refreshes the list', async () => {
    connect();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Claude Desktop');

    await user.click(screen.getByRole('button', { name: /Revoke access for Claude Desktop/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/loses access to this workspace immediately/)).toBeInTheDocument();
    expect(fake.writes()).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(fake.writes()).toEqual(['DELETE /agents/agent-1']));
    await waitFor(() => expect(screen.getByText('Revoked agents (2)')).toBeInTheDocument());
    expect(screen.getByText(/No agents connected yet/)).toBeInTheDocument();
  });

  it('cancelling the confirmation does not revoke', async () => {
    connect();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Revoke access for Claude Desktop/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(fake.writes()).toEqual([]);
  });

  it('sends a typed code to the approve page', async () => {
    connect();
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Got a code from an agent?'), 'bcdf-ghjk');
    await user.click(screen.getByRole('button', { name: 'Review request' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/agents/approve?code=BCDF-GHJK');
  });

  it('shows connection help with the MCP endpoint and a prompt to paste', async () => {
    renderPage();
    expect(screen.getByText('http://localhost:3000/api/mcp'.replace('http://localhost:3000', window.location.origin))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Read ${window.location.origin}/llms.txt`))).toBeInTheDocument();
    expect(screen.getByText(/"Authorization": "Bearer <agent API key>"/)).toBeInTheDocument();
  });

  it('asks to turn on cloud sync first when it is off, without calling the API', () => {
    renderPage();
    expect(screen.getByText(/Turn on cloud sync to connect one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on cloud sync' })).toBeInTheDocument();
    expect(fake.fetch).not.toHaveBeenCalled();
  });
});
