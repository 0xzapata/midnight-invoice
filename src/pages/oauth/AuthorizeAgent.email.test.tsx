import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import AuthorizeAgent from './AuthorizeAgent';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = 'Em'.repeat(22);
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

describe('OAuth consent screen with invoices:send', () => {
  it('shows the email permission in plain, cautionary language with the "Sends email" mark', async () => {
    fake.use((req) =>
      req.path.startsWith('/oauth/requests/') && req.method === 'GET'
        ? fake.json(200, {
            request: {
              id: ID,
              client: { kind: 'dcr', name: 'Desktop client', metadataHost: null, clientUri: null },
              redirect: { uri: 'http://127.0.0.1:53682/callback', kind: 'loopback', display: '127.0.0.1:53682' },
              requestedScopes: ['invoices:read', 'invoices:send'],
              scopesDefaulted: false,
              existingAgent: null,
              createdAt: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
            },
          })
        : undefined,
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/agents/authorize?request=${ID}`]}>
            <Routes>
              <Route path="/agents/authorize" element={<AuthorizeAgent />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const group = await screen.findByRole('group', { name: /Permissions/ });
    const send = within(group).getByRole('checkbox', { name: /Email invoices to your clients/ });
    expect(send).toBeInTheDocument();
    expect(within(group).getByText('Sends email')).toBeInTheDocument();
    expect(group).toHaveTextContent('Can email invoices to your clients on your behalf');
    expect(group).toHaveTextContent('Emails cannot be unsent');
  });
});
