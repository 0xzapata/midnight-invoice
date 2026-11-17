import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Invoice, InvoiceFormData } from '@/types/invoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { resetSyncEngineForTests, startCloudSync, syncNow, whenIdle } from './engine';
import { connectExistingWorkspace, deleteCloudWorkspace, disconnectThisBrowser, enableCloudSync } from './cloudActions';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  agent: '00000000-0000-4000-8000-0000000000ag'.replace('ag', 'aa'),
};

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

const local = (id: string): Invoice | undefined => useInvoiceStore.getState().invoices.find((i) => i.id === id);
const save = (id: string, overrides: Partial<InvoiceFormData> = {}) => useInvoiceStore.getState().saveInvoice(form(overrides), id);

let fake: FakeApi;
let stop: () => void;

function connectFake() {
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.error).mockClear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
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

describe('cloud sync is opt-in', () => {
  it('does nothing while disabled: local saves make no requests', async () => {
    save(ID.a);
    useSettingsStore.getState().updateSettings({ fromName: 'Ada' });
    await syncNow();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(useCloudStore.getState().queue).toEqual([]);
  });
});

describe('enabling', () => {
  it('creates a workspace and uploads existing local invoices and default settings', async () => {
    save(ID.a, { invoiceNumber: 'INV-0001' });
    save(ID.b, { invoiceNumber: 'INV-0002' });
    useSettingsStore.getState().updateSettings({ fromName: 'Ada Ltd', currency: 'EUR' });

    await enableCloudSync();
    await whenIdle();

    expect(fake.writes()).toEqual(['POST /workspaces', 'PUT /settings', `PUT /invoices/${ID.a}`, `PUT /invoices/${ID.b}`]);
    const puts = fake.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/invoices/'));
    expect(puts.every((r) => r.headers['if-none-match'] === '*')).toBe(true);
    expect(fake.state.settings.settings).toMatchObject({ fromName: 'Ada Ltd', currency: 'EUR' });
    expect(fake.server.get(ID.a)?.invoiceNumber).toBe('INV-0001');

    const cloud = useCloudStore.getState();
    expect(cloud.token).toBe(FAKE_TOKEN);
    expect(cloud.queue).toEqual([]);
    expect(cloud.cursors.invoices).toEqual(expect.any(String));
    expect(cloud.status).toBe('synced');
    expect(local(ID.a)?.revision).toBe(1);
    expect(local(ID.a)?.createdBy).toEqual({ type: 'user' });
  });

  it('marks the initial upload as one bulk batch (for the activity log), but not later edits', async () => {
    save(ID.a, { invoiceNumber: 'INV-0001' });
    save(ID.b, { invoiceNumber: 'INV-0002' });
    await enableCloudSync();
    await whenIdle();
    const markers = fake.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/invoices/')).map((r) => r.headers['x-midnight-sync']);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatch(/^bulk-upload; batch=[0-9a-f-]{36}$/);
    expect(markers[1]).toBe(markers[0]);
    expect(fake.requests.find((r) => r.path === '/settings')?.headers['x-midnight-sync']).toBeUndefined();

    save(ID.a, { invoiceNumber: 'INV-0001', notes: 'edited later' });
    await syncNow();
    await whenIdle();
    const last = fake.requests.filter((r) => r.method === 'PUT' && r.path === `/invoices/${ID.a}`).at(-1)!;
    expect(last.body).toMatchObject({ notes: 'edited later' });
    expect(last.headers['x-midnight-sync']).toBeUndefined();
  });

  it('keeps the token out of localStorage keys other than the cloud store', async () => {
    save(ID.a);
    await enableCloudSync();
    await whenIdle();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key !== 'cloud-sync-storage') expect(localStorage.getItem(key)).not.toContain(FAKE_TOKEN);
    }
  });
});

