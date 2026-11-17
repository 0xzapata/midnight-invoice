/**
 * Recurring schedules × user accounts: schedules are server state of the
 * workspace, so a newly signed-in device sees (and can manage) them with its
 * own device token, with nothing to copy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startD1 } from './test/helpers';
import { accountsApp, alice, signInUser } from './test/accounts';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

describe('recurring schedules on a signed-in device', () => {
  it('a second device of the same account sees and manages the workspace’s schedules', async () => {
    const { app, workos } = await accountsApp(d1.db);
    const client = api(app);
    const { b: first } = await signInUser(app, workos, alice);
    const ws = (await first.post('/api/account/workspace', {})).json as { token: string; workspace: { id: string } };
    const template = (await client.post('/api/v1/templates', { name: 'Retainer', lineItems: [{ description: 'Retainer', quantity: 1, price: 100 }] }, ws.token)).json.template;
    const created = await client.post('/api/v1/recurring', { name: 'Monthly', templateId: template.id, frequency: 'monthly', startDate: '2026-12-01' }, ws.token);
    expect(created.status).toBe(201);

    const { b: second } = await signInUser(app, workos, alice);
    const device = (await second.post('/api/account/workspace/connect', {})).json as { token: string };
    expect(device.token).not.toBe(ws.token);
    const listed = await client.get('/api/v1/recurring', device.token);
    expect(listed.json.recurring.map((s: { id: string; createdBy: { type: string } }) => [s.id, s.createdBy.type])).toEqual([[created.json.recurring.id, 'user']]);
    expect((await client.post(`/api/v1/recurring/${created.json.recurring.id}/pause`, undefined, device.token)).json.recurring.status).toBe('paused');
  });
});
