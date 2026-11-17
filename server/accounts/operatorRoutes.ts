/**
 * Operator console: user accounts (Users → Accounts). Metadata only: email,
 * verification, timestamps, linked workspace id, device count. The privacy
 * boundary is unchanged: nothing here reads invoices, clients or settings.
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { OperatorAccountsResponse } from '../../shared/accounts';
import type { AppDeps } from '../deps';
import { readJson } from '../http';
import { OperatorError } from '../operator/errors';
import { accountActivityContext, accountEntry, recordAccountActivity } from './activity';
import { createAccountsDb } from './db';

type Audit = (c: Context, action: string, target?: string | null, detail?: Record<string, unknown> | null) => Promise<unknown>;

const cursor = {
  encode: (createdAt: number, id: string) => btoa(JSON.stringify([createdAt, id])).replace(/=+$/, ''),
  decode: (v: string | undefined): [number, string] | null => {
    if (!v) return null;
    try {
      const p = JSON.parse(atob(v)) as unknown;
      return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'string' ? [p[0], p[1]] : null;
    } catch {
      return null;
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mounted on the operator's full-session sub-app
export function registerAccountOperatorRoutes(full: Hono<any>, deps: AppDeps, audit: Audit): void {
  const adb = createAccountsDb(deps.db);
  const now = () => deps.clock().getTime();

  full.get('/accounts', async (c) => {
    const limit = 50;
    const after = cursor.decode(c.req.query('cursor'));
    const statusQ = c.req.query('status');
    const status = statusQ === 'active' || statusQ === 'disabled' ? statusQ : 'all';
    const rows = await adb.listAccounts({
      search: (c.req.query('q') ?? '').trim().slice(0, 120) || undefined,
      status,
      afterCreated: after?.[0],
      afterId: after?.[1],
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json<OperatorAccountsResponse>({
      enabled: deps.settings.get('accounts.enabled'),
      linkedWorkspaces: await adb.linkedWorkspaceCount(),
      requiredForNewWorkspaces: deps.settings.get('accounts.requiredForNewWorkspaces'),
      accounts: page.map((r) => ({
        id: r.id,
        email: r.email,
        emailVerified: r.email_verified === 1,
        createdAt: r.created_at,
        lastSignInAt: r.last_sign_in_at,
        workspaceId: r.workspace_id,
        activeDevices: r.active_devices,
        disabled: r.disabled_at !== null,
        disabledAt: r.disabled_at,
        disabledReason: r.disabled_reason,
      })),
      next: rows.length > limit ? cursor.encode(last.created_at, last.id) : null,
    });
  });

  full.post('/accounts/:id/disable', async (c) => {
    const id = c.req.param('id');
    const parsed = z.object({ reason: z.string().trim().max(200).optional() }).safeParse((await readJson(c, 4096)) ?? {});
    if (!parsed.success) throw OperatorError.validation('Invalid reason');
    if (!(await adb.findUser(id))) throw OperatorError.notFound('Account not found');
    const changed = await adb.disableUser(id, now(), parsed.data.reason || null);
    if (!changed) throw OperatorError.conflict('already_disabled', 'This account is already disabled.');
    await audit(c, 'account.disable', id, parsed.data.reason ? { reason: parsed.data.reason } : null);
    // The owner sees why their devices stopped syncing (no reason text: it is operator-private).
    const ws = await adb.ownedWorkspace(id);
    if (ws) await recordAccountActivity(accountActivityContext(deps), accountEntry('account.disabled', ws.id, { actor: { type: 'system' } }));
    deps.settings.invalidate();
    return c.json({ disabled: true });
  });

  full.post('/accounts/:id/enable', async (c) => {
    const id = c.req.param('id');
    if (!(await adb.enableUser(id))) throw OperatorError.notFound('Account is not disabled');
    await audit(c, 'account.enable', id);
    return c.json({ disabled: false });
  });
}
