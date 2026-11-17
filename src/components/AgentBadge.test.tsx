import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useCloudStore } from '@/stores/useCloudStore';
import type { Invoice } from '@/types/invoice';
import { AgentBadge, InvoiceAttribution } from './AgentBadge';

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: 'i1',
  invoiceNumber: 'INV-0001',
  invoiceName: 'From agent',
  issueDate: '2026-11-17',
  fromName: 'Ada',
  fromAddress: '',
  fromEmail: '',
  toName: 'Globex',
  toAddress: '',
  toEmail: '',
  lineItems: [{ id: 'l', description: 'x', quantity: 1, price: 1 }],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  createdAt: '2026-11-17T10:00:00.000Z',
  ...overrides,
});

const handlers = { onView: vi.fn(), onLoadSession: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };

describe('agent attribution', () => {
  it('shows "by <agent>" in the invoice list for agent-created invoices', () => {
    render(
      <InvoiceList
        invoices={[
          invoice({ createdBy: { type: 'agent', agentId: 'a', agentName: 'Claude Desktop' }, updatedBy: { type: 'agent', agentId: 'a', agentName: 'Claude Desktop' } }),
          invoice({ id: 'i2', invoiceName: 'Mine', createdBy: { type: 'user' }, updatedBy: { type: 'agent', agentId: 'b', agentName: 'Helper' } }),
          invoice({ id: 'i3', invoiceName: 'Local only' }),
        ]}
        {...handlers}
      />,
    );
    expect(screen.getByText('by Claude Desktop')).toBeInTheDocument();
    expect(screen.getByText('edited by Helper')).toBeInTheDocument();
    expect(screen.getAllByText(/by /)).toHaveLength(2);
  });

  it('marks invoices the server rejected as not synced', () => {
    useCloudStore.setState({ syncErrors: { i1: 'Your name/company is required (fromName).' } });
    render(<InvoiceList invoices={[invoice({})]} {...handlers} />);
    expect(screen.getByText('Not synced')).toHaveAttribute('title', 'Not synced: Your name/company is required (fromName).');
    useCloudStore.setState({ syncErrors: {} });
  });

  it('renders agent names as text', () => {
    const { container } = render(<AgentBadge invoice={{ createdBy: { type: 'agent', agentName: '<script>x</script>' } }} />);
    expect(screen.getByText('by <script>x</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('describes provenance on the invoice view', () => {
    render(
      <InvoiceAttribution
        invoice={{ createdBy: { type: 'agent', agentName: 'Claude Desktop' }, updatedBy: { type: 'user' }, updatedAt: '2026-11-17T10:00:00.000Z' }}
      />,
    );
    expect(screen.getByText(/Created by the agent “Claude Desktop” · last edited by you on/)).toBeInTheDocument();
  });

  it('renders nothing for the user’s own invoices', () => {
    const { container } = render(<InvoiceAttribution invoice={{ createdBy: { type: 'user' }, updatedBy: { type: 'user' } }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
