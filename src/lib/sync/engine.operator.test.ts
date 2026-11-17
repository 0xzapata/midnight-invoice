/**
 * Operator policy as seen by the browser: workspace suspension (403
 * workspace_suspended) and maintenance mode (503 maintenance) PAUSE sync —
 * the queue is kept, nothing is dropped or marked "Not synced", and sync
 * resumes later — and enabling cloud sync while registration is closed
 * (403 registration_closed) explains why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { InvoiceFormData } from '@/types/invoice';
import type { ClientFormData } from '../../../shared/types/client';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { ApiError, describeError } from '@/lib/api/errors';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { SUSPENDED_RETRY_MS, resetSyncEngineForTests, startCloudSync, syncNow, whenIdle } from './engine';
import { enableCloudSync } from './cloudActions';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const INV = '00000000-0000-4000-8000-0000000000e1';
const CLIENT = '00000000-0000-4000-8000-0000000000e2';
const GLOBEX: ClientFormData = { name: 'Globex', email: 'ap@globex.example', address: '1 Globex Way' };

function form(overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0001',
    invoiceName: 'Website',
    issueDate: '2026-11-01',
    dueDate: '',
    fromName: 'Ada Ltd',
    fromAddress: '',
    fromEmail: '',
    toName: 'Globex',
    toAddress: '',
    toEmail: '',
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, price: 100 }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'EUR',
    ...overrides,
  };
}

let fake: FakeApi;
let stop: () => void;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useClientStore.setState({ clients: [] });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  stop = startCloudSync();
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  stop();
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

const connect = () => useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
const suspended = () => fake.apiError(403, 'workspace_suspended', 'This workspace has been suspended by the site operator.');
const maintenance = () =>
  fake.apiError(503, 'maintenance', 'Back at 10:00 UTC', undefined, { 'retry-after': '300' });

describe('operator pause: suspension', () => {
  it('pauses on upload: the queue is kept, nothing is marked "Not synced", and it resumes when reinstated', async () => {
    connect();
    await syncNow();
    // Writes refused (the feed is covered by the next test).
    const off = fake.use((req) => (req.method !== 'GET' ? suspended() : undefined));
    useClientStore.getState().saveClient(GLOBEX, CLIENT);
    useInvoiceStore.getState().saveInvoice(form(), INV);
    await syncNow();

    const s = useCloudStore.getState();
    expect(s.status).toBe('paused');
    expect(s.lastError).toMatch(/suspended by the site operator/);
    expect(s.queue.map((q) => q.entityId)).toEqual(expect.arrayContaining([CLIENT, INV]));
    expect(s.queue.every((q) => q.attempts === 0)).toBe(true);
    expect(s.syncErrors).toEqual({});
    expect(toast.error).not.toHaveBeenCalled();
    expect(fake.server.getClient(CLIENT)).toBeUndefined();

    // Retries are spaced out while paused.
    const nextTry = Math.max(...useCloudStore.getState().queue.map((q) => q.notBefore));
    expect(nextTry - Date.now()).toBeGreaterThan(SUSPENDED_RETRY_MS - 5_000);

    off();
    await syncNow({ force: true });
    expect(useCloudStore.getState().status).toBe('synced');
    expect(useCloudStore.getState().queue).toEqual([]);
    expect(fake.server.getClient(CLIENT)?.name).toBe('Globex');
  });

  it('pauses when the pull is refused, without touching local data', async () => {
    connect();
    useInvoiceStore.getState().saveInvoice(form(), INV);
    await syncNow();
    const off = fake.use(() => suspended());
    await syncNow();
    expect(useCloudStore.getState().status).toBe('paused');
    expect(useInvoiceStore.getState().invoices.map((i) => i.id)).toEqual([INV]);
    off();
  });
});

describe('operator pause: maintenance', () => {
  it('pauses with the operator message and honours Retry-After, keeping the attempt count', async () => {
    connect();
    await syncNow();
    const off = fake.use((req) => (req.method === 'PUT' ? maintenance() : undefined));
    useInvoiceStore.getState().saveInvoice(form(), INV);
    const before = Date.now();
    await syncNow();
    const s = useCloudStore.getState();
    expect(s.status).toBe('paused');
    expect(s.lastError).toBe('Cloud sync is paused for maintenance: Back at 10:00 UTC. Changes are kept in this browser and sync automatically afterwards.');
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].attempts).toBe(0);
    expect(s.queue[0].notBefore - before).toBeGreaterThanOrEqual(299_000);
    expect(s.syncErrors).toEqual({});
    off();
    await syncNow({ force: true });
    expect(useCloudStore.getState().status).toBe('synced');
    expect(fake.server.get(INV)?.invoiceName).toBe('Website');
  });

  it('is a pause for the whole cycle when the feed itself is in maintenance', async () => {
    connect();
    const off = fake.use(() => maintenance());
    await syncNow();
    expect(useCloudStore.getState()).toMatchObject({ status: 'paused' });
    off();
  });
});

describe('registration closed', () => {
  it('enabling cloud sync explains that new workspaces are not accepted, and stays local', async () => {
    fake.use((req) =>
      req.method === 'POST' && req.path === '/workspaces'
        ? fake.apiError(403, 'registration_closed', 'New cloud-sync workspaces are not being accepted right now.')
        : undefined,
    );
    useInvoiceStore.getState().saveInvoice(form(), INV);
    const err = await enableCloudSync().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(describeError(err)).toBe('This site is not accepting new cloud-sync workspaces right now. Your invoices stay in this browser; try again later.');
    expect(useCloudStore.getState()).toMatchObject({ status: 'disabled', token: null, queue: [] });
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
  });
});
