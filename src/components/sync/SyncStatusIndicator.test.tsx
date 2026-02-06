import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStore } from '@/stores/useSyncStore';

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    useSyncStore.setState({ status: 'synced', isOnline: true, lastSyncTime: undefined });
  });

  it('shows synced status with Check icon', () => {
    useSyncStore.setState({ status: 'synced', isOnline: true });

    render(<SyncStatusIndicator />);

    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByLabelText('Check')).toBeInTheDocument();
  });

  it('shows syncing status with spinning RefreshCw icon', () => {
    useSyncStore.setState({ status: 'syncing', isOnline: true });

    render(<SyncStatusIndicator />);

    expect(screen.getByText('Syncing...')).toBeInTheDocument();
    const icon = screen.getByLabelText('RefreshCw');
    expect(icon).toHaveClass('animate-spin');
  });

  it('shows offline status with WifiOff icon', () => {
    useSyncStore.setState({ status: 'offline', isOnline: false });

    render(<SyncStatusIndicator />);

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByLabelText('WifiOff')).toBeInTheDocument();
  });

  it('shows conflict status with AlertTriangle icon', () => {
    useSyncStore.setState({ status: 'conflict', isOnline: true });

    render(<SyncStatusIndicator />);

    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByLabelText('AlertTriangle')).toBeInTheDocument();
  });

  it('shows tooltip with last sync time', () => {
    const lastSync = new Date(Date.now() - 5000);
    useSyncStore.setState({
      status: 'synced',
      isOnline: true,
      lastSyncTime: lastSync,
    });

    render(<SyncStatusIndicator />);

    const element = screen.getByText('Synced').closest('[title]');
    expect(element).toHaveAttribute('title');
    expect(element?.getAttribute('title')).toContain('Last synced');
  });

  it('shows offline tooltip', () => {
    useSyncStore.setState({ status: 'offline', isOnline: false });

    render(<SyncStatusIndicator />);

    const element = screen.getByText('Offline').closest('[title]');
    expect(element).toHaveAttribute('title');
    expect(element?.getAttribute('title')).toContain('offline');
  });
});
