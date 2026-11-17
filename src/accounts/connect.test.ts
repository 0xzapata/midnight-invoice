import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceFormData } from '@/types/invoice';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useClientStore } from '@/stores/useClientStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import type { TemplateFormData } from '../../shared/types/template';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCloudStore } from '@/stores/useCloudStore';
import { EMPTY_CLOUD_STATE } from '@/lib/storageMigrations';
import { resetSyncEngineForTests, startCloudSync, whenIdle } from '@/lib/sync/engine';
import { createFakeApi, FAKE_TOKEN, type FakeApi } from '@/test/fakeApi';
import { installFakeAccounts } from '@/test/fakeAccounts';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { setAccountCsrfToken } from './api';
import { executePlan, localSituation, planConnection, signOutThisBrowser, type LocalSituation } from './connect';
import { useAccountStore } from './useAccountStore';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const user = { id: 'u1', email: 'alice@example.com', name: null, createdAt: 1 };
const ws = (id: string) => ({ id, createdAt: '2026-11-17T09:00:00.000Z', recoveryKeyEnabled: true });
const none = { invoices: 0, clients: 0, templates: 0 };
const situation = (p: Partial<LocalSituation>): LocalSituation => ({ token: null, workspaceId: null, linkedUserId: null, counts: none, ...p });

describe('planConnection (new-device and conflict rules)', () => {
  it('creates or claims when the account has no workspace', () => {
    expect(planConnection({ user, workspace: null }, situation({}))).toEqual({ kind: 'create' });
    expect(planConnection({ user, workspace: null }, situation({ counts: { invoices: 3, clients: 1, templates: 0 } }))).toEqual({ kind: 'create' });
    expect(planConnection({ user, workspace: null }, situation({ token: 'mi_ws_x', workspaceId: 'V' }))).toEqual({ kind: 'claim' });
    // A device token of another account cannot be claimed: ask before creating a new workspace.
    expect(planConnection({ user, workspace: null }, situation({ token: 'mi_ws_x', workspaceId: 'V', linkedUserId: 'u2', counts: { invoices: 2, clients: 0, templates: 0 } }))).toEqual({
      kind: 'switch-workspace',
      target: 'new',
      counts: { invoices: 2, clients: 0, templates: 0 },
    });
  });

  it('joins, rebinds, or asks when the account has a workspace', () => {
    const s = { user, workspace: ws('W') };
    expect(planConnection(s, situation({}))).toEqual({ kind: 'join' });
    expect(planConnection(s, situation({ counts: { invoices: 2, clients: 0, templates: 0 } }))).toEqual({ kind: 'merge-local', counts: { invoices: 2, clients: 0, templates: 0 } });
    expect(planConnection(s, situation({ counts: { invoices: 0, clients: 1, templates: 0 } })).kind).toBe('merge-local');
    expect(planConnection(s, situation({ token: 'mi_ws_x', workspaceId: 'W' }))).toEqual({ kind: 'rebind' });
    expect(planConnection(s, situation({ token: 'mi_ws_x', workspaceId: 'V', counts: { invoices: 1, clients: 0, templates: 0 } }))).toEqual({
      kind: 'switch-workspace',
      target: 'existing',
      counts: { invoices: 1, clients: 0, templates: 0 },
    });
  });
});

