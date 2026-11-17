import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fill } from '@/test/userInput';
import { useCloudStore } from '@/stores/useCloudStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { enqueueUpsert, resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { installFakeRecurring } from '@/test/fakeRecurring';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { InvoiceTemplate } from '../../shared/types/template';
import type { Client } from '../../shared/types/client';
import type { Invoice } from '@/types/invoice';
import { toast } from 'sonner';
import Recurring from './Recurring';
import Templates from './Templates';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const T1 = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const TEMPLATE: InvoiceTemplate = {
  id: T1,
  name: 'Monthly retainer',
  description: '',
  clientId: C1,
  lineItems: [{ id: 'l1', description: 'Retainer {{month_name}} {{year}}', quantity: 1, price: 2000 }],
  taxRate: null,
  currency: null,
  notes: '',
  paymentDetails: '',
  paymentTermsDays: 14,
  invoiceNamePattern: 'Retainer {{month_name}}',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archivedAt: null,
  revision: 1,
};
const GLOBEX = { id: C1, name: 'Globex', email: 'ap@globex.example', address: '', defaultCurrency: 'EUR', defaultTaxRate: null, paymentTermsDays: null, notes: '', createdAt: '', updatedAt: '', archivedAt: null, revision: 1 } as Client;
const INITECH = { ...GLOBEX, id: C2, name: 'Initech', defaultCurrency: null } as Client;

