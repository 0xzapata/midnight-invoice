import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fill } from '@/test/userInput';
import { MemoryRouter, Route, Routes } from 'react-router';
import CreateInvoice from './CreateInvoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { toast } from 'sonner';

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(() => ({ toBlob: vi.fn().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' })) })),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn(), registerHyphenationCallback: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/create/:id" element={<CreateInvoice />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const form = () => within(document.querySelector('main')!);

describe('CreateInvoice: saving validates like the API', () => {
  beforeEach(() => {
    useInvoiceStore.setState({ invoices: [], drafts: {} });
    vi.clearAllMocks();
  });

  it('refuses to save an empty sender or line-item description, shows field errors and focuses the first invalid field', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/create/new-1');
    // Typed input must survive the failed save.
    await fill(user, screen.getByLabelText('Client Name / Company'), 'Globex');

    await user.click(screen.getByRole('button', { name: /save invoice/i }));

    expect(await screen.findByText('Your name/company is required')).toBeInTheDocument();
    expect(screen.getByText('Description is required')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name / Company')).toHaveFocus());
    expect(screen.getByLabelText('Name / Company')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Line item 1 description')).toHaveAttribute('aria-invalid', 'true');
    expect(toast.error).toHaveBeenCalledWith('Fix the highlighted fields to save this invoice');
    expect(useInvoiceStore.getState().invoices).toHaveLength(0);
    expect(screen.getByLabelText('Client Name / Company')).toHaveValue('Globex');
    // Still on the editor.
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('clears an error as soon as the field is fixed, then saves', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/create/new-2');
    await user.click(screen.getByRole('button', { name: /save invoice/i }));
    expect(await screen.findByText('Your name/company is required')).toBeInTheDocument();

    await fill(user, screen.getByLabelText('Name / Company'), 'Me & Co');
    await waitFor(() => expect(screen.queryByText('Your name/company is required')).not.toBeInTheDocument());
    await fill(user, screen.getByLabelText('Client Name / Company'), 'Globex');
    await fill(user, screen.getByLabelText('Line item 1 description'), 'Design work');
    expect(form().queryByText('Description is required')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save invoice/i }));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    const [saved] = useInvoiceStore.getState().invoices;
    expect(saved).toMatchObject({ id: 'new-2', fromName: 'Me & Co', toName: 'Globex' });
    expect(saved.lineItems[0].description).toBe('Design work');
  });

  it('does not save (or download) an invalid invoice from "Download PDF" either', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/create/new-3');
    await user.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(await screen.findByText('Your name/company is required')).toBeInTheDocument();
    expect(useInvoiceStore.getState().invoices).toHaveLength(0);
  });

  it('keeps auto-saving drafts without validating them', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/create/new-4');
    await fill(user, screen.getByLabelText('Client Name / Company'), 'Draft client');
    await waitFor(() => expect(useInvoiceStore.getState().drafts['new-4']?.toName).toBe('Draft client'));
    expect(useInvoiceStore.getState().drafts['new-4'].fromName).toBe('');
    expect(screen.queryByText('Your name/company is required')).not.toBeInTheDocument();
  });

  it('keeps the header actions icon-only (with accessible names) below lg so it fits at 320 px', () => {
    renderAt('/create/new-5');
    for (const name of ['Download PDF', 'Duplicate', 'Save & mark sent', 'Save Invoice']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('h-8', 'w-8', 'lg:w-auto');
      expect(button.querySelector('span')).toHaveClass('hidden', 'lg:inline');
    }
    expect(screen.getByRole('heading', { name: 'Create Invoice' })).toHaveClass('truncate');
    expect(screen.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
  });
});
