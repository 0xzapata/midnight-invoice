/**
 * Sync of invoice status: a status change is a normal edit for the engine
 * and a single field (status + sentAt + paidAt) for the three-way merge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Invoice } from '@/types/invoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { localToday } from '../../../shared/invoice-status';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { resetSyncEngineForTests, startCloudSync, syncNow, whenIdle } from './engine';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = '00000000-0000-4000-8000-00000000000a';
const local = (): Invoice | undefined => useInvoiceStore.getState().invoices.find((i) => i.id === ID);

let fake: FakeApi;
let stop: () => void;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.warning).mockClear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  fake = createFakeApi();
  vi.stubGlobal('fetch', fake.fetch);
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
  stop = startCloudSync();
});

afterEach(async () => {
  await whenIdle().catch(() => undefined);
  stop();
  resetSyncEngineForTests();
  vi.unstubAllGlobals();
});

async function syncedInvoice(status?: 'sent') {
  fake.server.create(ID, {
    invoiceNumber: 'INV-0005',
    invoiceName: 'Website',
    toName: 'Globex',
    fromName: 'Ada',
    dueDate: '2026-12-01',
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, price: 100 }],
    ...(status ? { status } : {}),
  });
  await syncNow();
  fake.state.offline = true;
}

describe('invoice status sync', () => {
  it('uploads a local status change like any edit', async () => {
    await syncedInvoice();
    expect(local()).toMatchObject({ status: 'draft', sentAt: null });
    const result = useInvoiceStore.getState().setInvoiceStatus(ID, 'mark_sent');
    expect(result.ok).toBe(true);
    fake.state.offline = false;
    await syncNow({ force: true });
    const put = fake.requests.find((r) => r.method === 'PUT')!;
    expect(put.headers['if-match']).toBe('"1"');
    expect(put.body).toMatchObject({ status: 'sent', sentAt: localToday(), paidAt: null });
    expect(fake.server.get(ID)).toMatchObject({ status: 'sent', revision: 2 });
    expect(local()).toMatchObject({ status: 'sent', revision: 2 });
  });

  it('merges a local "mark paid" with a concurrent content edit by an agent', async () => {
    await syncedInvoice('sent');
    useInvoiceStore.getState().setInvoiceStatus(ID, { status: 'paid', paidAt: '2026-11-16' });
    fake.server.update(ID, { notes: 'Net 30' }); // agent edit, revision 2
    fake.state.offline = false;
    await syncNow({ force: true });

    const puts = fake.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['if-match'])).toEqual(['"1"', '"2"']);
    expect(fake.server.get(ID)).toMatchObject({ status: 'paid', paidAt: '2026-11-16', notes: 'Net 30', revision: 3 });
    expect(local()).toMatchObject({ status: 'paid', paidAt: '2026-11-16', notes: 'Net 30', revision: 3 });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('merges a local content edit with a status change made by an agent', async () => {
    await syncedInvoice('sent');
    const inv = local()!;
    useInvoiceStore.getState().saveInvoice({ ...inv, toName: 'Globex GmbH' }, ID);
    expect(local()).toMatchObject({ status: 'sent' }); // the form never changes the status
    fake.server.update(ID, { status: 'paid', paidAt: '2026-11-15' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.get(ID)).toMatchObject({ toName: 'Globex GmbH', status: 'paid', paidAt: '2026-11-15', revision: 3 });
    expect(local()).toMatchObject({ toName: 'Globex GmbH', status: 'paid', paidAt: '2026-11-15' });
  });

  it('keeps the server status (with its dates) when both sides changed it', async () => {
    await syncedInvoice('sent');
    useInvoiceStore.getState().setInvoiceStatus(ID, { status: 'paid', paidAt: '2026-11-16' });
    fake.server.update(ID, { status: 'void' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(local()).toMatchObject({ status: 'void', paidAt: null });
    expect(fake.server.get(ID)).toMatchObject({ status: 'void', paidAt: null });
    expect(toast.warning).toHaveBeenCalledWith('Some of your changes to INV-0005 were not applied', {
      description: 'The agent “Claude Desktop” changed the status at the same time; the newer version was kept.',
    });
  });

  it('applies a status change pulled from the server without echoing it back', async () => {
    await syncedInvoice('sent');
    fake.state.offline = false;
    fake.server.update(ID, { status: 'paid', paidAt: '2026-11-17' });
    await syncNow({ force: true });
    expect(local()).toMatchObject({ status: 'paid', paidAt: '2026-11-17' });
    expect(local()).not.toHaveProperty('isOverdue');
    expect(fake.writes()).toEqual([]);
  });
});
