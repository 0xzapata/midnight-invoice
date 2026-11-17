import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { InvoiceFormData } from '@/types/invoice';
import type { ClientFormData } from '../../../shared/types/client';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { resetSyncEngineForTests, startCloudSync, syncNow, whenIdle } from './engine';
import { connectExistingWorkspace, disconnectThisBrowser, enableCloudSync } from './cloudActions';
import { syncKey } from './collectionNames';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = {
  globex: '00000000-0000-4000-8000-0000000000c1',
  initech: '00000000-0000-4000-8000-0000000000c2',
  inv1: '00000000-0000-4000-8000-0000000000a1',
  inv2: '00000000-0000-4000-8000-0000000000a2',
};

const GLOBEX: ClientFormData = { name: 'Globex', email: 'ap@globex.example', address: '1 Globex Way' };

function invoiceForm(overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0001',
    invoiceName: 'Work',
    issueDate: '2026-11-01',
    dueDate: '',
    fromName: 'Ada Ltd',
    fromAddress: '',
    fromEmail: '',
    toName: 'Globex',
    toAddress: '1 Globex Way',
    toEmail: 'ap@globex.example',
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, price: 100 }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'EUR',
    ...overrides,
  };
}

const localClient = (id: string) => useClientStore.getState().clients.find((c) => c.id === id);
const localInvoice = (id: string) => useInvoiceStore.getState().invoices.find((i) => i.id === id);
const saveClient = (id: string, data: Partial<ClientFormData> = {}) => useClientStore.getState().saveClient({ ...GLOBEX, ...data }, id);
const saveInvoice = (id: string, overrides: Partial<InvoiceFormData> = {}) => useInvoiceStore.getState().saveInvoice(invoiceForm(overrides), id);

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

describe('clients are local-first', () => {
  it('saving clients without cloud sync makes no requests', async () => {
    saveClient(ID.globex);
    useClientStore.getState().setArchived(ID.globex, true);
    useClientStore.getState().deleteClient(ID.globex);
    await syncNow();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(useCloudStore.getState().queue).toEqual([]);
  });
});

describe('uploading when joining a workspace', () => {
  it('enable cloud sync uploads clients before the invoices that reference them', async () => {
    // The invoice is older than the client it references.
    saveInvoice(ID.inv1, { clientId: ID.globex });
    saveClient(ID.globex);
    saveClient(ID.initech, { name: 'Initech', email: '' });

    await enableCloudSync();
    await whenIdle();

    expect(fake.writes()).toEqual([
      'POST /workspaces',
      'PUT /settings',
      `PUT /clients/${ID.globex}`,
      `PUT /clients/${ID.initech}`,
      `PUT /invoices/${ID.inv1}`,
    ]);
    const puts = fake.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/clients/'));
    expect(puts.every((r) => r.headers['if-none-match'] === '*')).toBe(true);
    expect(fake.server.getClient(ID.globex)).toMatchObject({ name: 'Globex', email: 'ap@globex.example', revision: 1 });
    expect(fake.server.get(ID.inv1)?.clientId).toBe(ID.globex);
    expect(localClient(ID.globex)).toMatchObject({ revision: 1, createdBy: { type: 'user' } });
    expect(localInvoice(ID.inv1)).toMatchObject({ revision: 1, clientId: ID.globex });
    expect(useCloudStore.getState().cursors).toEqual({ clients: expect.any(String), templates: expect.any(String), invoices: expect.any(String) });
    expect(useCloudStore.getState().status).toBe('synced');
  });

  it('connect existing workspace pulls the workspace’s clients and adds local ones', async () => {
    fake.server.createClient(ID.initech, { name: 'Initech', email: 'billing@initech.example' });
    saveClient(ID.globex);
    await connectExistingWorkspace(FAKE_TOKEN);
    await whenIdle();
    expect(localClient(ID.initech)).toMatchObject({ name: 'Initech', createdBy: { type: 'agent', agentName: 'Claude Desktop' } });
    expect(localClient(ID.initech)).not.toHaveProperty('deletedAt');
    expect(fake.server.getClient(ID.globex)?.name).toBe('Globex');
  });

  it('disconnecting keeps local clients but forgets their revisions', async () => {
    connectFake();
    saveClient(ID.globex);
    await syncNow();
    expect(localClient(ID.globex)?.revision).toBe(1);
    await disconnectThisBrowser();
    expect(localClient(ID.globex)).toBeDefined();
    expect(localClient(ID.globex)?.revision).toBeUndefined();
  });
});

