import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { InvoiceHistory } from './InvoiceHistory';

let fake: FakeApi;
const ID = '11111111-1111-4111-8111-111111111111';
const bot = { type: 'agent' as const, agentId: 'agent-1', agentName: 'Billing Assistant' };

function renderHistory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InvoiceHistory invoiceId={ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
});
afterEach(() => vi.unstubAllGlobals());

describe('InvoiceHistory', () => {
  it('renders nothing and calls no API while cloud sync is off', () => {
    const { container } = renderHistory();
    expect(container).toBeEmptyDOMElement();
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('lists the invoice’s own entries, newest first, with paging', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
    const inv = { type: 'invoice', id: ID, label: 'INV-0007' };
    fake.server.addActivity({ time: '2026-11-03T12:00:00.000Z', action: 'invoice.created', actor: bot, entity: inv });
    fake.server.addActivity({ time: '2026-11-03T12:30:00.000Z', action: 'invoice.updated', actor: { type: 'user' }, entity: inv, changes: { fields: ['dueDate'] } });
    for (let i = 0; i < 4; i++) fake.server.addActivity({ time: `2026-11-04T09:0${i}:00.000Z`, action: 'invoice.pdf_downloaded', actor: bot, entity: inv });
    fake.server.addActivity({ time: '2026-11-04T10:00:00.000Z', action: 'invoice.status_changed', actor: bot, entity: inv, changes: { status: { from: 'sent', to: 'paid' } } });
    fake.server.addActivity({ time: '2026-11-04T11:00:00.000Z', action: 'invoice.created', actor: bot, entity: { type: 'invoice', id: 'other', label: 'INV-0008' } });

    const user = userEvent.setup();
    renderHistory();
    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Billing Assistant marked INV-0007 as paid');
    expect(screen.queryByText(/INV-0008/)).toBeNull();
    const req = fake.requests.find((r) => r.path === '/activity')!;
    expect(Object.fromEntries(req.query)).toMatchObject({ entity_type: 'invoice', entity_id: ID, limit: '5' });

    await user.click(screen.getByRole('button', { name: 'Show earlier changes' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(7));
    expect(screen.getAllByRole('listitem')[6]).toHaveTextContent('Billing Assistant created INV-0007');
    expect(screen.getAllByRole('listitem')[5]).toHaveTextContent('You edited INV-0007');
  });
});
