/**
 * Deleting a workspace (DELETE /api/v1/workspace, the operator console and
 * account deletion all use repo.deleteWorkspace) must leave nothing behind in
 * any table that has a `workspace_id` column. The tables are read from the
 * migrations, so a new feature table fails this test until it is seeded below
 * and covered by the deletion.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, buildApp, connectAgent, createWorkspace, sampleInvoice, startD1 } from './test/helpers';
import { connectOAuth, registerClient, authorize } from './test/oauth';

const MIGRATIONS = join(__dirname, '..', 'migrations');

/** Tables whose CREATE TABLE statement declares a `workspace_id` column. */
function workspaceTables(): string[] {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/^\s*workspace_id\s+TEXT/im.test(m[2])) tables.add(m[1]);
    }
  }
  return [...tables].sort();
}

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

async function countRows(db: D1Database, table: string, workspaceId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).bind(workspaceId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('workspace deletion', () => {
  it('finds the workspace tables in the migrations', () => {
    // Guards the parser: these are known to exist.
    expect(workspaceTables()).toEqual(expect.arrayContaining(['invoices', 'clients', 'templates', 'activity', 'agents', 'oauth_tokens', 'recurring_runs', 'workspace_tokens']));
  });

  it('empties every table with a workspace_id column, and leaves other workspaces alone', async () => {
    const { app } = buildApp(d1.db);
    const client = api(app);
    const db = d1.db;
    const ws = await createWorkspace(client);
    const other = await createWorkspace(client);
    const t = ws.token;
    const now = Date.now();

    // --- Seed every kind of workspace data through the API where possible ---
    expect((await client.put('/api/v1/settings', { fromName: 'Ada', fromEmail: 'ada@ada-studio.io', currency: 'EUR', taxRate: 0, fromAddress: '', paymentDetails: '', notes: '' }, t)).status).toBe(200);
    const c = (await client.post('/api/v1/clients', { name: 'Globex', email: 'ap@globex-corp.io' }, t)).json.client;
    const tpl = (await client.post('/api/v1/templates', { name: 'Retainer', clientId: c.id, lineItems: [{ description: 'Retainer', quantity: 1, price: 100 }] }, t)).json.template;
    // A user-written toEmail fills email_confirmed_recipients (trigger).
    expect((await client.post('/api/v1/invoices', sampleInvoice({ toEmail: 'billing@acme-client.io' }), t)).status).toBe(201);
    // agent_registrations + agents; an agent-written invoice fills invoice_sender_review (trigger).
    const agent = await connectAgent(client, t, ['invoices:read', 'invoices:write']);
    expect((await client.post('/api/v1/invoices', sampleInvoice({ fromName: 'Agent wrote this' }), agent.api_key)).status).toBe(201);
    // A client created by the agent fills agent_content_edits (trigger, migration 0011); user writes fill sender_approved_values.
    const agentClients = await connectAgent(client, t, ['clients:read', 'clients:write']);
    expect((await client.post('/api/v1/clients', { name: 'Agent Co', email: 'ap@agent-co.io' }, agentClients.api_key)).status).toBe(201);
    // recurring_schedules + recurring_runs.
    const sched = (await client.post('/api/v1/recurring', { name: 'Monthly', templateId: tpl.id, frequency: 'monthly', startDate: new Date(now).toISOString().slice(0, 10), timezone: 'UTC' }, t)).json.recurring;
    expect((await client.post(`/api/v1/recurring/${sched.id}/run-now`, { period: sched.nextRunDate }, t)).status).toBe(201);
    // OAuth: an approved, exchanged grant (requests, codes, agents, grants, tokens) and a pending request.
    await connectOAuth(app, client, t, { scope: 'invoices:read' });
    const pending = await registerClient(client);
    await authorize(app, { client_id: pending.client_id, scope: 'invoices:read' });
    // Tables written by other parts of the stack (operator console, accounts, email sends): direct rows.
    const user = `user-${now}`;
    await db.batch([
      db.prepare('INSERT INTO workspace_suspensions (workspace_id, suspended_at) VALUES (?, ?)').bind(ws.workspace.id, now),
      db.prepare('INSERT INTO workspace_activity (workspace_id, last_seen_at) VALUES (?, ?)').bind(ws.workspace.id, now),
      db.prepare("INSERT INTO users (id, workos_user_id, email, email_verified, created_at) VALUES (?, ?, 'u@example.org', 1, ?)").bind(user, `wos-${now}`, now),
      db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(ws.workspace.id, user, now),
      db.prepare("INSERT INTO workspace_tokens (id, workspace_id, user_id, token_hash, device_label, created_at) VALUES (?, ?, ?, ?, 'Test device', ?)").bind(`dev-${now}`, ws.workspace.id, user, `hash-${now}`, now),
      db
        .prepare(
          `INSERT INTO email_messages (workspace_id, id, invoice_id, to_address, subject, status, provider, actor, created_at, updated_at)
           VALUES (?, 'em-1', 'inv-1', 'billing@acme-client.io', 'Invoice', 'sent', 'resend', '{"type":"user"}', ?, ?)`,
        )
        .bind(ws.workspace.id, new Date(now).toISOString(), new Date(now).toISOString()),
    ]);
    // The other workspace has data of its own.
    expect((await client.post('/api/v1/invoices', sampleInvoice({ toEmail: 'billing@acme-client.io' }), other.token)).status).toBe(201);

    const tables = workspaceTables();
    const before = Object.fromEntries(await Promise.all(tables.map(async (tb) => [tb, await countRows(db, tb, ws.workspace.id)] as const)));
    // Every table is exercised (a new table must be seeded above).
    expect(Object.entries(before).filter(([, n]) => n === 0).map(([tb]) => tb)).toEqual([]);

    expect((await client.del('/api/v1/workspace', t)).status).toBe(204);

    const after = Object.fromEntries(await Promise.all(tables.map(async (tb) => [tb, await countRows(db, tb, ws.workspace.id)] as const)));
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?').bind(ws.workspace.id).first('n')).toBe(0);
    // The other workspace is untouched.
    expect(await countRows(db, 'invoices', other.workspace.id)).toBe(1);
    expect(await countRows(db, 'email_confirmed_recipients', other.workspace.id)).toBe(1);
  });
});
