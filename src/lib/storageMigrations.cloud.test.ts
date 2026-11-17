import { describe, expect, it } from 'vitest';
import { CURRENT_CLOUD_VERSION, EMPTY_CLOUD_STATE, migrateCloudStore } from './storageMigrations';

const token = `mi_ws_${'k'.repeat(43)}`;

describe('migrateCloudStore', () => {
  it('is at version 2 (per-collection cursors and queue entries)', () => {
    expect(CURRENT_CLOUD_VERSION).toBe(2);
  });

  it('turns missing or malformed state into the empty (cloud sync off) state', () => {
    expect(migrateCloudStore(undefined, 0)).toEqual(EMPTY_CLOUD_STATE);
    expect(migrateCloudStore('garbage', 0)).toEqual(EMPTY_CLOUD_STATE);
    expect(migrateCloudStore({ token: 42, queue: 'x' }, 0)).toEqual(EMPTY_CLOUD_STATE);
  });

  it('keeps the workspace, token, cursor and valid queue entries of version 1 data, converted to version 2', () => {
    const result = migrateCloudStore(
      {
        workspace: { id: 'ws', createdAt: '2026-11-17T00:00:00Z' },
        token,
        cursor: '2026-11-17T10:00:00.000Z',
        queue: [
          { opId: 'a', type: 'upsert', invoiceId: 'i1', seq: 2, attempts: 3, notBefore: 9e15 },
          { type: 'delete', invoiceId: 'i2', baseRevision: 4, invoiceNumber: 'INV-0002' },
          { type: 'settings' },
          { type: 'upsert' }, // no invoice id: dropped
          { type: 'bogus', invoiceId: 'i3' }, // unknown type: dropped
          null,
        ],
        bases: { i1: { toName: 'x' } },
        syncErrors: { i9: 'Invalid', bad: 3 },
      },
      1,
    );
    expect(result.workspace).toEqual({ id: 'ws', createdAt: '2026-11-17T00:00:00Z' });
    expect(result.token).toBe(token);
    // The single v1 cursor was the invoice feed's.
    expect(result.cursors).toEqual({ invoices: '2026-11-17T10:00:00.000Z' });
    expect(result.queue.map((op) => [op.type, op.collection, op.entityId])).toEqual([
      ['upsert', 'invoices', 'i1'],
      ['delete', 'invoices', 'i2'],
      ['settings', undefined, undefined],
    ]);
    // Backoff is reset after a reload so pending changes retry promptly.
    expect(result.queue[0]).toMatchObject({ opId: 'a', seq: 2, attempts: 3, notBefore: 0 });
    expect(result.queue[1]).toMatchObject({ baseRevision: 4, label: 'INV-0002' });
    expect(result.queue[0]).not.toHaveProperty('invoiceId');
    // Invoice bases and errors keep their bare-id keys.
    expect(result.bases).toEqual({ i1: { toName: 'x' } });
    expect(result.syncErrors).toEqual({ i9: 'Invalid' });
  });

  it('keeps version 2 data and drops entries for unknown collections', () => {
    const result = migrateCloudStore(
      {
        workspace: { id: 'ws', createdAt: 'c' },
        token,
        cursors: { invoices: 'a', clients: 'b', templates: 'c', recurring: 'd', bad: 1 },
        queue: [
          { opId: 'x', type: 'upsert', collection: 'clients', entityId: 'c1', seq: 0, attempts: 0, notBefore: 0 },
          { opId: 'y', type: 'delete', collection: 'invoices', entityId: 'i1', label: 'INV-0001', baseRevision: 2 },
          { opId: 't', type: 'upsert', collection: 'templates', entityId: 't1' },
          { opId: 'z', type: 'upsert', collection: 'recurring', entityId: 'r1' }, // from a newer version
          { opId: 'w', type: 'upsert', collection: 'clients' }, // no id
        ],
        bases: { 'clients:c1': { name: 'Globex' } },
        syncErrors: { 'clients:c2': 'Client name is required (name).' },
      },
      2,
    );
    expect(result.cursors).toEqual({ invoices: 'a', clients: 'b', templates: 'c' });
    expect(result.queue.map((op) => op.opId)).toEqual(['x', 'y', 't']);
    expect(result.queue[1]).toMatchObject({ collection: 'invoices', entityId: 'i1', label: 'INV-0001', baseRevision: 2 });
    expect(result.bases).toEqual({ 'clients:c1': { name: 'Globex' } });
    expect(result.syncErrors).toEqual({ 'clients:c2': 'Client name is required (name).' });
  });

  it('drops queue, cursors and bases that have no token', () => {
    const result = migrateCloudStore({ cursor: 'c', queue: [{ type: 'settings' }], bases: { a: {} }, disconnectedReason: 'token_rejected' }, 0);
    expect(result).toMatchObject({ token: null, cursors: {}, queue: [], bases: {}, disconnectedReason: 'token_rejected' });
  });

  it('keeps the token when data comes from a newer app version', () => {
    expect(migrateCloudStore({ token, workspace: { id: 'ws', createdAt: 'c' } }, CURRENT_CLOUD_VERSION + 1).token).toBe(token);
  });
});
