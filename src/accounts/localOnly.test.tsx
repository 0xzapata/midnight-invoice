/**
 * The "purely local app makes no API calls" promise with optional accounts:
 * the dashboard, editor and invoice pages make no request at all while cloud
 * sync is off; the public account flag is read only when cloud-sync UI is on
 * screen, once per page load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { InvoiceFormData } from '@/types/invoice';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CloudSyncSettings } from '@/components/sync/CloudSyncSettings';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { leaveWorkspace } from '@/lib/sync/session';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { installFakeAccounts } from '@/test/fakeAccounts';
import Index from '@/pages/Index';
import CreateInvoice from '@/pages/CreateInvoice';
import ViewInvoice from '@/pages/ViewInvoice';
import { useAccountStore } from './useAccountStore';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = '00000000-0000-4000-8000-000000000123';
const form: InvoiceFormData = {
  invoiceNumber: 'INV-0123',
  invoiceName: '',
  issueDate: '2026-11-01',
  dueDate: '',
  fromName: 'Ada Ltd',
  fromAddress: '',
  fromEmail: '',
  toName: 'Globex',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, price: 100 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'EUR',
};

let fake: FakeApi;
let accounts: ReturnType<typeof installFakeAccounts>;

function renderApp(path: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/create" element={<CreateInvoice />} />
            <Route path="/create/:id" element={<CreateInvoice />} />
            <Route path="/invoice/:id" element={<ViewInvoice />} />
            <Route path="/sync" element={<CloudSyncSettings />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useInvoiceStore.getState().saveInvoice(form, ID);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
  useAccountStore.setState({ linked: null, signedOut: null });
  fake = createFakeApi();
  accounts = installFakeAccounts(fake);
  vi.stubGlobal('fetch', fake.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('with cloud sync off', () => {
  it('the dashboard, the editor and the invoice page make no request at all', async () => {
    const dash = renderApp('/');
    expect(await screen.findByText('INV-0123')).toBeInTheDocument();
    await settle();
    dash.unmount();
    const create = renderApp('/create');
    expect(await screen.findByPlaceholderText('Client name')).toBeInTheDocument();
    await settle();
    create.unmount();
    renderApp(`/invoice/${ID}`);
    expect((await screen.findAllByText(/INV-0123/)).length).toBeGreaterThan(0);
    await settle();
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it('reads the public account flag (and the session) once, only when the settings tab shows cloud sync', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderApp('/?tab=settings', queryClient);
    expect(await screen.findByRole('button', { name: 'Turn on cloud sync' })).toBeInTheDocument();
    await waitFor(() => expect(fake.fetch).toHaveBeenCalledTimes(1));
    first.unmount();
    // Back to the dashboard and to settings again in the same page load: cached, no new request.
    renderApp('/?tab=settings', queryClient);
    await screen.findByRole('button', { name: 'Turn on cloud sync' });
    await settle();
    // Accounts are on in this fake, so whether someone is signed in is asked once too (cookie only, no data).
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/account/config', 'GET /api/account/session']);
  });
});

describe('signed-in browsers that stop syncing', () => {
  it('explains that the site operator disabled the account, keeping local data', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    useAccountStore.setState({ linked: { userId: 'u', email: 'alice@example.com', deviceId: 'd', workspaceId: 'ws-1' } });
    accounts.acc.deviceStatus = 'account_disabled';
    leaveWorkspace('token_rejected');
    renderApp('/sync');
    expect(await screen.findByText(/site operator disabled this account/)).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/the workspace may have been deleted/)).not.toBeInTheDocument();
    const status = fake.requests.find((r) => r.path === '/api/account/device-status')!;
    expect(status.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
    expect(useAccountStore.getState().linked).toBeNull();
  });

  it('says "signed out from another device" for a revoked device key', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    useAccountStore.setState({ linked: { userId: 'u', email: 'alice@example.com', deviceId: 'd', workspaceId: 'ws-1' } });
    accounts.acc.deviceStatus = 'revoked';
    leaveWorkspace('token_rejected');
    renderApp('/sync');
    expect(await screen.findByText(/signed out from another device/)).toBeInTheDocument();
  });

  it('keeps syncing when accounts are turned off, without account management', async () => {
    accounts.acc.enabled = false;
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    useAccountStore.setState({ linked: { userId: 'u', email: 'alice@example.com', deviceId: 'd', workspaceId: 'ws-1' } });
    renderApp('/sync');
    expect(await screen.findByText(/Accounts are turned off on this site right now/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage account/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out of this browser/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show recovery key/i })).not.toBeInTheDocument();
  });
});
