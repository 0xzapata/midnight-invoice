import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ActivityEntry } from '../../../shared/activity';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { ActivityTimeline } from './ActivityTimeline';

const entry = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action' | 'id'>): ActivityEntry => ({
  time: '2026-11-17T12:00:00.000Z',
  actor: { type: 'user' },
  entity: null,
  changes: null,
  source: 'rest',
  tool: null,
  requestId: null,
  ...e,
});

describe('template entries in the activity timeline', () => {
  beforeEach(() => useTemplateStore.setState({ templates: [] }));

  it('links templates that still exist to /templates and marks removed ones', () => {
    const kept = useTemplateStore.getState().saveTemplate({
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
    render(
      <MemoryRouter>
        <ActivityTimeline
          entries={[
            entry({ id: 'act_3', action: 'template.updated', entity: { type: 'template', id: kept.id, label: 'Retainer' }, changes: { fields: ['lineItems'] } }),
            entry({ id: 'act_2', action: 'template.created', entity: { type: 'template', id: 'gone', label: 'Old workshop' } }),
            entry({ id: 'act_1', action: 'template.deleted', entity: { type: 'template', id: 'gone2', label: 'Ancient' } }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Retainer' })).toHaveAttribute('href', '/templates');
    expect(screen.queryByRole('link', { name: /Old workshop/ })).not.toBeInTheDocument();
    expect(screen.getByText('Old workshop').parentElement).toHaveTextContent('Old workshop (deleted)');
    // The deletion entry itself names the template without "(deleted)".
    expect(screen.getByText('Ancient')).not.toHaveTextContent('(deleted)');
    expect(screen.getByText(/Changed line items/)).toBeInTheDocument();
  });
});
