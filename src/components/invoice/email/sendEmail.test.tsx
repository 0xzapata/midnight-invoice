import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { toast } from 'sonner';
import ViewInvoice from '@/pages/ViewInvoice';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useCloudStore } from '@/stores/useCloudStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { SCOPE_INFO } from '@/components/agents/scopes';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import type { Invoice } from '@/types/invoice';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = '6d0c3a52-5d0b-4b8e-9f0e-1c2d3e4f5a6b';
let fake: FakeApi;

function serverInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return fake.server.create(
    ID,
    {
      invoiceNumber: 'INV-0042',
      fromName: 'Midnight Studio',
      fromEmail: 'studio@midnight-studio.io',
      toName: 'Acme Corp',
      toEmail: 'billing@acme-client.io',
      dueDate: '2026-12-01',
      lineItems: [{ id: 'li-1', description: 'Design', quantity: 2, price: 150 }],
      taxRate: 0,
      currency: 'USD',
      ...overrides,
    } as never,
    { type: 'user' },
  );
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/invoice/${ID}`]}>
        <Routes>
          <Route path="/invoice/:id" element={<ViewInvoice />} />
          <Route path="/" element={<p>Settings tab</p>} />
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
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, fromEmail: 'me@midnight-studio.io' } }));
  vi.mocked(toast.success).mockClear();
});

afterEach(async () => {
  await whenIdle();
  vi.unstubAllGlobals();
});

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Send by email' }));
  return screen.findByRole('dialog', { name: /send invoice by email/i });
}

describe('Send by email', () => {
  it('explains that cloud sync is needed when it is off, and links to the settings', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
    const local = { ...serverInvoice() };
    delete local.revision;
    useInvoiceStore.setState({ invoices: [local], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const dialog = await openDialog(user);
    expect(within(dialog).getByText('Email sending needs cloud sync')).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.path.includes('/send'))).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Turn on cloud sync' }));
    expect(await screen.findByText('Settings tab')).toBeInTheDocument();
  });

  it('waits for an invoice whose latest changes are not uploaded yet', async () => {
    const local = { ...serverInvoice() };
    delete local.revision;
    useInvoiceStore.setState({ invoices: [local], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const dialog = await openDialog(user);
    expect(within(dialog).getByText('Waiting for sync')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('prefills the recipient, subject and message, previews the email, notes the draft → sent change, and sends', async () => {
    const inv = serverInvoice();
    useInvoiceStore.setState({ invoices: [inv], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const dialog = await openDialog(user);
    const to = await within(dialog).findByLabelText('To');
    expect(to).toHaveValue('billing@acme-client.io');
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('Invoice INV-0042 from Midnight Studio');
    expect((within(dialog).getByLabelText('Message') as HTMLTextAreaElement).value).toContain('Please find attached invoice INV-0042 for $300.00, due Dec 1, 2026.');
    expect(within(dialog).getByText(/This invoice is a draft\./)).toBeInTheDocument();

    await user.click(within(dialog).getByText('Preview what your client receives'));
    expect(within(dialog).getByText('"Midnight Studio via Midnight Invoice" <invoices@mail.midnight.app>')).toBeInTheDocument();
    expect(within(dialog).getByText(/Amount due: \$300\.00/)).toBeInTheDocument();

    await user.click(within(dialog).getByLabelText(/Send me a copy/));
    await user.click(within(dialog).getByRole('button', { name: 'Send and mark sent' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('INV-0042 sent to billing@acme-client.io', { description: 'The invoice is now marked as sent.' }));
    const sent = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/send'))!;
    expect(sent.body).toEqual({ ccMe: true });
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(useInvoiceStore.getState().invoices[0].status).toBe('sent'));
    // The history appears under the status bar.
    expect(await screen.findByText(/^Sent to/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Email history' })).toHaveTextContent('billing@acme-client.io');
  });

  it('sends a custom subject/message and a changed recipient only when edited', async () => {
    const inv = serverInvoice({ status: 'sent', sentAt: '2026-11-10' } as Partial<Invoice>);
    useInvoiceStore.setState({ invoices: [inv], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const dialog = await openDialog(user);
    const to = await within(dialog).findByLabelText('To');
    await user.clear(to);
    await user.type(to, 'nope');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByText('Enter a deliverable email address.')).toBeInTheDocument();
    await user.clear(to);
    await user.type(to, 'ap@acme-client.io');
    const subject = within(dialog).getByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Reminder: INV-0042');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const sent = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/send'))!;
    expect(sent.body).toEqual({ to: 'ap@acme-client.io', subject: 'Reminder: INV-0042' });
  });

  it('explains when the server has no email provider', async () => {
    fake.state.email.configured = false;
    useInvoiceStore.setState({ invoices: [serverInvoice()], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('Email isn’t set up on this server')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Send/ })).not.toBeInTheDocument();
  });

  it('shows failures in the history with the reason and a retry', async () => {
    const inv = serverInvoice();
    fake.server.emails.set(ID, [
      {
        id: 'e1',
        invoiceId: ID,
        to: 'billing@acme-client.io',
        cc: [],
        subject: 'Invoice INV-0042',
        status: 'failed',
        error: { code: 'provider_rejected', message: 'The email provider refused the message: domain not verified' },
        sentBy: { type: 'agent', agentId: 'a1', agentName: 'Claude Desktop' },
        statusChanged: false,
        createdAt: '2026-11-17T09:30:00.000Z',
        sentAt: null,
      },
    ]);
    useInvoiceStore.setState({ invoices: [inv], _hasHydrated: true });
    const user = userEvent.setup();
    renderView();
    const history = await screen.findByRole('region', { name: 'Email history' });
    expect(history).toHaveTextContent('Not sent');
    expect(history).toHaveTextContent('the email provider refused the message');
    expect(history).toHaveTextContent('by Claude Desktop');
    await user.click(within(history).getByRole('button', { name: 'Retry sending' }));
    expect(await screen.findByRole('dialog', { name: /send invoice by email/i })).toBeInTheDocument();
  });

  it('is offered in the dashboard row menu', async () => {
    const inv = serverInvoice();
    useInvoiceStore.setState({ invoices: [inv], _hasHydrated: true });
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <InvoiceList invoices={[inv]} onView={() => {}} onLoadSession={() => {}} onDuplicate={() => {}} onDelete={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Change status of INV-0042' }));
    await user.click(await screen.findByRole('button', { name: 'Send by email…' }));
    const dialog = await screen.findByRole('dialog', { name: /send invoice by email/i });
    expect(await within(dialog).findByLabelText('To')).toHaveValue('billing@acme-client.io');
  });
});

describe('invoices:send on consent screens', () => {
  it('is described plainly and marked sensitive', () => {
    expect(SCOPE_INFO['invoices:send']).toMatchObject({ sensitive: true, sensitiveLabel: 'Sends email' });
    expect(SCOPE_INFO['invoices:send'].allows).toMatch(/can email invoices to your clients on your behalf/i);
  });
});
