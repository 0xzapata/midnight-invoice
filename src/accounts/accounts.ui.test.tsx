import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { InvoiceFormData } from '@/types/invoice';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CloudSyncSettings } from '@/components/sync/CloudSyncSettings';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, startCloudSync, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { installFakeAccounts } from '@/test/fakeAccounts';
import { accountNav, setAccountCsrfToken } from './api';
import { useAccountStore } from './useAccountStore';
import Account from './pages/Account';
import AccountConnect from './pages/AccountConnect';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

let fake: FakeApi;
let accounts: ReturnType<typeof installFakeAccounts>;
let stop: () => void;

function Probe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings" element={<CloudSyncSettings />} />
            <Route path="/account" element={<Account />} />
            <Route path="/account/connect" element={<AccountConnect />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const form = (n: string): InvoiceFormData => ({
  invoiceNumber: n,
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
});

beforeEach(() => {
  localStorage.clear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useClientStore.setState({ clients: [] });
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
  useAccountStore.setState({ linked: null });
  setAccountCsrfToken(null);
  fake = createFakeApi();
  accounts = installFakeAccounts(fake);
  vi.stubGlobal('fetch', fake.fetch);
  stop = startCloudSync();
});
afterEach(async () => {
  await whenIdle().catch(() => undefined);
  stop();
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings → Cloud sync & agents', () => {
  it('shows no account UI when accounts are disabled (and makes no other account calls)', async () => {
    accounts.acc.enabled = false;
    renderAt('/settings');
    expect(await screen.findByRole('button', { name: /turn on cloud sync/i })).toBeInTheDocument();
    await waitFor(() => expect(accounts.acc.calls).toEqual(['GET /config']));
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/use an account/i)).not.toBeInTheDocument();
  });

  it('offers sign-in / sign-up and sends the browser to AuthKit with a safe return path', async () => {
    const assign = vi.spyOn(accountNav, 'assign').mockImplementation(() => undefined);
    renderAt('/settings');
    await userEvent.click(await screen.findByRole('button', { name: /create account/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.example/authorize?state=s'));
    expect(accounts.acc.startBodies[0]).toEqual({ intent: 'sign-up', returnTo: '/?tab=settings' });
    // Anonymous cloud sync is still available next to it.
    expect(screen.getByRole('button', { name: /turn on cloud sync/i })).toBeInTheDocument();
  });

  it('hides anonymous "Turn on cloud sync" when the site requires an account', async () => {
    accounts.acc.required = true;
    renderAt('/settings');
    expect(await screen.findByText('Sign in to turn on cloud sync')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /turn on cloud sync/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect existing workspace/i })).toBeInTheDocument();
  });

  it('replaces the recovery key panel with the account panel for a signed-in device', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    useAccountStore.setState({ linked: { userId: 'u', email: 'alice@example.com', deviceId: 'device-1', workspaceId: 'ws-1' } });
    renderAt('/settings');
    expect(await screen.findByText('Your account')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show recovery key/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect this browser/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage account/i })).toHaveAttribute('href', '/account');
  });

  it('offers to attach an anonymous workspace to an account', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    renderAt('/settings');
    expect(await screen.findByText('Keep this workspace with an account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show recovery key/i })).toBeInTheDocument();
  });
});

