import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { InvoiceFormData } from '@/types/invoice';
import type { TemplateFormData } from '../../../shared/types/template';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { resetSyncEngineForTests, startCloudSync, syncNow, whenIdle } from './engine';
import { enableCloudSync } from './cloudActions';
import { syncKey } from './collectionNames';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const ID = {
  globex: '00000000-0000-4000-8000-0000000000c1',
  retainer: '00000000-0000-4000-8000-0000000000f1',
  workshop: '00000000-0000-4000-8000-0000000000f2',
  inv1: '00000000-0000-4000-8000-0000000000a1',
};

const RETAINER: TemplateFormData = {
  name: 'Monthly retainer',
  description: '',
  clientId: null,
  lineItems: [{ id: 'tl-1', description: 'Retainer {{month_name}}', quantity: 1, price: 2000 }],
  taxRate: null,
  currency: null,
  notes: 'Thanks!',
  paymentDetails: '',
  paymentTermsDays: 14,
  invoiceNamePattern: 'Retainer {{month_name}} {{year}}',
};

function invoiceForm(overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0001',
    invoiceName: 'Retainer March 2026',
    issueDate: '2026-03-01',
    dueDate: '',
    fromName: 'Ada Ltd',
    fromAddress: '',
    fromEmail: '',
    toName: 'Globex',
    toAddress: '',
    toEmail: '',
    lineItems: [{ id: 'li-1', description: 'Retainer March', quantity: 1, price: 2000 }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'EUR',
    ...overrides,
  };
}

const local = (id: string) => useTemplateStore.getState().templates.find((t) => t.id === id);
const saveTemplate = (id: string, data: Partial<TemplateFormData> = {}) => useTemplateStore.getState().saveTemplate({ ...RETAINER, ...data }, id);

let fake: FakeApi;
let stop: () => void;