describe('pull', () => {
  beforeEach(connectFake);

  it('applies agent-created clients, pages with next and stores the clients cursor only after the last page', async () => {
    fake.state.pageSize = 1;
    fake.server.createClient(ID.globex, { name: 'Globex' });
    fake.server.createClient(ID.initech, { name: 'Initech' });
    await syncNow();
    const lists = fake.requests.filter((r) => r.method === 'GET' && r.path === '/clients');
    expect(lists).toHaveLength(2);
    expect(lists[0].query.get('include_deleted')).toBe('true');
    expect(lists[1].query.get('after_id')).toBe(ID.globex);
    expect(useClientStore.getState().clients.map((c) => c.name).sort()).toEqual(['Globex', 'Initech']);
    const cursor = useCloudStore.getState().cursors.clients!;
    expect(cursor).toEqual(expect.any(String));

    fake.state.pageSize = 1000;
    await syncNow();
    const last = fake.requests.filter((r) => r.method === 'GET' && r.path === '/clients').slice(-1)[0]!;
    expect(last.query.get('updated_since')).toBe(cursor);
    expect(useClientStore.getState().clients).toHaveLength(2);
  });

  it('applies tombstones: a client deleted on the server is deleted here (invoices keep their copy)', async () => {
    fake.server.createClient(ID.globex, { name: 'Globex', address: '1 Globex Way' });
    await syncNow();
    saveInvoice(ID.inv1, { clientId: ID.globex });
    await syncNow();
    fake.server.removeClient(ID.globex);
    await syncNow();
    expect(localClient(ID.globex)).toBeUndefined();
    expect(localInvoice(ID.inv1)).toMatchObject({ toName: 'Globex', toAddress: '1 Globex Way' });
    expect(toast.info).toHaveBeenCalledWith('Client “Globex” was deleted by the agent “Claude Desktop”');
  });

  it('never overwrites local client edits waiting to be uploaded', async () => {
    fake.server.createClient(ID.globex, { name: 'Globex' });
    await syncNow();
    fake.state.offline = true;
    saveClient(ID.globex, { name: 'Globex (edited offline)' });
    await syncNow();
    fake.state.offline = false;
    fake.use((req) => (req.method === 'PUT' ? fake.apiError(503, 'internal_error', 'busy') : undefined));
    fake.server.updateClient(ID.globex, { notes: 'agent note' });
    await syncNow({ force: true });
    expect(localClient(ID.globex)?.name).toBe('Globex (edited offline)');
  });
});

describe('push', () => {
  beforeEach(connectFake);

  it('keeps clients created offline and uploads them when back online', async () => {
    fake.state.offline = true;
    saveClient(ID.globex);
    await syncNow();
    expect(useCloudStore.getState().status).toBe('offline');
    const persisted = JSON.parse(localStorage.getItem('cloud-sync-storage')!);
    expect(persisted.version).toBe(2);
    expect(persisted.state.queue).toEqual([expect.objectContaining({ type: 'upsert', collection: 'clients', entityId: ID.globex })]);
    expect(JSON.parse(localStorage.getItem('client-storage')!).state.clients[0].name).toBe('Globex');

    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.getClient(ID.globex)?.name).toBe('Globex');
    expect(useCloudStore.getState().queue).toEqual([]);
    expect(useCloudStore.getState().status).toBe('synced');
  });

  it('an invoice queued before the new client it references is uploaded after it (dependency first)', async () => {
    fake.state.offline = true;
    saveInvoice(ID.inv1); // queued first, no client yet
    saveClient(ID.globex); // created later in the form ("Save as client")…
    saveInvoice(ID.inv1, { clientId: ID.globex }); // …and linked: the invoice's entry keeps its earlier position
    expect(useCloudStore.getState().queue.map((op) => `${op.collection}:${op.entityId}`)).toEqual([`invoices:${ID.inv1}`, `clients:${ID.globex}`]);
    await syncNow();

    fake.state.offline = false;
    await syncNow({ force: true });
    // The fake rejects an unknown clientId (like the server), so this order is required.
    expect(fake.writes()).toEqual([`PUT /clients/${ID.globex}`, `PUT /invoices/${ID.inv1}`]);
    expect(fake.server.get(ID.inv1)?.clientId).toBe(ID.globex);
    expect(useCloudStore.getState().syncErrors).toEqual({});
  });

  it('a reference to a client deleted before it was ever uploaded is left out of the upload', async () => {
    fake.state.offline = true;
    saveClient(ID.globex);
    saveInvoice(ID.inv1, { clientId: ID.globex });
    useClientStore.getState().deleteClient(ID.globex);
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.writes()).toEqual([`PUT /invoices/${ID.inv1}`]);
    const put = fake.requests.find((r) => r.method === 'PUT')!;
    expect(put.body).not.toHaveProperty('clientId');
    expect(fake.server.get(ID.inv1)).toMatchObject({ toName: 'Globex' });
    expect(useCloudStore.getState().syncErrors).toEqual({});
  });

  it('archive and delete are uploaded with If-Match', async () => {
    saveClient(ID.globex);
    await syncNow();
    useClientStore.getState().setArchived(ID.globex, true);
    await syncNow();
    const put = fake.requests.filter((r) => r.method === 'PUT').slice(-1)[0];
    expect(put.headers['if-match']).toBe('"1"');
    expect(fake.server.getClient(ID.globex)?.archivedAt).toEqual(expect.any(String));
    useClientStore.getState().deleteClient(ID.globex);
    await syncNow();
    const del = fake.requests.slice(-1)[0];
    expect(`${del.method} ${del.path}`).toBe(`DELETE /clients/${ID.globex}`);
    expect(del.headers['if-match']).toBe('"2"');
    expect(fake.server.getClient(ID.globex)?.deletedAt).not.toBeNull();
  });

  it('marks clients the server rejects as not synced and continues with the rest', async () => {
    saveClient(ID.globex, { name: '   ' });
    saveClient(ID.initech, { name: 'Initech' });
    await syncNow();
    expect(useCloudStore.getState().syncErrors[syncKey('clients', ID.globex)]).toContain('Client name is required');
    expect(fake.server.getClient(ID.initech)).toBeDefined();
    expect(toast.error).toHaveBeenCalledWith('Client “Unnamed” could not be synced', expect.anything());
  });

  it('410 on upload: a client deleted elsewhere is dropped locally', async () => {
    fake.server.createClient(ID.globex, { name: 'Globex' });
    await syncNow();
    saveClient(ID.globex, { name: 'Mine' });
    fake.server.removeClient(ID.globex);
    fake.use((req) => (req.method === 'GET' && req.path === '/clients' ? fake.json(200, { clients: [], syncedAt: '2026-11-17T09:00:00.000Z', hasMore: false, next: null }) : undefined));
    await syncNow();
    expect(localClient(ID.globex)).toBeUndefined();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('was deleted elsewhere'), {
      description: 'Your unsynced changes to it were discarded. Deleted clients stay deleted.',
    });
  });
});

