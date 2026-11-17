import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fill } from '@/test/userInput';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { act } from 'react';
import { toast } from 'sonner';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import ViewInvoice from '@/pages/ViewInvoice';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { Invoice, InvoiceFormData } from '@/types/invoice';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { TemplateFormData } from '../../../shared/types/template';
import { NewFromTemplateButton } from './NewFromTemplateButton';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn() },
}));

const RETAINER: TemplateFormData = {
  name: 'Retainer',
  description: 'Monthly design retainer',
  clientId: null,
  lineItems: [{ id: 'tl', description: 'Retainer {{month_name}} {{year}}', quantity: 1, price: 2000 }],
  taxRate: null,
  currency: 'EUR',
  notes: 'Thanks, {{client_name}}!',
  paymentDetails: '',
  paymentTermsDays: 14,
  invoiceNamePattern: 'Retainer {{month_name}}',
};

/** The invoice form with its latest values exposed, like CreateInvoice uses it. */
function FormHarness({ initial, onValues }: { initial?: Partial<InvoiceFormData>; onValues: (v: InvoiceFormData) => void }) {
  const [, setTick] = useState(0);
  return (
    <InvoiceForm
      invoiceNumber="INV-0042"
      initialData={{ issueDate: '2026-03-05', ...initial }}
      onFormChange={(v) => {
        onValues(v);
        setTick((t) => t + 1);
      }}
    />
  );
}

let latest: InvoiceFormData;
const renderForm = (initial?: Partial<InvoiceFormData>) =>
  render(
    <MemoryRouter>
      <FormHarness initial={initial} onValues={(v) => (latest = v)} />
    </MemoryRouter>,
  );

async function pickTemplate(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Apply a template' }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  // cmdk constructs a ResizeObserver; the shared setup's mock is not constructible (as in BillToClient.test).
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  useTemplateStore.setState({ templates: [], _hasHydrated: true });
  useClientStore.setState({ clients: [], _hasHydrated: true });
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe('“From template” in the invoice form', () => {
  it('applies directly to a fresh form, resolving placeholders for its issue date', async () => {
    const user = userEvent.setup({ delay: null });
    const t = useTemplateStore.getState().saveTemplate(RETAINER);
    renderForm();
    await pickTemplate(user, 'Retainer');
    await waitFor(() => expect(latest.templateId).toBe(t.id));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(latest).toMatchObject({ invoiceName: 'Retainer March', currency: 'EUR', dueDate: '2026-03-19', notes: 'Thanks, {{client_name}}!' });
    expect(latest.lineItems.map((l) => l.description)).toEqual(['Retainer March 2026']);
    expect(screen.getByDisplayValue('Retainer March 2026')).toBeInTheDocument();
  });

  it('never silently clobbers typed content: asks, and “Add to invoice” keeps everything typed', async () => {
    const user = userEvent.setup({ delay: null });
    useTemplateStore.getState().saveTemplate(RETAINER);
    renderForm({
      toName: 'Initech',
      notes: 'My own notes',
      lineItems: [{ id: 'typed', description: 'Typed work', quantity: 2, price: 50 }],
    });
    await pickTemplate(user, 'Retainer');
    const confirm = await screen.findByRole('alertdialog', { name: 'Apply “Retainer”?' });
    expect(confirm).toHaveTextContent('This invoice already has content');

    // Cancel changes nothing.
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(latest.lineItems.map((l) => l.description)).toEqual(['Typed work']);
    expect(latest.templateId).toBeUndefined();

    await pickTemplate(user, 'Retainer');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Add to invoice' }));
    await waitFor(() => expect(latest.lineItems).toHaveLength(2));
    expect(latest.lineItems.map((l) => l.description)).toEqual(['Typed work', 'Retainer March 2026']);
    expect(latest).toMatchObject({ toName: 'Initech', notes: 'My own notes', invoiceName: 'Retainer March', templateId: expect.any(String) });
  });

  it('“Replace” replaces the line items, name and notes', async () => {
    const user = userEvent.setup({ delay: null });
    useTemplateStore.getState().saveTemplate(RETAINER);
    renderForm({ toName: 'Initech', notes: 'Old', lineItems: [{ id: 'typed', description: 'Typed work', quantity: 2, price: 50 }] });
    await pickTemplate(user, 'Retainer');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(latest.lineItems.map((l) => l.description)).toEqual(['Retainer March 2026']));
    // Bill To is kept (the template has no client) and fills {{client_name}}.
    expect(latest).toMatchObject({ toName: 'Initech', notes: 'Thanks, Initech!' });
  });

  it('“Save as template” in the form saves the current invoice as a template', async () => {
    const user = userEvent.setup({ delay: null });
    renderForm({ toName: 'Globex', invoiceName: 'Globex design', dueDate: '2026-04-04', lineItems: [{ id: 'a', description: 'Design', quantity: 3, price: 100 }] });
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    expect(within(dialog).getByLabelText('Template name')).toHaveValue('Globex design');
    expect(within(dialog).getByLabelText('Payment terms (days)')).toHaveValue(30);
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(useTemplateStore.getState().templates).toHaveLength(1));
    expect(useTemplateStore.getState().templates[0]).toMatchObject({ name: 'Globex design', paymentTermsDays: 30, lineItems: [{ description: 'Design', quantity: 3, price: 100 }] });
  });
});

