import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fill } from '@/test/userInput';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Invoice } from '@/types/invoice';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import Clients from './Clients';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: crypto.randomUUID(),
  invoiceNumber: 'INV-0001',
  issueDate: '2026-11-01',
  fromName: 'Ada',
  fromAddress: '',
  fromEmail: '',
  toName: '',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 1 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/clients']}>
        <Routes>
          <Route path="/clients" element={<Clients />} />
          <Route path="/create/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useClientStore.setState({ clients: [], _hasHydrated: true });
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
});

afterEach(() => vi.clearAllMocks());

describe('Clients page', () => {
  it('shows an empty state and adds a client with validation', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    expect(screen.getByText('No saved clients yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add your first client' }));
    const dialog = await screen.findByRole('dialog', { name: 'New client' });
    await fill(user, within(dialog).getByLabelText('Email'), 'not-an-email');
    await user.type(within(dialog).getByLabelText('Payment terms (days)'), '1.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save client' }));
    expect(within(dialog).getByText('Client name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Invalid email format')).toBeInTheDocument();
    expect(within(dialog).getByText(/Whole days/)).toBeInTheDocument();
    expect(useClientStore.getState().clients).toEqual([]);

    await fill(user, within(dialog).getByLabelText('Name / Company'), 'Globex');
    await user.clear(within(dialog).getByLabelText('Email'));
    await fill(user, within(dialog).getByLabelText('Email'), 'ap@globex.example');
    await user.clear(within(dialog).getByLabelText('Payment terms (days)'));
    await user.type(within(dialog).getByLabelText('Payment terms (days)'), '30');
    await user.type(within(dialog).getByLabelText('Tax rate (%)'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useClientStore.getState().clients[0]).toMatchObject({ name: 'Globex', email: 'ap@globex.example', paymentTermsDays: 30, defaultTaxRate: 7, defaultCurrency: null });
    expect(screen.getByRole('heading', { name: 'Globex' })).toBeInTheDocument();
    expect(screen.getByText('Net 30')).toBeInTheDocument();
  });

  it('lists clients with invoice counts, searches, edits, archives and deletes with confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    const { saveClient } = useClientStore.getState();
    const globex = saveClient({ name: 'Globex', email: 'ap@globex.example', address: 'Springfield' });
    saveClient({ name: 'Initech', email: 'billing@initech.example', address: 'Austin' });
    useInvoiceStore.setState({
      invoices: [invoice({ clientId: globex.id, toName: 'Globex' }), invoice({ toName: 'GLOBEX', toEmail: 'ap@globex.example' }), invoice({ toName: 'Other' })],
    });
    renderPage();
    const globexRow = screen.getByRole('heading', { name: 'Globex' }).closest('li')!;
    expect(within(globexRow).getByText('2 invoices')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Initech' }).closest('li')!).getByText('No invoices yet')).toBeInTheDocument();

    await fill(user, screen.getByRole('searchbox', { name: 'Search clients' }), 'austin');
    expect(screen.queryByRole('heading', { name: 'Globex' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Initech' })).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search clients' }));

    await user.click(screen.getByRole('button', { name: 'Edit Globex' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit client' });
    expect(within(dialog).getByLabelText('Name / Company')).toHaveValue('Globex');
    await user.clear(within(dialog).getByLabelText('Name / Company'));
    await fill(user, within(dialog).getByLabelText('Name / Company'), 'Globex Corp');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Globex Corp' })).toBeInTheDocument());
    expect(useClientStore.getState().getClient(globex.id)?.createdAt).toBe(globex.createdAt);

    await user.click(screen.getByRole('button', { name: 'Archive Globex Corp' }));
    expect(screen.queryByRole('heading', { name: 'Globex Corp' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unarchive Globex Corp' }));
    expect(useClientStore.getState().getClient(globex.id)?.archivedAt).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete Globex Corp' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Its 1 invoice stay as they are');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(useClientStore.getState().getClient(globex.id)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete Globex Corp' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete client' }));
    expect(useClientStore.getState().getClient(globex.id)).toBeUndefined();
    // Invoices are untouched.
    expect(useInvoiceStore.getState().invoices).toHaveLength(3);
  });

  it('imports clients from existing invoices, deduplicated by name and email', async () => {
    const user = userEvent.setup({ delay: null });
    useInvoiceStore.setState({
      invoices: [
        invoice({ toName: 'Globex', toEmail: 'ap@globex.example', toAddress: 'Springfield' }),
        invoice({ toName: ' globex ', toEmail: 'AP@GLOBEX.EXAMPLE' }),
        invoice({ toName: 'Initech' }),
      ],
    });
    renderPage();
    expect(screen.getByText(/2 clients on your invoices are not saved yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 2' }));
    expect(useClientStore.getState().clients.map((c) => c.name).sort()).toEqual(['Globex', 'Initech']);
    expect(screen.queryByText(/Import clients from your invoices/)).not.toBeInTheDocument();
  });

  it('“New invoice” opens a draft billed to the client with its defaults', async () => {
    const user = userEvent.setup({ delay: null });
    const c = useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: 'Springfield', defaultCurrency: 'EUR', paymentTermsDays: 14 });
    useInvoiceStore.setState({ invoices: [invoice({ invoiceNumber: 'INV-0007' })] });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New invoice for Globex' }));
    const path = screen.getByTestId('location').textContent!;
    const id = path.replace('/create/', '');
    const draft = useInvoiceStore.getState().drafts[id];
    expect(draft).toMatchObject({ clientId: c.id, toName: 'Globex', toEmail: 'ap@globex.example', toAddress: 'Springfield', currency: 'EUR', invoiceNumber: 'INV-0008' });
    expect(draft.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