describe('412 conflict resolution for clients', () => {
  beforeEach(connectFake);

  async function syncedClient() {
    fake.server.createClient(ID.globex, { name: 'Globex', email: 'ap@globex.example', address: '1 Globex Way' });
    await syncNow();
    fake.state.offline = true;
  }

  it('merges edits of different fields', async () => {
    await syncedClient();
    saveClient(ID.globex, { address: 'New street 2' });
    fake.server.updateClient(ID.globex, { notes: 'Net 30' });
    fake.state.offline = false;
    await syncNow({ force: true });
    const puts = fake.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['if-match'])).toEqual(['"1"', '"2"']);
    expect(fake.server.getClient(ID.globex)).toMatchObject({ address: 'New street 2', notes: 'Net 30', revision: 3 });
    expect(localClient(ID.globex)).toMatchObject({ address: 'New street 2', notes: 'Net 30', revision: 3 });
    expect(toast.info).toHaveBeenCalledWith('Client “Globex” was also changed by the agent “Claude Desktop”', expect.anything());
  });

  it('keeps the server value for a field both changed, and says so', async () => {
    await syncedClient();
    saveClient(ID.globex, { email: 'mine@globex.example', address: 'Mine 1' });
    fake.server.updateClient(ID.globex, { email: 'theirs@globex.example' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.getClient(ID.globex)).toMatchObject({ email: 'theirs@globex.example', address: 'Mine 1' });
    expect(toast.warning).toHaveBeenCalledWith('Some of your changes to Client “Globex” were not applied', {
      description: 'The agent “Claude Desktop” changed the email at the same time; the newer version was kept.',
    });
  });

  it('a delete of a client someone changed meanwhile restores the newer version', async () => {
    await syncedClient();
    useClientStore.getState().deleteClient(ID.globex);
    fake.server.updateClient(ID.globex, { notes: 'agent was here' });
    fake.state.offline = false;
    await syncNow({ force: true });
    expect(fake.server.getClient(ID.globex)?.deletedAt).toBeNull();
    expect(localClient(ID.globex)).toMatchObject({ notes: 'agent was here', revision: 2 });
    expect(toast.warning).toHaveBeenCalledWith('Client “Globex” was kept', expect.anything());
  });
});

describe('401', () => {
  it('disconnects and keeps local clients', async () => {
    connectFake();
    saveClient(ID.globex);
    fake.state.tokenValid = false;
    await syncNow();
    expect(useCloudStore.getState()).toMatchObject({ token: null, status: 'disconnected', queue: [] });
    expect(localClient(ID.globex)).toBeDefined();
  });
});
