import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { toast } from 'sonner';
import ViewInvoice from '@/pages/ViewInvoice';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { ClientReviewNotice } from './NeedsReview';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = '6d0c3a52-5d0b-4b8e-9f0e-1c2d3e4f5a6b';
let fake: FakeApi;

function renderAt(element: React.ReactNode, path = `/invoice/${ID}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/invoice/:id" element={element} />
          <Route path="/create/:id" element={<p>Editor</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  resetSyncEngineForTests();
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
  const inv = fake.server.create(ID, { invoiceNumber: 'INV-0042', fromName: 'Studio', toName: 'Acme', toEmail: 'billing@acme.io', paymentDetails: 'IBAN ATTACKER', lineItems: [{ description: 'x', quantity: 1, price: 1 }] } as never);
  useInvoiceStore.setState({ invoices: [inv], _hasHydrated: true });
  vi.mocked(toast.success).mockClear();
});

afterEach(async () => {
  await whenIdle();
  vi.unstubAllGlobals();
});

describe('Needs your review', () => {
  it('lists the agent-written fields (old → new) and approves exactly the reviewed revision', async () => {
    fake.state.reviews = {
      invoices: [{ id: ID, invoiceNumber: 'INV-0042', revision: 1, agentName: 'Claude Desktop', fields: [{ field: 'paymentDetails', value: 'IBAN ATTACKER', previous: 'IBAN USER' }] }],
      clients: [],
    };
    const user = userEvent.setup({ delay: null });
    renderAt(<ViewInvoice />);
    const banner = await screen.findByRole('region', { name: 'Needs your review' });
    expect(within(banner).getByText(/An agent \(Claude Desktop\) wrote/)).toBeInTheDocument();
    expect(within(banner).getByText('Payment details')).toBeInTheDocument();
    expect(within(banner).getByText('IBAN USER')).toBeInTheDocument();
    expect(within(banner).getByText('IBAN ATTACKER')).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Looks right — approve' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Needs your review' })).not.toBeInTheDocument());
    const post = fake.requests.find((r) => r.method === 'POST' && r.path === `/invoices/${ID}/review`);
    expect(post?.headers['if-match']).toBe('"1"');
    expect(toast.success).toHaveBeenCalled();
  });

  it('"Edit" opens the editor; nothing is shown when nothing needs review or sync is off', async () => {
    fake.state.reviews = { invoices: [{ id: ID, invoiceNumber: 'INV-0042', revision: 1, agentName: null, fields: [{ field: 'toEmail', value: 'billing@acme.io', previous: null }] }], clients: [] };
    const user = userEvent.setup({ delay: null });
    const { unmount } = renderAt(<ViewInvoice />);
    const banner = await screen.findByRole('region', { name: 'Needs your review' });
    expect(within(banner).getByText(/You did not enter/)).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Editor')).toBeInTheDocument();
    unmount();

    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
    const before = fake.requests.length;
    renderAt(<ViewInvoice />);
    await screen.findByText('INV-0042', undefined, { timeout: 2000 }).catch(() => null);
    expect(screen.queryByRole('region', { name: 'Needs your review' })).not.toBeInTheDocument();
    expect(fake.requests.slice(before).filter((r) => r.path === '/reviews')).toEqual([]);
  });

  it('a client whose email an agent wrote shows "Confirm address"', async () => {
    fake.state.reviews = { invoices: [], clients: [{ id: 'c1', name: 'Globex', email: 'ap@evil-payee.io', revision: 3, agentName: 'Claude Desktop' }] };
    const user = userEvent.setup({ delay: null });
    renderAt(<ClientReviewNotice clientId="c1" />);
    const note = await screen.findByRole('note', { name: 'Email needs your review' });
    expect(within(note).getByText('ap@evil-payee.io')).toBeInTheDocument();
    await user.click(within(note).getByRole('button', { name: 'Confirm address' }));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
    expect(fake.requests.find((r) => r.method === 'POST' && r.path === '/clients/c1/review')?.headers['if-match']).toBe('"3"');
  });
});
