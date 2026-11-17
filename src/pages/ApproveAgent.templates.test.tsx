import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { SCOPE_INFO, SCOPE_SHORT } from '@/components/agents/scopes';
import { SCOPES } from '../../shared/api';
import ApproveAgent from './ApproveAgent';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const CODE = 'WDJB-MJHT';
let fake: FakeApi;

beforeEach(() => {
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'synced' });
});
afterEach(async () => {
  await whenIdle().catch(() => undefined);
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

describe('template permissions on the consent screen', () => {
  it('every scope has plain-language text', () => {
    for (const scope of SCOPES) {
      expect(SCOPE_INFO[scope].title.length).toBeGreaterThan(0);
      expect(SCOPE_SHORT[scope].length).toBeGreaterThan(0);
    }
  });

  it('describes templates:read / templates:write and approves a narrowed set', async () => {
    fake.use((req) => {
      if (!req.path.startsWith('/agents/registrations/')) return undefined;
      if (req.method === 'POST') return fake.json(200, { registration: { id: 'reg-1', status: 'approved', scopes: (req.body as { scopes: string[] }).scopes } });
      return fake.json(200, {
        registration: {
          id: 'reg-1',
          userCode: CODE,
          name: 'Billing helper',
          description: null,
          requestedScopes: ['invoices:write', 'templates:read', 'templates:write'],
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
        },
      });
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/agents/approve?code=${CODE}`]}>
            <Routes>
              <Route path="/agents/approve" element={<ApproveAgent />} />
              <Route path="/agents" element={<div>Agents page</div>} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const group = await screen.findByRole('group', { name: 'Permissions requested' });
    const read = within(group).getByRole('checkbox', { name: /View your invoice templates/ });
    const write = within(group).getByRole('checkbox', { name: /Add, edit and delete templates/ });
    expect(group).toHaveTextContent('templates:read');
    expect(group).toHaveTextContent('it can create draft invoices from them');
    expect(group).toHaveTextContent('Invoices already created from a template never change.');
    expect(read).toBeChecked();
    const user = userEvent.setup();
    await user.click(write);
    await user.click(screen.getByRole('button', { name: /Approve 2 of 3 permissions/ }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === 'POST' && r.path.endsWith('/approve'))).toBe(true));
    expect(fake.requests.find((r) => r.method === 'POST')!.body).toEqual({ scopes: ['invoices:write', 'templates:read'] });
  });
});
