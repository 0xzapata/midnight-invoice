import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import type { Invoice } from '@/types/invoice';
import type { Client } from '../../shared/types/client';
import Activity from './Activity';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

let fake: FakeApi;
const bot = { type: 'agent' as const, agentId: 'agent-1', agentName: 'Billing Assistant' };
const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

function Probe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(path = '/activity') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/activity" element={<Activity />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
const activityRequests = () => fake.requests.filter((r) => r.method === 'GET' && r.path === '/activity');
const lastQuery = () => Object.fromEntries(activityRequests().pop()!.query);

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
  useInvoiceStore.setState({ invoices: [{ id: LIVE, invoiceNumber: 'INV-0007' } as Invoice] });
  useClientStore.setState({ clients: [{ id: 'client-1', name: 'Globex' } as Client] });
  fake.state.agents = [
    { id: 'agent-1', name: 'Billing Assistant', description: null, scopes: ['invoices:read'], createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null, revokedAt: null },
  ];
  const s = fake.server;
  s.addActivity({ time: '2026-11-03T12:00:00.000Z', action: 'agent.approved', actor: { type: 'user' }, entity: { type: 'agent_registration', id: 'r1', label: 'Billing Assistant' }, changes: { scopes: ['invoices:read', 'invoices:write'] } });
  s.addActivity({ time: '2026-11-03T12:01:00.000Z', action: 'invoice.created', actor: bot, entity: { type: 'invoice', id: GONE, label: 'INV-0003' } });
  s.addActivity({ time: '2026-11-04T12:00:00.000Z', action: 'invoice.created', actor: bot, entity: { type: 'invoice', id: LIVE, label: 'INV-0007' } });
  s.addActivity({ time: '2026-11-04T12:05:00.000Z', action: 'invoice.status_changed', actor: bot, entity: { type: 'invoice', id: LIVE, label: 'INV-0007' }, changes: { status: { from: 'sent', to: 'paid' } }, source: 'mcp', tool: 'set_invoice_status' });
  s.addActivity({ time: '2026-11-04T12:06:00.000Z', action: 'client.updated', actor: { type: 'user' }, entity: { type: 'client', id: 'client-1', label: 'Globex' }, changes: { fields: ['email', 'paymentTermsDays'] } });
  s.addActivity({ time: '2026-11-04T12:07:00.000Z', action: 'invoice.deleted', actor: bot, entity: { type: 'invoice', id: GONE, label: 'INV-0003' } });
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe('Activity page', () => {
  it('explains that activity needs cloud sync instead of showing an empty page', () => {
    renderPage();
    expect(screen.getByText(/starts once cloud sync is on/)).toBeInTheDocument();
    expect(screen.getByText(/are not logged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on cloud sync' })).toBeInTheDocument();
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('shows a timeline grouped by day with actor chips, sentences, details and links', async () => {
    connect();
    renderPage();
    const nov4 = await screen.findByRole('region', { name: 'Wednesday, Nov 4, 2026' });
    const nov3 = screen.getByRole('region', { name: 'Tuesday, Nov 3, 2026' });
    const items = within(nov4).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')!.textContent)).toEqual([
      'Billing Assistant deleted INV-0003',
      'You edited the client Globex',
      'Billing Assistant marked INV-0007 as paid',
      'Billing Assistant created INV-0007',
    ]);
    expect(items[1]).toHaveTextContent('Changed email and payment terms');
    expect(items[2]).toHaveTextContent('Was sent · via MCP · set_invoice_status');
    // Existing invoice → link; deleted invoice → label only, marked deleted where it is not the delete itself.
    expect(within(items[2]).getByRole('link', { name: 'INV-0007' })).toHaveAttribute('href', `/invoice/${LIVE}`);
    expect(within(items[0]).queryByRole('link', { name: /INV-0003/ })).toBeNull();
    // Agent chips lead to that agent's activity (reachable for revoked agents too).
    expect(within(items[0]).getByRole('link', { name: 'Billing Assistant' })).toHaveAttribute('href', '/activity?agent=agent-1');
    const created3 = within(nov3).getAllByRole('listitem')[0];
    expect(created3).toHaveTextContent('Billing Assistant created INV-0003 (deleted)');
    expect(within(created3).queryByRole('link', { name: /INV-0003/ })).toBeNull();
    expect(within(items[1]).getByRole('link', { name: 'Globex' })).toHaveAttribute('href', '/clients');
    expect(within(nov3).getAllByRole('listitem')[1]).toHaveTextContent('You approved the agent Billing Assistant');
    expect(within(nov3).getAllByRole('listitem')[1]).toHaveTextContent('Permissions: View, Create & edit');
  });

  it('filters by agent, action group and date range through the API', async () => {
    connect();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/marked/);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Billing Assistant' })).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Who'), 'agent-1');
    await waitFor(() => expect(lastQuery()).toMatchObject({ agent_id: 'agent-1' }));
    await user.selectOptions(screen.getByLabelText('What'), 'payments');
    await waitFor(() => expect(lastQuery()).toMatchObject({ agent_id: 'agent-1', action: 'invoice.status_changed' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('listitem')).toHaveTextContent('Billing Assistant marked INV-0007 as paid');

    await user.selectOptions(screen.getByLabelText('Who'), 'you');
    await waitFor(() => expect(screen.getByText('No activity matches these filters.')).toBeInTheDocument());
    expect(lastQuery()).toMatchObject({ actor: 'user' });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.type(screen.getByLabelText('From'), '2026-11-04');
    await user.type(screen.getByLabelText('To'), '2026-11-04');
    await waitFor(() => expect(lastQuery()).toHaveProperty('until'));
    const q = lastQuery();
    expect(new Date(q.since).getDate()).toBe(4);
    expect(new Date(q.until).getDate()).toBe(4);
    expect(new Date(q.until).getTime() - new Date(q.since).getTime()).toBe(24 * 3600 * 1000 - 1);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4));
  });

  it('opens pre-filtered from a link and pages with "Load older activity"', async () => {
    for (let i = 0; i < 55; i++) fake.server.addActivity({ time: `2026-11-05T10:${String(i).padStart(2, '0')}:00.000Z`, action: 'invoice.pdf_downloaded', actor: bot, entity: { type: 'invoice', id: LIVE, label: 'INV-0007' } });
    connect();
    const user = userEvent.setup();
    renderPage('/activity?agent=agent-1');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
    expect(lastQuery()).toMatchObject({ agent_id: 'agent-1', limit: '50' });
    expect(screen.getByLabelText('Who')).toHaveValue('agent-1');
    await user.click(screen.getByRole('button', { name: 'Load older activity' }));
    // 55 downloads + 4 other entries by the agent.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(59));
    expect(lastQuery()).toHaveProperty('before');
    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull();
    expect(screen.getByText('59 entries shown')).toBeInTheDocument();
  });

  it('shows a calm empty state when nothing was recorded yet', async () => {
    fake.state.activity = [];
    connect();
    renderPage();
    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
  });
});
