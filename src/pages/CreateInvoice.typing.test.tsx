/**
 * Guard against the editor writing values back while someone types (e.g.
 * the invoice-number sync effect, the draft auto-save round trip through
 * CreateInvoice, the template bar or the client picker). Keystrokes are
 * dispatched back to back (no delay), the worst case for a stale write-back;
 * every field must end up exactly as typed, and so must the saved draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import CreateInvoice from './CreateInvoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useTemplateStore } from '@/stores/useTemplateStore';

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

describe('typing in the invoice editor is never rewritten', () => {
  beforeEach(() => {
    useInvoiceStore.setState({ invoices: [], drafts: {} });
    // With a template saved, the template bar shows its picker too.
    useTemplateStore.setState({ templates: [] });
    useTemplateStore.getState().saveTemplate({
      name: 'Retainer',
      description: '',
      clientId: null,
      lineItems: [],
      taxRate: null,
      currency: null,
      notes: '',
      paymentDetails: '',
      paymentTermsDays: null,
      invoiceNamePattern: '',
    });
  });

  it('keeps fast keystrokes in order in every text field, and in the saved draft', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/create/typing-1']}>
        <Routes>
          <Route path="/create/:id" element={<CreateInvoice />} />
        </Routes>
      </MemoryRouter>,
    );
    const typed: [string, string][] = [
      ['Invoice Number', 'X-42'],
      ['Client Name / Company', 'Globex AG'],
      ['Name / Company', 'Ada Ltd'],
      ['Line item 1 description', 'Design 2'],
    ];
    for (const [label, text] of typed) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, text);
    }
    for (const [label, text] of typed) expect(screen.getByLabelText(label)).toHaveValue(text);
    await waitFor(() =>
      expect(useInvoiceStore.getState().drafts['typing-1']).toMatchObject({
        invoiceNumber: 'X-42',
        toName: 'Globex AG',
        fromName: 'Ada Ltd',
        lineItems: [expect.objectContaining({ description: 'Design 2' })],
      }),
    );
  }, 60_000); // real per-key typing on purpose (this guards against write-backs between keystrokes): generous timeout for loaded machines
});
