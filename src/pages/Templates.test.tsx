import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Invoice } from '@/types/invoice';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { localToday } from '../../shared/invoice-status';
import { placeholderValues } from '../../shared/template-placeholders';
import Templates from './Templates';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/templates']}>
        <Routes>
          <Route path="/templates" element={<Templates />} />
          <Route path="/create/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const TODAY = placeholderValues({ issueDate: localToday() });

beforeEach(() => {
  localStorage.clear();
  useTemplateStore.setState({ templates: [], _hasHydrated: true });
  useClientStore.setState({ clients: [], _hasHydrated: true });
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, fromName: 'Ada Ltd', currency: 'USD' } });
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
});

describe('Templates page', () => {
  it('creates a template with the line-item editor, placeholder helper and live preview', async () => {
    const user = userEvent.setup();
    useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: '' });
    renderPage();
    expect(screen.getByText('No templates yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add your first template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });

    // Validation: a name is required.
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Template name is required');

    await user.type(within(dialog).getByLabelText('Template name'), 'Monthly retainer');
    await user.selectOptions(within(dialog).getByLabelText('Default client (optional)'), 'Globex');
    const nameField = within(dialog).getByLabelText('Invoice name (optional)');
    await user.type(nameField, 'Retainer ');
    // The helper inserts at the cursor of the last focused field.
    await user.click(within(dialog).getByRole('button', { name: /Insert \{\{month_name\}\}/ }));
    expect(nameField).toHaveValue('Retainer {{month_name}}');

    const description = within(dialog).getByLabelText('Description');
    await user.type(description, 'Design for ');
    await user.click(within(dialog).getByRole('button', { name: /Insert \{\{client_name\}\}/ }));
    expect(description).toHaveValue('Design for {{client_name}}');
    await user.clear(within(dialog).getByLabelText('Price'));
    await user.type(within(dialog).getByLabelText('Price'), '1500');

    await user.click(within(dialog).getByRole('button', { name: 'Add item' }));
    // Typed braces need escaping for user-event.
    await user.type(within(dialog).getByLabelText('Description (item 2)'), 'Typo {{{{monthname}}');

    // Live preview for an invoice issued today, with the client’s name; unknown names are flagged.
    expect(dialog).toHaveTextContent(`Retainer ${TODAY.month_name}`);
    expect(dialog).toHaveTextContent('Design for Globex');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Not a placeholder (will stay as typed): {{monthname}}');

    await user.type(within(dialog).getByLabelText('Payment terms (days)'), '14');
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const [t] = useTemplateStore.getState().templates;
    expect(t).toMatchObject({
      name: 'Monthly retainer',
      clientId: useClientStore.getState().clients[0].id,
      invoiceNamePattern: 'Retainer {{month_name}}',
      paymentTermsDays: 14,
      taxRate: null,
      currency: null,
    });
    expect(t.lineItems.map((l) => [l.description, l.price])).toEqual([
      ['Design for {{client_name}}', 1500],
      ['Typo {{monthname}}', 0],
    ]);
    const row = screen.getByText('Monthly retainer', { selector: 'h3' }).closest('li')!;
    expect(row).toHaveTextContent('Net 14');
    expect(row).toHaveTextContent('uses placeholders');
  }, 20_000); // many keystrokes: slow on a loaded CI machine

  it('edits, archives and deletes a template; invoices made from it are untouched', async () => {
    const user = userEvent.setup();
    const t = useTemplateStore.getState().saveTemplate({
      name: 'Workshop',
      description: 'Half-day workshop',
      clientId: null,
      lineItems: [{ id: 'a', description: 'Workshop', quantity: 1, price: 900 }],
      taxRate: 7,
      currency: 'EUR',
      notes: '',
      paymentDetails: '',
      paymentTermsDays: null,
      invoiceNamePattern: '',
    });
    const inv = { id: 'i1', templateId: t.id, invoiceNumber: 'INV-0001', lineItems: [{ id: 'x', description: 'Workshop', quantity: 1, price: 900 }] } as Invoice;
    useInvoiceStore.setState({ invoices: [inv] });
    renderPage();
    const row = screen.getByText('Workshop', { selector: 'h3' }).closest('li')!;
    expect(row).toHaveTextContent('used for 1 invoice');
    expect(row).toHaveTextContent('EUR');
    expect(row).toHaveTextContent('7% tax');

    await user.click(within(row).getByRole('button', { name: 'Edit Workshop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });
    expect(within(dialog).getByLabelText('Tax rate (%)')).toHaveValue(7);
    await user.clear(within(dialog).getByLabelText('Template name'));
    await user.type(within(dialog).getByLabelText('Template name'), 'Full-day workshop');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(useTemplateStore.getState().templates[0].name).toBe('Full-day workshop'));

    await user.click(screen.getByRole('button', { name: 'Archive Full-day workshop' }));
    expect(useTemplateStore.getState().templates[0].archivedAt).toEqual(expect.any(String));
    expect(screen.getByText('All templates are archived.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    await user.click(screen.getByRole('button', { name: 'Delete Full-day workshop' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('The 1 invoice created from it stay as they are.');
    await user.click(within(confirm).getByRole('button', { name: 'Delete template' }));
    expect(useTemplateStore.getState().templates).toEqual([]);
    expect(useInvoiceStore.getState().invoices).toEqual([inv]);
  }, 20_000);

  it('“New invoice” opens a draft built from the template', async () => {
    const user = userEvent.setup();
    useTemplateStore.getState().saveTemplate({
      name: 'Retainer',
      description: '',
      clientId: null,
      lineItems: [{ id: 'a', description: 'Retainer {{month_name}} {{year}}', quantity: 1, price: 2000 }],
      taxRate: null,
      currency: 'EUR',
      notes: '',
      paymentDetails: '',
      paymentTermsDays: 30,
      invoiceNamePattern: '',
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New invoice from Retainer' }));
    const path = screen.getByTestId('location').textContent!;
    const id = path.replace('/create/', '');
    const draft = useInvoiceStore.getState().drafts[id];
    expect(draft).toMatchObject({ currency: 'EUR', fromName: 'Ada Ltd', templateId: useTemplateStore.getState().templates[0].id, issueDate: localToday() });
    expect(draft.lineItems[0].description).toBe(`Retainer ${TODAY.month_name} ${TODAY.year}`);
    expect(draft.dueDate).not.toBe('');
  });
});
