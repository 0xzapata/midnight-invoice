import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fill } from '@/test/userInput';
import { MemoryRouter, Route, Routes } from 'react-router';
import { toast } from 'sonner';
import CreateInvoice from './CreateInvoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useClientStore } from '@/stores/useClientStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { newInvoiceDraftFromTemplate } from '@/components/templates/templateApply';
import { DEFAULT_SETTINGS } from '../../shared/settings';

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn(), registerHyphenationCallback: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

function openDraftFromTemplate(fromName: string) {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, fromName } });
  const client = useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: '1 Globex Way', paymentTermsDays: 30 });
  const template = useTemplateStore.getState().saveTemplate({
    name: 'Retainer',
    description: '',
    clientId: client.id,
    lineItems: [{ id: 'tl', description: 'Retainer {{month_name}}', quantity: 1, price: 2000 }],
    taxRate: null,
    currency: 'EUR',
    notes: '',
    paymentDetails: '',
    paymentTermsDays: null,
    invoiceNamePattern: '',
  });
  const { draft } = newInvoiceDraftFromTemplate(template, {
    clients: useClientStore.getState().clients,
    settings: useSettingsStore.getState().settings,
    invoiceNumber: 'INV-0001',
    today: '2026-03-05',
  });
  useInvoiceStore.getState().saveDraft('tpl-1', draft);
  render(
    <MemoryRouter initialEntries={['/create/tpl-1']}>
      <Routes>
        <Route path="/create/:id" element={<CreateInvoice />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return template;
}

describe('an invoice created from a template passes the save validation', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    localStorage.clear();
    useInvoiceStore.setState({ invoices: [], drafts: {} });
    useClientStore.setState({ clients: [] });
    useTemplateStore.setState({ templates: [] });
    vi.clearAllMocks();
  });

  it('saves as is when the settings provide the sender', async () => {
    const user = userEvent.setup({ delay: null });
    const template = openDraftFromTemplate('Ada Ltd');
    await user.click(screen.getByRole('button', { name: /save invoice/i }));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    const [saved] = useInvoiceStore.getState().invoices;
    expect(saved).toMatchObject({ id: 'tpl-1', templateId: template.id, toName: 'Globex', currency: 'EUR', dueDate: '2026-04-04', fromName: 'Ada Ltd', status: 'draft' });
    expect(saved.lineItems[0].description).toBe('Retainer March');
  });

  it('without a sender the usual validation applies, and the template content survives it', async () => {
    const user = userEvent.setup({ delay: null });
    openDraftFromTemplate('');
    await user.click(screen.getByRole('button', { name: /save invoice/i }));
    expect(await screen.findByText('Your name/company is required')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Fix the highlighted fields to save this invoice');
    expect(useInvoiceStore.getState().invoices).toHaveLength(0);
    await fill(user, screen.getByLabelText('Name / Company'), 'Ada Ltd');
    await user.click(screen.getByRole('button', { name: /save invoice/i }));
    await waitFor(() => expect(useInvoiceStore.getState().invoices).toHaveLength(1));
    expect(useInvoiceStore.getState().invoices[0].lineItems[0].description).toBe('Retainer March');
  });
});
