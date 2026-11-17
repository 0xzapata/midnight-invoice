import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { sentenceOf, describeEntry } from '@/components/activity/describe';
import { ActivityTimeline } from '@/components/activity/ActivityTimeline';
import type { ActivityEntry } from '../../shared/activity';
import type { Invoice } from '@/types/invoice';
import ApproveAgent from '@/pages/ApproveAgent';
import AuthorizeAgent from '@/pages/oauth/AuthorizeAgent';
import ViewInvoice from '@/pages/ViewInvoice';
import Index from '@/pages/Index';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: vi.fn() },
  Font: { register: vi.fn() },
}));

let fake: FakeApi;
const lastOf = <T,>(items: T[]): T => items[items.length - 1];
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Probe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
  useTemplateStore.setState({ templates: [], _hasHydrated: true });
});
afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe('consent screens', () => {
  const NOTE = 'It can never turn on automatic emailing to your clients: only you can, in the app.';

  it('device flow: describes the recurring scopes and that only the user can enable auto-email', async () => {
    fake.use((req) =>
      req.path.startsWith('/agents/registrations/') && req.method === 'GET'
        ? fake.json(200, {
            registration: {
              id: 'reg-1',
              userCode: 'WDJB-MJHT',
              name: 'Billing helper',
              description: null,
              requestedScopes: ['recurring:read', 'recurring:write'],
              createdAt: new Date(Date.now() - 60_000).toISOString(),
              expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
            },
          })
        : undefined,
    );
    render(
      <QueryClientProvider client={client()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/agents/approve?code=WDJB-MJHT']}>
            <Routes>
              <Route path="/agents/approve" element={<ApproveAgent />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const group = await screen.findByRole('group', { name: 'Permissions requested' });
    expect(within(group).getByRole('checkbox', { name: /View your recurring invoices/ })).toBeChecked();
    const write = within(group).getByRole('checkbox', { name: /Set up and manage recurring invoices/ });
    expect(write).toBeChecked();
    expect(write).toHaveAccessibleDescription(expect.stringContaining(NOTE));
  });

  it('OAuth: the same wording', async () => {
    const ID = 'Tm'.repeat(22);
    fake.use((req) =>
      req.path.startsWith('/oauth/requests/') && req.method === 'GET'
        ? fake.json(200, {
            request: {
              id: ID,
              client: { kind: 'dcr', name: 'Desktop client', metadataHost: null, clientUri: null },
              redirect: { uri: 'http://127.0.0.1:53682/callback', kind: 'loopback', display: '127.0.0.1:53682' },
              requestedScopes: ['recurring:read', 'recurring:write'],
              scopesDefaulted: false,
              existingAgent: null,
              createdAt: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
            },
          })
        : undefined,
    );
    render(
      <QueryClientProvider client={client()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/agents/authorize?request=${ID}`]}>
            <Routes>
              <Route path="/agents/authorize" element={<AuthorizeAgent />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const group = await screen.findByRole('group', { name: /Permissions/ });
    expect(group).toHaveTextContent('Set up and manage recurring invoices');
    expect(group).toHaveTextContent(NOTE);
  });
});

describe('activity sentences', () => {
  const base = { time: '2026-12-01T00:30:00.000Z', source: 'system' as const, tool: null, requestId: null };
  const entry = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry =>
    ({ id: `act_${Math.random()}`, actor: { type: 'user' }, entity: { type: 'recurring', id: 'r1', label: 'Globex retainer' }, changes: null, ...base, ...e }) as ActivityEntry;

  it('describes schedule changes, generated invoices and failures', () => {
    expect(sentenceOf(entry({ action: 'recurring.created' }))).toBe('You set up the recurring invoice Globex retainer');
    const updated = describeEntry(entry({ action: 'recurring.updated', changes: { fields: ['frequency', 'startDate', 'overrides'] } }));
    expect(updated.details).toEqual(['Changed how often, start date and notes / tax rate overrides']);
    expect(sentenceOf(entry({ action: 'recurring.paused', actor: { type: 'agent', agentId: 'a1', agentName: 'Billing helper' } }))).toBe('Billing helper paused the recurring invoice Globex retainer');
    const resumed = describeEntry(entry({ action: 'recurring.resumed', changes: { skipped: 2 } }));
    expect(resumed.details).toEqual(['2 missed dates skipped (only the most recent one is created)']);
    expect(sentenceOf(entry({ action: 'recurring.ended', actor: { type: 'system' } }))).toBe('System ended the recurring invoice Globex retainer: no dates left');
    expect(sentenceOf(entry({ action: 'recurring.deleted' }))).toBe('You deleted the recurring invoice Globex retainer');
    const failed = describeEntry(entry({ action: 'recurring.run_failed', actor: { type: 'system' }, changes: { reason: 'template_deleted', period: '2026-12-01', counts: { attempts: 3 } } }));
    expect(failed.details).toEqual(['Because its template was deleted', 'For the date 2026-12-01', 'Tried 3 times']);
    const generated = entry({
      action: 'invoice.created',
      actor: { type: 'system' },
      entity: { type: 'invoice', id: 'i1', label: 'INV-0042' },
      changes: { template: { id: 't1', label: 'Monthly retainer' }, recurring: { id: 'r1', label: 'Globex retainer' }, trigger: 'schedule', skipped: 1 },
    });
    expect(sentenceOf(generated)).toBe('System created INV-0042 from the template “Monthly retainer” for the recurring invoice “Globex retainer”');
    expect(describeEntry(generated).details).toEqual(['1 missed date skipped (only the most recent one is created)']);
  });

  it('links schedule entries to /recurring and generated invoices to the invoice', () => {
    useInvoiceStore.setState({ invoices: [{ id: 'i1', invoiceNumber: 'INV-0042' } as Invoice] });
    render(
      <MemoryRouter>
        <ActivityTimeline
          entries={[
            entry({ action: 'recurring.paused' }),
            entry({ action: 'invoice.created', actor: { type: 'system' }, entity: { type: 'invoice', id: 'i1', label: 'INV-0042' }, changes: { recurring: { id: 'r1', label: 'Globex retainer' } } }),
            entry({ action: 'recurring.deleted', entity: { type: 'recurring', id: 'r2', label: 'Old schedule' } }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Globex retainer' })).toHaveAttribute('href', '/recurring');
    expect(screen.getByRole('link', { name: 'INV-0042' })).toHaveAttribute('href', '/invoice/i1');
    expect(screen.queryByRole('link', { name: 'Old schedule' })).not.toBeInTheDocument();
  });
});

describe('"Make recurring" from an invoice', () => {
  const INVOICE = {
    id: '00000000-0000-4000-8000-0000000000e1',
    invoiceNumber: 'INV-0003',
    invoiceName: 'Website care',
    issueDate: '2026-11-01',
    dueDate: '2026-11-15',
    createdAt: '2026-11-01T10:00:00.000Z',
    currency: 'USD',
    taxRate: 10,
    lineItems: [{ id: 'l1', description: 'Care plan', quantity: 1, price: 300 }],
    fromName: 'Me',
    fromEmail: '',
    fromAddress: '',
    toName: 'Globex',
    toEmail: '',
    toAddress: '',
    notes: 'Thanks',
    paymentDetails: '',
    clientId: '00000000-0000-4000-8000-0000000000c1',
  } as Invoice;

  const renderInvoice = (invoice: Invoice) => {
    useInvoiceStore.setState({ invoices: [invoice], drafts: {} });
    return render(
      <QueryClientProvider client={client()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/invoice/${invoice.id}`]}>
            <Routes>
              <Route path="/invoice/:id" element={<ViewInvoice />} />
              <Route path="*" element={<Probe />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  };

  it('asks to save the invoice as a template first, then opens the schedule dialog for it', async () => {
    const user = userEvent.setup({ delay: null });
    renderInvoice(INVOICE);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    // The labelled header button (lg+) and the "More actions" menu item: use the menu.
    await user.click(lastOf(screen.getAllByRole('button', { name: 'Make recurring' })));
    const confirm = await screen.findByRole('alertdialog', { name: 'Save this invoice as a template first?' });
    expect(confirm).toHaveTextContent('“Website care” will be saved as a template');
    await user.click(within(confirm).getByRole('button', { name: 'Save template and continue' }));
    const [template] = useTemplateStore.getState().templates;
    expect(template).toMatchObject({ name: 'Website care', clientId: INVOICE.clientId, paymentTermsDays: 14, lineItems: [expect.objectContaining({ description: 'Care plan', price: 300 })] });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/recurring?template=${template.id}&client=${INVOICE.clientId}`));
  });

  it('goes straight to the dialog when the invoice came from a template; generated invoices show where they came from', async () => {
    const user = userEvent.setup({ delay: null });
    const t = useTemplateStore.getState().saveTemplate({ name: 'Care', description: '', clientId: null, lineItems: [], taxRate: null, currency: null, notes: '', paymentDetails: '', paymentTermsDays: null, invoiceNamePattern: '' });
    const { unmount } = renderInvoice({ ...INVOICE, templateId: t.id });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    // The labelled header button (lg+) and the "More actions" menu item: use the menu.
    await user.click(lastOf(screen.getAllByRole('button', { name: 'Make recurring' })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/recurring?template=${t.id}&client=${INVOICE.clientId}`));
    unmount();

    renderInvoice({ ...INVOICE, templateId: t.id, recurringId: 'r1', createdBy: { type: 'system', recurringId: 'r1', recurringName: 'Globex care' } });
    expect(screen.getByTestId('recurring-origin')).toHaveTextContent('Created automatically by the recurring schedule “Globex care” from the template “Care”.');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryAllByRole('button', { name: 'Make recurring' })).toHaveLength(0);
  });
});

describe('Coming Soon tab', () => {
  it('lists only what is still to come (recurring invoices, email and accounts are delivered)', () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
    render(
      <QueryClientProvider client={client()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/?tab=coming']}>
            <Routes>
              <Route path="/" element={<Index />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Coming Soon' })).toBeInTheDocument();
    expect(screen.getByText('File Attachments')).toBeInTheDocument();
    for (const gone of ['Recurring Invoices', 'Email Sending', 'User Authentication']) expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });
});