describe('“Save as template” on the invoice page', () => {
  it('prefills the template from the invoice; the invoice is unchanged', async () => {
    const user = userEvent.setup({ delay: null });
    const invoice: Invoice = {
      id: 'inv-1',
      invoiceNumber: 'INV-0001',
      invoiceName: 'Website',
      issueDate: '2026-03-01',
      dueDate: '2026-03-15',
      fromName: 'Ada',
      fromAddress: '',
      fromEmail: '',
      toName: 'Globex',
      toAddress: '',
      toEmail: '',
      lineItems: [{ id: 'l', description: 'Build', quantity: 1, price: 4000 }],
      taxRate: 19,
      notes: 'Thanks',
      paymentDetails: 'IBAN',
      currency: 'EUR',
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    useInvoiceStore.setState({ invoices: [invoice], _hasHydrated: true });
    render(
      <MemoryRouter initialEntries={['/invoice/inv-1']}>
        <Routes>
          <Route path="/invoice/:id" element={<ViewInvoice />} />
          <Route path="/templates" element={<p>Templates page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    expect(within(dialog).getByLabelText('Tax rate (%)')).toHaveValue(19);
    await user.clear(within(dialog).getByLabelText('Template name'));
    await fill(user, within(dialog).getByLabelText('Template name'), 'Website build');
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(useTemplateStore.getState().templates).toHaveLength(1));
    expect(useTemplateStore.getState().templates[0]).toMatchObject({
      name: 'Website build',
      currency: 'EUR',
      taxRate: 19,
      notes: 'Thanks',
      paymentDetails: 'IBAN',
      paymentTermsDays: 14,
      lineItems: [{ description: 'Build', quantity: 1, price: 4000 }],
    });
    expect(useInvoiceStore.getState().invoices).toEqual([invoice]);
    // The toast offers to open the Templates page.
    const [title, options] = vi.mocked(toast.success).mock.calls[vi.mocked(toast.success).mock.calls.length - 1];
    expect(title).toBe('Saved the template “Website build”');
    const action = (options as { action: { label: string; onClick: () => void } }).action;
    expect(action.label).toBe('View templates');
    act(() => action.onClick());
    expect(await screen.findByText('Templates page')).toBeInTheDocument();
  });
});

describe('“New from template” on the dashboard', () => {
  function LocationProbe() {
    return <div data-testid="location">{useLocation().pathname}</div>;
  }

  it('is hidden without templates and opens a new draft from the picked one', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <MemoryRouter>
        <NewFromTemplateButton />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /New from template/ })).not.toBeInTheDocument();
    useTemplateStore.getState().saveTemplate(RETAINER);
    rerender(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<NewFromTemplateButton />} />
          <Route path="/create/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /New from template/ }));
    await user.click(await screen.findByRole('option', { name: /Retainer/ }));
    const id = (await screen.findByTestId('location')).textContent!.replace('/create/', '');
    expect(useInvoiceStore.getState().drafts[id]).toMatchObject({ templateId: useTemplateStore.getState().templates[0].id, currency: 'EUR' });
  });
});
