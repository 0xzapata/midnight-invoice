import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { SyncStatusIndicator } from './SyncStatusIndicator';

describe('SyncStatusIndicator', () => {
  it('shows a paused state with the operator message and a retry, not an error', () => {
    useCloudStore.setState({
      ...EMPTY_CLOUD_STATE,
      token: 'mi_ws_x',
      status: 'paused',
      lastError: 'Cloud sync is paused: this workspace has been suspended by the site operator.',
      queue: [{ opId: 'a', seq: 1, type: 'upsert', collection: 'invoices', entityId: 'i1', attempts: 0, notBefore: 0 }] as never,
    });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <SyncStatusIndicator />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Cloud sync: Sync paused\. Cloud sync is paused: this workspace has been suspended/ });
    expect(link).toHaveClass('text-amber-600');
    expect(link).not.toHaveClass('text-destructive');
    expect(link).toHaveAccessibleName(/1 change waiting to sync/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
