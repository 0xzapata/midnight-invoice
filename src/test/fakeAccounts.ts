/**
 * In-memory fake of the browser-only account API (`/api/account/*`), layered
 * on src/test/fakeApi.ts with `fake.use(...)`. The fake API accepts a single
 * workspace token, so minting a device token makes it the accepted token
 * (the previous one stops working, like a real revocation would).
 */
import type { AccountWorkspace, DeviceItem } from '../../shared/accounts';
import type { FakeApi } from './fakeApi';

export function installFakeAccounts(fake: FakeApi, opts: { enabled?: boolean; required?: boolean } = {}) {
  let counter = 0;
  const acc = {
    enabled: opts.enabled ?? true,
    required: opts.required ?? false,
    user: null as { id: string; email: string; name: string | null; createdAt: number } | null,
    /** The account's workspace (the fake API's single workspace when set). */
    workspace: null as AccountWorkspace | null,
    devices: [] as DeviceItem[],
    sessionDeviceId: null as string | null,
    calls: [] as string[],
    startBodies: [] as unknown[],
  };
  const mint = () => {
    const token = `mi_ws_device${String(++counter).padStart(37, '0')}`;
    fake.state.token = token;
    fake.state.tokenValid = true;
    const id = `device-${counter}`;
    acc.devices = acc.devices.map((d) => ({ ...d, current: false }));
    acc.devices.push({ id, label: 'Chrome on Linux', createdAt: Date.parse('2026-11-17T10:00:00Z'), lastSeenAt: null, signedIn: true, current: true });
    acc.sessionDeviceId = id;
    return { token, deviceId: id };
  };
  const signedOut = () => fake.apiError(401, 'unauthorized', 'Sign in to manage your account.');
  fake.use((req) => {
    if (!req.path.startsWith('/api/account')) return undefined;
    const path = req.path.slice('/api/account'.length) || '/';
    acc.calls.push(`${req.method} ${path}`);
    if (path === '/config') return fake.json(200, { enabled: acc.enabled, requiredForNewWorkspaces: acc.enabled && acc.required });
    if (!acc.enabled) return fake.apiError(404, 'accounts_disabled', 'Accounts are not enabled on this site.');
    if (path === '/auth/start' && req.method === 'POST') {
      acc.startBodies.push(req.body);
      return fake.json(200, { authorizationUrl: 'https://auth.example/authorize?state=s' });
    }
    if (path === '/sign-out' && req.method === 'POST') {
      if (!acc.user && !req.headers.authorization) return signedOut();
      acc.user = null;
      acc.devices = acc.devices.filter((d) => d.id !== acc.sessionDeviceId);
      acc.sessionDeviceId = null;
      return new Response(null, { status: 204 });
    }
    if (!acc.user) return signedOut();
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== 'csrf-1') return fake.apiError(403, 'csrf_failed', 'CSRF');
    if (path === '/session') {
      return fake.json(200, { user: acc.user, workspace: acc.workspace, csrfToken: 'csrf-1', session: { createdAt: 1, expiresAt: 2, deviceId: acc.sessionDeviceId } });
    }
    if (path === '/workspace' && req.method === 'POST') {
      if (acc.workspace) return fake.apiError(409, 'workspace_exists', 'exists');
      acc.workspace = { ...fake.state.workspace, recoveryKeyEnabled: false };
      return fake.json(201, { workspace: acc.workspace, ...mint() });
    }
    if (path === '/workspace/claim') {
      if (acc.workspace) return fake.apiError(409, 'workspace_exists', 'exists');
      if (req.headers.authorization !== `Bearer ${fake.state.token}`) return fake.apiError(409, 'workspace_owned', 'owned');
      acc.workspace = { ...fake.state.workspace, recoveryKeyEnabled: true };
      return fake.json(200, { workspace: acc.workspace, ...mint() });
    }
    if (path === '/workspace/connect') {
      if (!acc.workspace) return fake.apiError(409, 'no_workspace', 'none');
      return fake.json(200, { workspace: acc.workspace, ...mint() });
    }
    if (path === '/devices' && req.method === 'GET') return fake.json(200, { devices: acc.devices });
    const dev = /^\/devices\/(.+)$/.exec(path);
    if (dev && req.method === 'DELETE') {
      acc.devices = acc.devices.filter((d) => d.id !== dev[1]);
      return new Response(null, { status: 204 });
    }
    if (path === '/sign-out-everywhere') {
      const keep = (req.body as { keepThisDevice?: boolean }).keepThisDevice;
      acc.devices = keep ? acc.devices.filter((d) => d.current) : [];
      if (!keep) acc.user = null;
      return new Response(null, { status: 204 });
    }
    if (path === '/recovery-key/rotate') {
      acc.workspace = { ...acc.workspace!, recoveryKeyEnabled: true };
      return fake.json(200, { recoveryKey: `mi_ws_recovery${'R'.repeat(35)}` });
    }
    if (path === '/recovery-key/disable') {
      acc.workspace = { ...acc.workspace!, recoveryKeyEnabled: false };
      return fake.json(200, { workspace: acc.workspace });
    }
    if (path === '/' && req.method === 'DELETE') {
      const body = req.body as { confirm: string; deleteWorkspace: boolean };
      if (body.confirm.toLowerCase() !== acc.user.email) return fake.apiError(400, 'validation_failed', 'Type your email address to confirm.');
      const recoveryKey = body.deleteWorkspace ? null : `mi_ws_kept${'K'.repeat(39)}`;
      if (recoveryKey) fake.state.token = recoveryKey;
      acc.user = null;
      acc.workspace = null;
      acc.devices = [];
      return fake.json(200, { deletedWorkspace: body.deleteWorkspace, recoveryKey });
    }
    return fake.apiError(404, 'not_found', `No fake account route for ${req.method} ${path}`);
  });
  return {
    acc,
    signIn(email = 'alice@example.com', workspace: AccountWorkspace | null = null) {
      acc.user = { id: `user-${email}`, email, name: null, createdAt: Date.parse('2026-11-01T10:00:00Z') };
      acc.workspace = workspace;
    },
  };
}
