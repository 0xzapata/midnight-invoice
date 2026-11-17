import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import type { InvoiceFormData } from '@/types/invoice';
import { useClientStore } from '@/stores/useClientStore';
import { clientFillPatch, billToState } from './clientFill';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

let latest: InvoiceFormData;
function Harness({ initialData }: { initialData?: Partial<InvoiceFormData> }) {
  const [, setData] = useState<InvoiceFormData>();
  return (
    <MemoryRouter>
      <InvoiceForm
        invoiceNumber="INV-0001"
        initialData={initialData}
        onFormChange={(d) => {
          latest = d;
          setData(d);
        }}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  // cmdk constructs a ResizeObserver; the shared setup's mock is not constructible.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  useClientStore.setState({ clients: [] });
});

const GLOBEX = { name: 'Globex', email: 'ap@globex.example', address: '1 Globex Way', defaultCurrency: 'EUR', defaultTaxRate: 7, paymentTermsDays: 30 };

async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: /saved client/i }));
  await user.type(await screen.findByPlaceholderText('Search clients…'), name.slice(0, 3));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('client picker in the invoice form', () => {
  it('fills Bill To and the client’s defaults on a fresh form', async () => {
    const user = userEvent.setup();
    const c = useClientStore.getState().saveClient(GLOBEX);
    render(<Harness initialData={{ issueDate: '2026-11-01' }} />);
    await pick(user, 'Globex');
    await waitFor(() => expect(latest).toMatchObject({ clientId: c.id, toName: 'Globex', toEmail: 'ap@globex.example', toAddress: '1 Globex Way', currency: 'EUR', taxRate: 7, dueDate: '2026-12-01' }));
    expect(screen.getByText('Billed to your saved client “Globex”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved client: Globex. Change client' })).toBeInTheDocument();
  });

  it('never clobbers tax rate or due date the user already typed', async () => {
    const user = userEvent.setup();
    useClientStore.getState().saveClient(GLOBEX);
    render(<Harness initialData={{ issueDate: '2026-11-01' }} />);
    await user.clear(screen.getByLabelText('Tax Rate (%)'));
    await user.type(screen.getByLabelText('Tax Rate (%)'), '20');
    await user.type(screen.getByLabelText('Due Date (optional)'), '2026-11-20');
    await pick(user, 'Globex');
    await waitFor(() => expect(latest.toName).toBe('Globex'));
    expect(latest).toMatchObject({ taxRate: 20, dueDate: '2026-11-20', currency: 'EUR' });
  });

  it('hides archived clients and can unlink', async () => {
    const user = userEvent.setup();
    const c = useClientStore.getState().saveClient(GLOBEX);
    const old = useClientStore.getState().saveClient({ name: 'Gloria Old', email: '', address: '' });
    useClientStore.getState().setArchived(old.id, true);
    render(<Harness initialData={{ clientId: c.id, toName: 'Globex', toEmail: 'ap@globex.example', toAddress: '1 Globex Way' }} />);
    await user.click(screen.getByRole('button', { name: /saved client/i }));
    await user.type(await screen.findByPlaceholderText('Search clients…'), 'glo');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).not.toContain(expect.stringContaining('Gloria'));
    expect(screen.queryByRole('option', { name: /Gloria/ })).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Search clients…'));
    await user.click(screen.getByRole('option', { name: /Don’t link/ }));
    await waitFor(() => expect(latest.clientId).toBeUndefined());
    expect(latest.toName).toBe('Globex'); // details kept
  });

  it('“Save as client” saves new Bill To details and links them', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Save as client' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Client Name / Company'), 'Hooli');
    await user.type(screen.getByLabelText('Client Email'), 'ap@hooli.example');
    await user.click(screen.getByRole('button', { name: 'Save as client' }));
    const saved = useClientStore.getState().clients[0];
    expect(saved).toMatchObject({ name: 'Hooli', email: 'ap@hooli.example' });
    await waitFor(() => expect(latest.clientId).toBe(saved.id));
    expect(screen.getByText('Billed to your saved client “Hooli”')).toBeInTheDocument();
  });

  it('“Update client” writes edited Bill To details back to the linked client, keeping its defaults', async () => {
    const user = userEvent.setup();
    const c = useClientStore.getState().saveClient(GLOBEX);
    render(<Harness initialData={{ clientId: c.id, toName: 'Globex', toEmail: 'ap@globex.example', toAddress: '1 Globex Way' }} />);
    await user.clear(screen.getByLabelText('Client Email'));
    await user.type(screen.getByLabelText('Client Email'), 'new@globex.example');
    await user.click(await screen.findByRole('button', { name: 'Update client' }));
    expect(useClientStore.getState().getClient(c.id)).toMatchObject({ email: 'new@globex.example', defaultCurrency: 'EUR', paymentTermsDays: 30 });
    expect(screen.getByText('Billed to your saved client “Globex”')).toBeInTheDocument();
  });

  it('offers to link a saved client with the same name and email', async () => {
    const user = userEvent.setup();
    const c = useClientStore.getState().saveClient(GLOBEX);
    render(<Harness />);
    await user.type(screen.getByLabelText('Client Name / Company'), 'GLOBEX ');
    await user.type(screen.getByLabelText('Client Email'), 'ap@globex.example');
    await user.click(await screen.findByRole('button', { name: 'Link client' }));
    await waitFor(() => expect(latest.clientId).toBe(c.id));
  });
});

describe('clientFillPatch / billToState', () => {
  const client = { id: 'c1', createdAt: '', updatedAt: '', ...GLOBEX };
  const values = { issueDate: '2026-01-31', dueDate: '', currency: 'USD', taxRate: 0 } as InvoiceFormData;

  it('fills defaults only for untouched fields', () => {
    expect(clientFillPatch(client, values, { currency: false, taxRate: false, dueDate: false })).toEqual({
      clientId: 'c1', toName: 'Globex', toAddress: '1 Globex Way', toEmail: 'ap@globex.example', currency: 'EUR', taxRate: 7, dueDate: '2026-03-02',
    });
    expect(clientFillPatch(client, values, { currency: true, taxRate: true, dueDate: true })).toEqual({
      clientId: 'c1', toName: 'Globex', toAddress: '1 Globex Way', toEmail: 'ap@globex.example',
    });
    expect(clientFillPatch(client, { ...values, dueDate: '2026-02-01' }, { currency: false, taxRate: false, dueDate: false })).not.toHaveProperty('dueDate');
  });

  it('classifies the Bill To section', () => {
    expect(billToState({ toName: '' } as InvoiceFormData, [client])).toEqual({ kind: 'empty' });
    expect(billToState({ toName: 'Initech', toEmail: '', toAddress: '' }, [client]).kind).toBe('new');
    expect(billToState({ toName: ' globex', toEmail: 'AP@globex.example', toAddress: '' }, [client]).kind).toBe('matches');
    expect(billToState({ clientId: 'c1', toName: 'Globex', toEmail: 'ap@globex.example', toAddress: '1 Globex Way' }, [client]).kind).toBe('linked');
    expect(billToState({ clientId: 'c1', toName: 'Globex', toEmail: 'x@y.z', toAddress: '1 Globex Way' }, [client]).kind).toBe('changed');
  });
});