let fake: FakeApi;
let recurring: ReturnType<typeof installFakeRecurring>;

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
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T10:00:00.000Z'));
  localStorage.clear();
  fake = createFakeApi();
  recurring = installFakeRecurring(fake, { today: '2026-11-17' });
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled' });
  useTemplateStore.setState({ templates: [TEMPLATE], _hasHydrated: true });
  useClientStore.setState({ clients: [GLOBEX, INITECH], _hasHydrated: true });
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, fromName: 'Ada Ltd', currency: 'USD', taxRate: 10 } });
  fake.server.createTemplate(T1, { ...TEMPLATE }, { type: 'user' });
  fake.server.createClient(C1, { name: 'Globex' }, { type: 'user' });
  fake.server.createClient(C2, { name: 'Initech' }, { type: 'user' });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Recurring page', () => {
  it('explains that recurring invoices need cloud sync and makes no request while it is off', async () => {
    renderAt('/recurring');
    expect(screen.getByText(/need cloud sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turn on cloud sync/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New schedule/ })).not.toBeInTheDocument();
    // "Make recurring" links land here too, still without requests.
    await new Promise((r) => setTimeout(r, 20));
    // Only the public "are accounts on" flag of the sign-in card (no token, no workspace data).
    expect(fake.requests.filter((r) => r.path !== '/api/account/config')).toEqual([]);
    expect(fake.requests.every((r) => !r.headers.authorization)).toBe(true);
  });

  it('sets up a monthly schedule with a plain-language summary, upcoming dates and a preview of the next invoice', async () => {
    connect();
    const user = userEvent.setup({ delay: null });
    renderAt('/recurring');
    await user.click(await screen.findByRole('button', { name: 'Set up a recurring invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'New recurring invoice' });

    // Required fields first.
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(within(dialog).getByText('Give the schedule a name')).toBeInTheDocument();
    expect(within(dialog).getByText('Pick the template the invoices are made from')).toBeInTheDocument();

    await fill(user, within(dialog).getByLabelText('Schedule name'), 'Globex retainer');
    await user.selectOptions(within(dialog).getByLabelText('Template'), 'Monthly retainer');
    await user.selectOptions(within(dialog).getByLabelText('Time zone'), 'Europe/Berlin');
    fireEvent.change(within(dialog).getByLabelText('First invoice on'), { target: { value: '2026-12-01' } });
    expect(within(dialog).getByTestId('recurring-summary')).toHaveTextContent('Every month on the 1st, starting 1 Dec 2026 — next: 1 Dec 2026');
    const upcoming = within(dialog).getByRole('list', { name: 'Upcoming run dates' });
    expect(within(upcoming).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 Dec 2026', '1 Jan 2027', '1 Feb 2027', '1 Mar 2027', '1 Apr 2027', '1 May 2027']);
    const preview = within(dialog).getByLabelText('Next invoice preview');
    expect(preview).toHaveTextContent('Retainer December');
    expect(preview).toHaveTextContent('Retainer December 2026');
    expect(preview).toHaveTextContent('due 15 Dec 2026');
    expect(preview).toHaveTextContent('bill to Globex');
    expect(preview).toHaveTextContent('€2,200.00'); // client currency, settings tax 10%

    // Other cadences and end conditions update the sentence live.
    await user.selectOptions(within(dialog).getByLabelText('How often'), 'Every 3 months');
    fireEvent.change(within(dialog).getByLabelText('First invoice on'), { target: { value: '2027-01-31' } });
    await user.click(within(dialog).getByLabelText('After'));
    await fill(user, within(dialog).getByLabelText('Number of invoices'), '');
    fireEvent.change(within(dialog).getByLabelText('Number of invoices'), { target: { value: '4' } });
    expect(within(dialog).getByTestId('recurring-summary')).toHaveTextContent(
      'Every 3 months on the 31st (the last day in shorter months) (Jan, Apr, Jul, Oct), starting 31 Jan 2027, 4 times — next: 31 Jan 2027',
    );
    expect(within(within(dialog).getByRole('list', { name: 'Upcoming run dates' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '31 Jan 2027',
      '30 Apr 2027',
      '31 Jul 2027',
      '31 Oct 2027',
    ]);
    await user.selectOptions(within(dialog).getByLabelText('How often'), 'Every month');
    fireEvent.change(within(dialog).getByLabelText('First invoice on'), { target: { value: '2026-12-01' } });
    await user.click(within(dialog).getByLabelText('Never'));
    await user.selectOptions(within(dialog).getByLabelText('Bill to'), 'Initech');
    expect(within(dialog).getByLabelText('Next invoice preview')).toHaveTextContent('bill to Initech');

    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = fake.requests.find((r) => r.method === 'POST' && r.path === '/recurring')!;
    expect(post.body).toEqual({
      name: 'Globex retainer',
      templateId: T1,
      clientId: C2,
      frequency: 'monthly',
      startDate: '2026-12-01',
      timezone: 'Europe/Berlin',
      endDate: null,
      maxOccurrences: null,
      autoAction: 'draft',
      overrides: { notes: null, taxRate: null },
    });
    const row = await screen.findByTestId('recurring-row');
    expect(row).toHaveTextContent('Globex retainer');
    expect(row).toHaveTextContent('Every month on the 1st, starting 1 Dec 2026');
    expect(row).toHaveTextContent('Next:1 Dec 2026');
    expect(row).toHaveTextContent('Initech');
  }, 20_000);

  it('lists schedules with their last result, surfaces errors, and pauses, resumes, runs now and deletes', async () => {
    connect();
    const s = recurring.add(
      { name: 'Globex retainer', templateId: T1, frequency: 'monthly', startDate: '2026-12-01', timezone: 'UTC' },
      { lastError: { code: 'template_deleted', message: 'The template of this schedule was deleted. Pick another template.', at: '2026-12-01T00:30:00.000Z', period: '2026-12-01', attempts: 2 }, retryAt: '2026-12-01T02:30:00.000Z' },
    );
    const user = userEvent.setup({ delay: null });
    renderAt('/recurring');
    const row = await screen.findByTestId('recurring-row');
    const alert = within(row).getByRole('alert');
    expect(alert).toHaveTextContent('Could not create the invoice for 1 Dec 2026');
    expect(alert).toHaveTextContent('The template of this schedule was deleted. Pick another template.');
    expect(alert).toHaveTextContent('Tried 2 times');

    await user.click(within(row).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(within(screen.getByTestId('recurring-row')).getByRole('button', { name: 'Resume' })).toBeInTheDocument());
    expect(fake.writes()).toContain(`POST /recurring/${s.id}/pause`);
    await user.click(within(screen.getByTestId('recurring-row')).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(within(screen.getByTestId('recurring-row')).getByRole('button', { name: `Run ${s.name} now` })).toBeInTheDocument());

    await user.click(within(screen.getByTestId('recurring-row')).getByRole('button', { name: `Run ${s.name} now` }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Create the 1 Dec 2026 invoice now?' });
    await user.click(within(confirm).getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Created INV-0001', expect.anything()));
    expect(fake.requests.find((r) => r.path === `/recurring/${s.id}/run-now`)!.body).toEqual({ period: '2026-12-01' });
    await waitFor(() => expect(screen.getByTestId('recurring-row')).toHaveTextContent('Next:1 Jan 2027'));
    // The generated invoice reaches this browser through the normal invoice sync.
    await waitFor(() => expect(useInvoiceStore.getState().invoices.map((i) => i.recurringId)).toEqual([s.id]));
    await waitFor(() => expect(screen.getByTestId('recurring-row')).toHaveTextContent('INV-0001 for 1 Dec 2026 · 1 so far'));

    await user.click(within(screen.getByTestId('recurring-row')).getByRole('button', { name: `Delete ${s.name}` }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete schedule' }));
    await waitFor(() => expect(screen.getByText('No recurring invoices yet')).toBeInTheDocument());
  }, 20_000);

  it('"Make recurring" from a template opens the dialog prefilled', async () => {
    connect();
    const user = userEvent.setup({ delay: null });
    renderAt('/templates');
    await user.click(screen.getByRole('link', { name: 'Make Monthly retainer recurring' }));
    const dialog = await screen.findByRole('dialog', { name: 'New recurring invoice' });
    expect(within(dialog).getByLabelText('Template')).toHaveValue(T1);
    expect(within(dialog).getByLabelText('Schedule name')).toHaveValue('Monthly retainer – monthly');
    expect(within(dialog).getByLabelText('Bill to')).toHaveValue('');
    expect(within(dialog).getByRole('option', { name: 'The template’s client (Globex)' })).toBeInTheDocument();
  });

  it('a template that has not been uploaded yet is synced before the schedule is created', async () => {
    connect();
    const local = { ...TEMPLATE, id: '00000000-0000-4000-8000-0000000000a9', name: 'Fresh template', revision: undefined };
    useTemplateStore.setState({ templates: [TEMPLATE, local] });
    enqueueUpsert('templates', local.id);
    const user = userEvent.setup({ delay: null });
    renderAt(`/recurring?template=${local.id}&client=${C1}`);
    const dialog = await screen.findByRole('dialog', { name: 'New recurring invoice' });
    expect(within(dialog).getByLabelText('Bill to')).toHaveValue(C1);
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const order = fake.writes();
    expect(order.indexOf(`PUT /templates/${local.id}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`PUT /templates/${local.id}`)).toBeLessThan(order.indexOf('POST /recurring'));
  });

  it('shows invoices a schedule generated with a Recurring badge', async () => {
    const { InvoiceList } = await import('@/components/invoice/InvoiceList');
    const inv = {
      id: 'i1',
      invoiceNumber: 'INV-0009',
      issueDate: '2026-12-01',
      createdAt: '2026-12-01T00:30:00.000Z',
      lineItems: [],
      taxRate: 0,
      currency: 'USD',
      toName: 'Globex',
      recurringId: 'r1',
      createdBy: { type: 'system', recurringId: 'r1', recurringName: 'Globex retainer' },
    } as unknown as Invoice;
    render(
      <MemoryRouter>
        <TooltipProvider>
          <InvoiceList invoices={[inv]} onView={vi.fn()} onLoadSession={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const badge = screen.getByRole('link', { name: 'Recurring: created by the schedule Globex retainer' });
    expect(badge).toHaveAttribute('href', '/recurring');
  });
});