describe('/account/connect (after the AuthKit callback)', () => {
  it('asks before uploading local-only invoices, then merges them into the account workspace', async () => {
    useInvoiceStore.getState().saveInvoice(form('INV-0007'), '00000000-0000-4000-8000-000000000007');
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    renderAt('/account/connect?return_to=%2Fagents');
    const dialog = await screen.findByRole('alertdialog', { name: /add this browser’s invoices to your account/i });
    expect(within(dialog).getByText(/1 invoice not yet in your account/)).toBeInTheDocument();
    expect(fake.writes()).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: /upload and merge/i }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/agents');
    await whenIdle();
    expect(fake.server.all().map((i) => i.invoiceNumber)).toEqual(['INV-0007']);
    expect(useAccountStore.getState().linked?.email).toBe('alice@example.com');
  });

  it('cancel signs out and changes nothing in this browser', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: { id: 'ws-other', createdAt: '2026-11-01T00:00:00.000Z' }, token: FAKE_TOKEN, status: 'idle' });
    useInvoiceStore.getState().saveInvoice(form('INV-0008'), '00000000-0000-4000-8000-000000000008');
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    renderAt('/account/connect?return_to=%2F%3Ftab%3Dsettings');
    const dialog = await screen.findByRole('alertdialog', { name: /different workspace/i });
    expect(within(dialog).getByText(/not changed or merged on the server/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel and sign out/i }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/?tab=settings');
    expect(accounts.acc.calls).toContain('POST /sign-out');
    expect(useCloudStore.getState()).toMatchObject({ token: FAKE_TOKEN, workspace: { id: 'ws-other' } });
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
    expect(fake.writes().filter((w) => !w.startsWith('POST /api/account'))).toEqual([]);
  });

  it('claims an anonymous workspace without asking', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    accounts.signIn('alice@example.com', null);
    renderAt('/account/connect?return_to=%2Faccount');
    await waitFor(() => expect(useAccountStore.getState().linked?.workspaceId).toBe('ws-1'));
    expect(useCloudStore.getState().token).toMatch(/^mi_ws_device/);
    expect(accounts.acc.calls).toContain('POST /workspace/claim');
  });

  it('explains sign-in errors (unverified email) and never shows the raw code only', async () => {
    renderAt('/account/connect?error=email_not_verified');
    expect(await screen.findByText(/verify your email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });
});

describe('/account', () => {
  it('shows the account, devices with revoke, recovery key rotation and account deletion', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
    accounts.signIn('alice@example.com', null);
    accounts.acc.workspace = { ...fake.state.workspace, recoveryKeyEnabled: true };
    accounts.acc.devices = [
      { id: 'device-1', label: 'Firefox on macOS', createdAt: Date.parse('2026-11-10T10:00:00Z'), lastSeenAt: null, signedIn: true, current: true },
      { id: 'device-2', label: 'Safari on iOS', createdAt: Date.parse('2026-11-12T10:00:00Z'), lastSeenAt: null, signedIn: true, current: false },
    ];
    accounts.acc.sessionDeviceId = 'device-1';
    useAccountStore.setState({ linked: { userId: 'user-alice@example.com', email: 'alice@example.com', deviceId: 'device-1', workspaceId: 'ws-1' } });
    renderAt('/account');
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('This browser syncs with your account.')).toBeInTheDocument();
    const devices = await screen.findByRole('list', { name: /signed-in devices/i });
    expect(within(devices).getAllByRole('listitem')).toHaveLength(2);

    // Revoke the other device.
    const ios = within(devices).getByText('Safari on iOS').closest('li')!;
    await userEvent.click(within(ios).getByRole('button', { name: /revoke/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^revoke$/i }));
    await waitFor(() => expect(accounts.acc.calls).toContain('DELETE /devices/device-2'));
    await waitFor(() => expect(within(screen.getByRole('list', { name: /signed-in devices/i })).getAllByRole('listitem')).toHaveLength(1));

    // Rotate the recovery key: shown once.
    await userEvent.click(screen.getByRole('button', { name: /rotate recovery key/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^rotate$/i }));
    expect(await screen.findByDisplayValue(/^mi_ws_recovery/)).toBeInTheDocument();

    // Delete the account, keeping the workspace: this browser continues with the new recovery key.
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }));
    const confirm = await screen.findByRole('alertdialog', { name: /delete your account/i });
    const submit = within(confirm).getByRole('button', { name: /delete account/i });
    expect(submit).toBeDisabled();
    await userEvent.type(within(confirm).getByLabelText(/type your email/i), 'alice@example.com');
    await userEvent.click(submit);
    expect(await screen.findByTestId('location')).toHaveTextContent('/?tab=settings');
    expect(useCloudStore.getState().token).toMatch(/^mi_ws_kept/);
    expect(useAccountStore.getState().linked).toBeNull();
  }, 30_000);

  it('asks to sign in when there is no session', async () => {
    renderAt('/account');
    expect(await screen.findByText('You are not signed in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });
});