function form(overrides: Partial<InvoiceFormData> = {}): InvoiceFormData {
  return {
    invoiceNumber: 'INV-0001',
    invoiceName: '',
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

describe('executePlan against the fake API', () => {
  let fake: FakeApi;
  let accounts: ReturnType<typeof installFakeAccounts>;
  let stop: () => void;
  beforeEach(() => {
    localStorage.clear();
    useInvoiceStore.setState({ invoices: [], drafts: {} });
    useClientStore.setState({ clients: [] });
    useTemplateStore.setState({ templates: [] });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, status: 'disabled', lastError: null, lastSyncedAt: null });
    useAccountStore.setState({ linked: null });
    fake = createFakeApi();
    accounts = installFakeAccounts(fake);
    vi.stubGlobal('fetch', fake.fetch);
    setAccountCsrfToken('csrf-1');
    stop = startCloudSync();
  });
  afterEach(async () => {
    await whenIdle().catch(() => undefined);
    stop();
    resetSyncEngineForTests();
    vi.unstubAllGlobals();
  });

  it('claim: keeps the workspace, queue and cursors, swaps only the token for a device token', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: fake.state.workspace, token: FAKE_TOKEN, status: 'idle', cursors: { invoices: '2026-11-17T09:30:00.000Z' } });
    accounts.signIn();
    const local = localSituation();
    const plan = planConnection({ user: accounts.acc.user!, workspace: null }, local);
    expect(plan).toEqual({ kind: 'claim' });
    expect(await executePlan({ user: accounts.acc.user! }, plan)).toBe('claimed');
    const cloud = useCloudStore.getState();
    expect(cloud.token).toMatch(/^mi_ws_device/);
    expect(cloud.workspace?.id).toBe('ws-1');
    expect(cloud.cursors).toEqual({ invoices: '2026-11-17T09:30:00.000Z' });
    expect(useAccountStore.getState().linked).toMatchObject({ email: 'alice@example.com', workspaceId: 'ws-1' });
    // The claim request carried the old token only in the Authorization header.
    const claim = fake.requests.find((r) => r.path === '/api/account/workspace/claim')!;
    expect(claim.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(claim.query.toString()).toBe('');
  });

  it('merge-local: uploads local-only invoices into the account workspace', async () => {
    useInvoiceStore.getState().saveInvoice(form({ invoiceNumber: 'INV-0042' }), '00000000-0000-4000-8000-000000000042');
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    const plan = planConnection({ user: accounts.acc.user!, workspace: accounts.acc.workspace }, localSituation());
    expect(plan).toEqual({ kind: 'merge-local', counts: { invoices: 1, clients: 0, templates: 0 } });
    expect(await executePlan({ user: accounts.acc.user! }, plan)).toBe('merged');
    await whenIdle();
    expect(fake.server.all().map((i) => i.invoiceNumber)).toContain('INV-0042');
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
  });

  it('switch-workspace: forgets the other workspace locally, keeps every invoice and copies it into the account workspace', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: { id: 'ws-other', createdAt: '2026-11-01T00:00:00.000Z' }, token: FAKE_TOKEN, status: 'idle' });
    useInvoiceStore.getState().saveInvoice(form({ invoiceNumber: 'INV-0100' }), '00000000-0000-4000-8000-000000000100');
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    const plan = planConnection({ user: accounts.acc.user!, workspace: accounts.acc.workspace }, localSituation());
    expect(plan.kind).toBe('switch-workspace');
    expect(await executePlan({ user: accounts.acc.user! }, plan)).toBe('switched');
    await whenIdle();
    expect(useCloudStore.getState().workspace?.id).toBe('ws-1');
    expect(fake.server.all().map((i) => i.invoiceNumber)).toContain('INV-0100');
    expect(useInvoiceStore.getState().invoices.map((i) => i.invoiceNumber)).toEqual(['INV-0100']);
  });

  const template = (clientId: string): TemplateFormData =>
    ({
      name: 'Monthly retainer',
      description: '',
      clientId,
      lineItems: [{ id: 'li-1', description: 'Retainer', quantity: 1, price: 900 }],
      taxRate: 0,
      currency: 'EUR',
      notes: '',
      paymentDetails: '',
      paymentTermsDays: 14,
      invoiceNamePattern: '',
    }) as unknown as TemplateFormData;

  it('counts templates as local data and uploads them with their client reference (merge-local)', async () => {
    const client = useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: '' });
    const t = useTemplateStore.getState().saveTemplate(template(client.id));
    // Templates alone are enough to ask before uploading.
    useClientStore.setState({ clients: [] });
    expect(planConnection({ user, workspace: ws('W') }, localSituation())).toEqual({ kind: 'merge-local', counts: { invoices: 0, clients: 0, templates: 1 } });
    useClientStore.setState({ clients: [client] });
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    const plan = planConnection({ user: accounts.acc.user!, workspace: accounts.acc.workspace }, localSituation());
    expect(plan).toEqual({ kind: 'merge-local', counts: { invoices: 0, clients: 1, templates: 1 } });
    await executePlan({ user: accounts.acc.user! }, plan);
    await whenIdle();
    const uploaded = fake.server.allTemplates().find((x) => x.id === t.id)!;
    expect(uploaded).toMatchObject({ name: 'Monthly retainer', clientId: client.id });
    expect(fake.server.getClient(client.id)).toBeDefined();
    // The client went up before the template that references it.
    const order = fake.requests.filter((r) => r.method === 'PUT').map((r) => r.path);
    expect(order.indexOf(`/clients/${client.id}`)).toBeLessThan(order.indexOf(`/templates/${t.id}`));
  });

  it('switch-workspace copies templates too', async () => {
    useCloudStore.setState({ ...EMPTY_CLOUD_STATE, workspace: { id: 'ws-other', createdAt: '2026-11-01T00:00:00.000Z' }, token: FAKE_TOKEN, status: 'idle' });
    const client = useClientStore.getState().saveClient({ name: 'Initech', email: 'ap@initech.example', address: '' });
    const t = useTemplateStore.getState().saveTemplate(template(client.id));
    accounts.signIn('alice@example.com', { ...fake.state.workspace, recoveryKeyEnabled: false });
    const plan = planConnection({ user: accounts.acc.user!, workspace: accounts.acc.workspace }, localSituation());
    expect(plan).toMatchObject({ kind: 'switch-workspace', counts: { templates: 1, clients: 1 } });
    expect(await executePlan({ user: accounts.acc.user! }, plan)).toBe('switched');
    await whenIdle();
    expect(fake.server.allTemplates().find((x) => x.id === t.id)).toMatchObject({ clientId: client.id });
    expect(useTemplateStore.getState().templates.map((x) => x.id)).toEqual([t.id]);
  });

  it('sign out revokes the device server-side and leaves the workspace, keeping local invoices', async () => {
    accounts.signIn('alice@example.com', null);
    useInvoiceStore.getState().saveInvoice(form(), '00000000-0000-4000-8000-000000000001');
    await executePlan({ user: accounts.acc.user! }, { kind: 'create' });
    await whenIdle();
    const token = useCloudStore.getState().token;
    await signOutThisBrowser();
    const out = fake.requests.find((r) => r.path === '/api/account/sign-out')!;
    expect(out.headers.authorization).toBe(`Bearer ${token}`);
    expect(useCloudStore.getState().token).toBeNull();
    expect(useAccountStore.getState().linked).toBeNull();
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
  });
});