describe('pull', () => {
  beforeEach(connectFake);

  it('applies agent-created invoices with their attribution', async () => {
    fake.server.create(ID.agent, { toName: 'Initech', fromName: 'Ada', lineItems: [{ description: 'Audit', quantity: 1, price: 900 }] });
    await syncNow();
    const inv = local(ID.agent)!;
    expect(inv.toName).toBe('Initech');
    expect(inv.createdBy).toMatchObject({ type: 'agent', agentName: 'Claude Desktop' });
    expect(inv).not.toHaveProperty('total');
    expect(inv).not.toHaveProperty('deletedAt');
  });

  it('pages with next, applies idempotently and stores syncedAt only after the last page', async () => {
    fake.state.pageSize = 2;
    for (const [i, id] of [ID.a, ID.b, ID.c].entries()) {
      fake.server.create(id, { toName: `Client ${i}`, fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    }
    await syncNow();

    const lists = fake.requests.filter((r) => r.method === 'GET' && r.path === '/invoices');
    expect(lists).toHaveLength(2);
    expect(lists[0].query.get('include_deleted')).toBe('true');
    expect(lists[0].query.get('updated_since')).toBeNull();
    expect(lists[1].query.get('after_id')).toBe(ID.b);
    expect(useInvoiceStore.getState().invoices).toHaveLength(3);
    const cursor = useCloudStore.getState().cursors.invoices!;

    // The inclusive feed may repeat items: applying them again changes nothing.
    fake.state.pageSize = 1000;
    await syncNow();
    const last = fake.requests.filter((r) => r.method === 'GET' && r.path === '/invoices').slice(-1)[0]!;
    expect(last.query.get('updated_since')).toBe(cursor);
    expect(useInvoiceStore.getState().invoices).toHaveLength(3);
  });

  it('does not store the cursor when paging fails midway', async () => {
    fake.state.pageSize = 1;
    fake.server.create(ID.a, { toName: 'A', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    fake.server.create(ID.b, { toName: 'B', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    fake.use((req) => (req.query.get('after_id') ? fake.apiError(500, 'internal_error', 'boom') : undefined));
    await syncNow();
    expect(useCloudStore.getState().cursors.invoices).toBeUndefined();
    expect(useCloudStore.getState().status).toBe('error');
    expect(local(ID.a)).toBeDefined();
  });

  it('applies tombstones: deleted on the server means deleted here', async () => {
    fake.server.create(ID.a, { toName: 'A', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    await syncNow();
    expect(local(ID.a)).toBeDefined();

    fake.server.remove(ID.a);
    await syncNow();
    expect(local(ID.a)).toBeUndefined();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('was deleted by the agent “Claude Desktop”'));
  });

  it('never overwrites local changes that are waiting to be uploaded', async () => {
    fake.server.create(ID.a, { toName: 'A', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    await syncNow();
    fake.state.offline = true;
    save(ID.a, { toName: 'Edited offline' });
    await syncNow();
    fake.state.offline = false;
    fake.use((req) => (req.method === 'PUT' ? fake.apiError(503, 'internal_error', 'busy') : undefined));
    fake.server.update(ID.a, { notes: 'agent note' });
    await syncNow({ force: true });
    expect(local(ID.a)?.toName).toBe('Edited offline');
  });
});

describe('push queue', () => {
  beforeEach(connectFake);

  it('flushes in order and coalesces repeated edits of one invoice', async () => {
    save(ID.a, { invoiceNumber: 'INV-0001' });
    save(ID.b, { invoiceNumber: 'INV-0002' });
    save(ID.a, { invoiceNumber: 'INV-0001', toName: 'Second edit' });
    expect(useCloudStore.getState().queue.map((op) => op.entityId)).toEqual([ID.a, ID.b]);

    await syncNow();
    expect(fake.writes()).toEqual([`PUT /invoices/${ID.a}`, `PUT /invoices/${ID.b}`]);
    expect(fake.server.get(ID.a)?.toName).toBe('Second edit');

    // An edit of an uploaded invoice is guarded by its last known revision.
    save(ID.a, { toName: 'Third edit' });
    useInvoiceStore.getState().deleteInvoice(ID.b);
    await syncNow();
    const [put, del] = fake.requests.slice(-2);
    expect(`${put.method} ${put.path}`).toBe(`PUT /invoices/${ID.a}`);
    expect(put.headers['if-match']).toBe('"1"');
    expect(`${del.method} ${del.path}`).toBe(`DELETE /invoices/${ID.b}`);
    expect(del.headers['if-match']).toBe('"1"');
    expect(fake.server.get(ID.b)?.deletedAt).not.toBeNull();
    expect(useCloudStore.getState().queue).toEqual([]);
  });

  it('a never-uploaded invoice deleted before syncing makes no requests', async () => {
    fake.state.offline = true;
    save(ID.a);
    useInvoiceStore.getState().deleteInvoice(ID.a);
    expect(useCloudStore.getState().queue).toEqual([]);
  });

  it('keeps changes made offline, persists them, and uploads them when back online', async () => {
    fake.state.offline = true;
    save(ID.a, { toName: 'Offline client' });
    await syncNow();

    const cloud = useCloudStore.getState();
    expect(cloud.status).toBe('offline');
    expect(cloud.queue).toHaveLength(1);
    expect(cloud.queue[0].attempts).toBe(0); // the pull failed first; the op was not even tried
    const persisted = JSON.parse(localStorage.getItem('cloud-sync-storage')!);
    expect(persisted.state.queue).toHaveLength(1);
    expect(local(ID.a)?.toName).toBe('Offline client');

    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.get(ID.a)?.toName).toBe('Offline client');
    expect(useCloudStore.getState().queue).toEqual([]);
    expect(useCloudStore.getState().status).toBe('synced');
  });

  it('backs off on transient errors (Retry-After) and stops the queue at the failing entry', async () => {
    save(ID.a);
    save(ID.b, { invoiceNumber: 'INV-0002' });
    let calls = 0;
    const undo = fake.use((req) => {
      if (req.method === 'PUT' && req.path === `/invoices/${ID.a}` && calls++ === 0) {
        return fake.apiError(429, 'rate_limited', 'Too many requests, slow down', undefined, { 'retry-after': '30' });
      }
      return undefined;
    });
    const before = Date.now();
    await syncNow();
    const queue = useCloudStore.getState().queue;
    expect(queue.map((op) => op.entityId)).toEqual([ID.a, ID.b]);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].notBefore).toBeGreaterThanOrEqual(before + 30_000);
    expect(fake.writes()).toEqual([`PUT /invoices/${ID.a}`]); // B waits behind A
    expect(useCloudStore.getState().status).toBe('error');
    expect(useCloudStore.getState().lastError).toContain('Try again in 30 seconds');

    // An automatic cycle respects the backoff; a manual retry does not.
    await syncNow();
    expect(fake.writes()).toHaveLength(1);
    undo();
    await syncNow({ force: true });
    expect(fake.server.get(ID.b)).toBeDefined();
    expect(useCloudStore.getState().queue).toEqual([]);
  });

  it('marks invoices the server rejects as not synced and continues with the rest', async () => {
    save(ID.a, { fromName: '' }); // fails the server's validation
    save(ID.b, { invoiceNumber: 'INV-0002' });
    await syncNow();
    expect(fake.server.get(ID.a)).toBeUndefined();
    expect(fake.server.get(ID.b)).toBeDefined();
    expect(useCloudStore.getState().syncErrors[ID.a]).toContain('Your name/company is required');
    expect(useCloudStore.getState().queue).toEqual([]);
    expect(local(ID.a)).toBeDefined();
    expect(toast.error).toHaveBeenCalledWith('INV-0001 could not be synced', expect.anything());

    // Editing it queues it again.
    save(ID.a, { fromName: 'Ada Ltd' });
    expect(useCloudStore.getState().syncErrors[ID.a]).toBeUndefined();
    await syncNow();
    expect(fake.server.get(ID.a)).toBeDefined();
  });

  it('410 on upload: the invoice was deleted elsewhere, so the local copy is dropped', async () => {
    fake.server.create(ID.a, { toName: 'A', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    await syncNow();
    save(ID.a, { toName: 'My edit' });
    fake.server.remove(ID.a);
    // Deliver the PUT before the feed shows the tombstone.
    fake.use((req) => (req.method === 'GET' && req.path === '/invoices' ? fake.json(200, { invoices: [], syncedAt: '2026-11-17T09:00:00.000Z', hasMore: false, next: null }) : undefined));
    await syncNow();
    expect(fake.requests.some((r) => r.method === 'PUT')).toBe(true);
    expect(local(ID.a)).toBeUndefined();
    expect(useCloudStore.getState().queue).toEqual([]);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('was deleted elsewhere'), expect.anything());
  });

  it('a tombstone in the feed discards unsynced local edits and tells the user', async () => {
    fake.server.create(ID.a, { invoiceNumber: 'INV-0009', toName: 'A', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    await syncNow();
    fake.state.offline = true;
    save(ID.a, { invoiceNumber: 'INV-0009', toName: 'My edit' });
    await syncNow();
    fake.state.offline = false;
    fake.server.remove(ID.a);
    await syncNow({ force: true });
    expect(local(ID.a)).toBeUndefined();
    expect(fake.writes()).toEqual([]);
    expect(toast.warning).toHaveBeenCalledWith('INV-0009 was deleted by the agent “Claude Desktop”', expect.anything());
  });

  it('401: marks the browser disconnected and keeps local data', async () => {
    save(ID.a);
    fake.state.tokenValid = false;
    await syncNow();
    const cloud = useCloudStore.getState();
    expect(cloud.token).toBeNull();
    expect(cloud.disconnectedReason).toBe('token_rejected');
    expect(cloud.status).toBe('disconnected');
    expect(cloud.queue).toEqual([]);
    expect(local(ID.a)).toBeDefined();
    expect(toast.error).toHaveBeenCalledWith('Disconnected from the cloud workspace', expect.anything());
    // Not echoed anywhere visible.
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(FAKE_TOKEN);
  });
});

describe('412 conflict resolution (three-way merge, server wins per field)', () => {
  beforeEach(connectFake);

  async function syncedInvoice() {
    fake.server.create(ID.a, {
      invoiceNumber: 'INV-0005',
      invoiceName: 'Website',
      toName: 'Globex',
      fromName: 'Ada',
      lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, price: 100 }],
    });
    await syncNow();
    // Go offline so the next local edit is not pulled-over before the push.
    fake.state.offline = true;
  }

  it('merges edits of different fields and tells the user', async () => {
    await syncedInvoice();
    const inv = local(ID.a)!;
    useInvoiceStore.getState().saveInvoice({ ...inv, toName: 'Globex GmbH' }, ID.a);
    fake.server.update(ID.a, { notes: 'Net 30' }); // agent edit, revision 2
    fake.state.offline = false;
    await syncNow({ force: true });

    const puts = fake.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['if-match'])).toEqual(['"1"', '"2"']);
    expect(fake.server.get(ID.a)).toMatchObject({ toName: 'Globex GmbH', notes: 'Net 30', revision: 3 });
    expect(local(ID.a)).toMatchObject({ toName: 'Globex GmbH', notes: 'Net 30', revision: 3 });
    expect(toast.info).toHaveBeenCalledWith('INV-0005 was also changed by the agent “Claude Desktop”', expect.anything());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('keeps the server value for a field both changed, and says so', async () => {
    await syncedInvoice();
    const inv = local(ID.a)!;
    useInvoiceStore.getState().saveInvoice({ ...inv, toName: 'Mine', notes: 'my note' }, ID.a);
    fake.server.update(ID.a, { toName: 'Theirs' });
    fake.state.offline = false;
    await syncNow({ force: true });

    expect(fake.server.get(ID.a)).toMatchObject({ toName: 'Theirs', notes: 'my note' });
    expect(local(ID.a)).toMatchObject({ toName: 'Theirs', notes: 'my note' });
    expect(toast.warning).toHaveBeenCalledWith('Some of your changes to INV-0005 were not applied', {
      description: 'The agent “Claude Desktop” changed the client name at the same time; the newer version was kept.',
    });
  });

  it('adopts the server copy without a write when nothing of ours survives the merge', async () => {
    await syncedInvoice();
    const inv = local(ID.a)!;
    useInvoiceStore.getState().saveInvoice({ ...inv, toName: 'Mine' }, ID.a);
    fake.server.update(ID.a, { toName: 'Theirs' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(local(ID.a)).toMatchObject({ toName: 'Theirs', revision: 2 });
    expect(useCloudStore.getState().queue).toEqual([]);
  });

  it('a delete of an invoice someone changed meanwhile restores the newer version', async () => {
    await syncedInvoice();
    useInvoiceStore.getState().deleteInvoice(ID.a);
    fake.server.update(ID.a, { notes: 'agent was here' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.get(ID.a)?.deletedAt).toBeNull();
    expect(local(ID.a)).toMatchObject({ notes: 'agent was here', revision: 2 });
    expect(toast.warning).toHaveBeenCalledWith('INV-0005 was kept', expect.anything());
  });
});

describe('settings', () => {
  beforeEach(connectFake);

  it('uploads default settings when they change (drafts are never uploaded)', async () => {
    await syncNow();
    useSettingsStore.getState().updateSettings({ fromName: 'Ada Ltd' });
    useInvoiceStore.getState().saveDraft(ID.c, form());
    await syncNow();
    expect(fake.writes()).toEqual(['PUT /settings']);
    expect(fake.state.settings.settings.fromName).toBe('Ada Ltd');
  });

  it('pulls saved settings from the server without echoing them back', async () => {
    fake.state.settings = { settings: { ...DEFAULT_SETTINGS, fromName: 'From server' }, updatedAt: '2026-11-17T09:00:00.000Z' };
    await syncNow({ pullSettings: true });
    expect(useSettingsStore.getState().settings.fromName).toBe('From server');
    expect(useCloudStore.getState().queue).toEqual([]);
  });
});

describe('workspace lifecycle', () => {
  it('connects an existing workspace with a recovery key: server settings win, local invoices are added', async () => {
    fake.state.settings = { settings: { ...DEFAULT_SETTINGS, fromName: 'Server Ada' }, updatedAt: '2026-11-17T09:00:00.000Z' };
    fake.server.create(ID.b, { toName: 'Remote', fromName: 'Ada', lineItems: [{ description: 'x', quantity: 1, price: 1 }] });
    save(ID.a);

    await connectExistingWorkspace(`  ${FAKE_TOKEN}  `);
    await whenIdle();
    expect(useCloudStore.getState().token).toBe(FAKE_TOKEN);
    expect(useSettingsStore.getState().settings.fromName).toBe('Server Ada');
    expect(local(ID.b)?.toName).toBe('Remote');
    expect(fake.server.get(ID.a)).toBeDefined();
    expect(fake.writes()).not.toContain('PUT /settings');
  });

  it('rejects malformed or unknown recovery keys without storing them', async () => {
    await expect(connectExistingWorkspace('hello')).rejects.toThrow(/not a valid recovery key/);
    fake.state.tokenValid = false;
    await expect(connectExistingWorkspace(FAKE_TOKEN)).rejects.toThrow(/was not accepted/);
    expect(useCloudStore.getState().token).toBeNull();
    expect(useCloudStore.getState().disconnectedReason).toBeNull();
  });

  it('disconnecting this browser keeps local invoices but forgets the token and revisions', async () => {
    connectFake();
    save(ID.a);
    await syncNow();
    expect(local(ID.a)?.revision).toBe(1);
    await disconnectThisBrowser();
    expect(useCloudStore.getState()).toMatchObject({ token: null, status: 'disabled', queue: [] });
    expect(local(ID.a)).toBeDefined();
    expect(local(ID.a)?.revision).toBeUndefined();
    expect(local(ID.a)?.createdBy).toEqual({ type: 'user' });
  });

  it('deleting the cloud workspace calls DELETE /workspace and keeps local copies', async () => {
    connectFake();
    save(ID.a);
    await syncNow();
    await deleteCloudWorkspace();
    expect(fake.writes()).toContain('DELETE /workspace');
    expect(useCloudStore.getState()).toMatchObject({ token: null, status: 'disabled' });
    expect(local(ID.a)).toBeDefined();
  });
});