function connectFake() {
  useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle' });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.warning).mockClear();
  useInvoiceStore.setState({ invoices: [], drafts: {} });
  useClientStore.setState({ clients: [] });
  useTemplateStore.setState({ templates: [] });
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

describe('templates are local-first', () => {
  it('saving, archiving and deleting templates without cloud sync makes no requests', async () => {
    saveTemplate(ID.retainer);
    useTemplateStore.getState().setArchived(ID.retainer, true);
    expect(local(ID.retainer)?.archivedAt).toEqual(expect.any(String));
    useTemplateStore.getState().deleteTemplate(ID.retainer);
    await syncNow();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(useCloudStore.getState().queue).toEqual([]);
  });
});

describe('templates as the third synced collection', () => {
  it('enable cloud sync uploads clients, then templates, then invoices (pull order too)', async () => {
    // Created in reverse dependency order: invoice, then the template, then the client both reference.
    useInvoiceStore.getState().saveInvoice(invoiceForm({ clientId: ID.globex, templateId: ID.retainer }), ID.inv1);
    saveTemplate(ID.retainer, { clientId: ID.globex });
    useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: '' }, ID.globex);

    await enableCloudSync();
    await whenIdle();

    expect(fake.writes()).toEqual(['POST /workspaces', 'PUT /settings', `PUT /clients/${ID.globex}`, `PUT /templates/${ID.retainer}`, `PUT /invoices/${ID.inv1}`]);
    expect(fake.requests.filter((r) => r.method === 'GET' && r.path !== '/settings').map((r) => r.path)).toEqual(['/clients', '/templates', '/invoices']);
    expect(fake.server.getTemplate(ID.retainer)).toMatchObject({ name: RETAINER.name, clientId: ID.globex, paymentTermsDays: 14, revision: 1 });
    expect(fake.server.getTemplate(ID.retainer)!.lineItems).toEqual([{ id: 'tl-1', description: 'Retainer {{month_name}}', quantity: 1, price: 2000 }]);
    expect(fake.server.get(ID.inv1)).toMatchObject({ clientId: ID.globex, templateId: ID.retainer });
    expect(local(ID.retainer)).toMatchObject({ revision: 1, createdBy: { type: 'user' } });
    expect(useCloudStore.getState().cursors).toEqual({ clients: expect.any(String), templates: expect.any(String), invoices: expect.any(String) });
  });

  it('a template edited after joining moves its client upload ahead of it', async () => {
    connectFake();
    await syncNow();
    useClientStore.getState().saveClient({ name: 'Globex', email: '', address: '' }, ID.globex);
    saveTemplate(ID.retainer, { clientId: ID.globex });
    // Reorder the queue so the template comes first; the engine must still send the client first.
    useCloudStore.setState((s) => ({ queue: [...s.queue].reverse() }));
    await syncNow();
    await whenIdle();
    expect(fake.writes()).toEqual([`PUT /clients/${ID.globex}`, `PUT /templates/${ID.retainer}`]);
  });

  it('a reference to a client deleted locally is left out of the upload', async () => {
    connectFake();
    useClientStore.getState().saveClient({ name: 'Gone', email: '', address: '' }, ID.globex);
    useClientStore.getState().deleteClient(ID.globex);
    saveTemplate(ID.retainer, { clientId: ID.globex });
    await syncNow();
    await whenIdle();
    expect(fake.server.getTemplate(ID.retainer)).toMatchObject({ clientId: null, revision: 1 });
    expect(useCloudStore.getState().syncErrors).toEqual({});
  });

  it('pulls templates an agent created, applies edits and tombstones', async () => {
    connectFake();
    fake.server.createTemplate(ID.workshop, { name: 'Workshop', lineItems: [{ description: 'Half day', quantity: 1, price: 900 }] });
    await syncNow();
    expect(local(ID.workshop)).toMatchObject({ name: 'Workshop', revision: 1, createdBy: { type: 'agent', agentName: 'Claude Desktop' } });

    fake.server.updateTemplate(ID.workshop, { name: 'Workshop (full day)' });
    await syncNow();
    expect(local(ID.workshop)).toMatchObject({ name: 'Workshop (full day)', revision: 2 });

    fake.server.removeTemplate(ID.workshop);
    await syncNow();
    expect(local(ID.workshop)).toBeUndefined();
    expect(fake.writes()).toEqual([]);
  });

  it('local deletes are sent with If-Match', async () => {
    connectFake();
    saveTemplate(ID.retainer);
    await syncNow();
    await whenIdle();
    useTemplateStore.getState().deleteTemplate(ID.retainer);
    await syncNow();
    await whenIdle();
    const del = fake.requests.find((r) => r.method === 'DELETE');
    expect(del).toMatchObject({ path: `/templates/${ID.retainer}`, headers: expect.objectContaining({ 'if-match': '"1"' }) });
    expect(fake.server.getTemplate(ID.retainer)?.deletedAt).toEqual(expect.any(String));
  });

  it('412: non-overlapping edits are merged; an edit of the same field keeps the server value and tells the user', async () => {
    connectFake();
    saveTemplate(ID.retainer);
    await syncNow();
    await whenIdle();

    // An agent renames it while this browser changes the notes.
    fake.server.updateTemplate(ID.retainer, { name: 'Retainer (agent)' });
    saveTemplate(ID.retainer, { notes: 'New notes' });
    await whenIdle();
    await syncNow();
    await whenIdle();
    expect(fake.server.getTemplate(ID.retainer)).toMatchObject({ name: 'Retainer (agent)', notes: 'New notes' });
    expect(local(ID.retainer)).toMatchObject({ name: 'Retainer (agent)', notes: 'New notes' });
    expect(toast.info).toHaveBeenCalledWith('Template “Monthly retainer” was also changed by the agent “Claude Desktop”', { description: 'Both sets of changes were kept.' });

    // Both change the line items: the server's lines win.
    fake.server.updateTemplate(ID.retainer, { lineItems: [{ id: 'srv', description: 'Server line', quantity: 1, price: 1 }] });
    saveTemplate(ID.retainer, { name: 'Retainer (agent)', notes: 'New notes', lineItems: [{ id: 'loc', description: 'Local line', quantity: 1, price: 2 }] });
    await whenIdle();
    await syncNow();
    await whenIdle();
    expect(local(ID.retainer)!.lineItems.map((l) => l.description)).toEqual(['Server line']);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('were not applied'), expect.objectContaining({ description: expect.stringContaining('line items') }));
  });

  it('a template the server refuses is marked not synced under its own key', async () => {
    connectFake();
    fake.use((req) => (req.method === 'PUT' && req.path.startsWith('/templates/') ? fake.apiError(400, 'validation_failed', 'Request validation failed', [{ path: 'name', message: 'Too long' }]) : undefined));
    saveTemplate(ID.retainer);
    await syncNow();
    await whenIdle();
    expect(Object.keys(useCloudStore.getState().syncErrors)).toEqual([syncKey('templates', ID.retainer)]);
  });
});
