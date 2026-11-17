import { describe, expect, it } from 'vitest';
import { CURRENT_CLOUD_VERSION, EMPTY_CLOUD_STATE, migrateCloudStore } from './storageMigrations';

const token = `mi_ws_${'k'.repeat(43)}`;

describe('migrateCloudStore', () => {
  it('starts at version 1', () => {
    expect(CURRENT_CLOUD_VERSION).toBe(1);
  });

  it('turns missing or malformed state into the empty (cloud sync off) state', () => {
    expect(migrateCloudStore(undefined, 0)).toEqual(EMPTY_CLOUD_STATE);
    expect(migrateCloudStore('garbage', 0)).toEqual(EMPTY_CLOUD_STATE);
    expect(migrateCloudStore({ token: 42, queue: 'x' }, 0)).toEqual(EMPTY_CLOUD_STATE);
  });

  it('keeps the workspace, token, cursor and valid queue entries', () => {
    const result = migrateCloudStore(
      {
        workspace: { id: 'ws', createdAt: '2026-11-17T00:00:00Z' },
        token,
        cursor: '2026-11-17T10:00:00.000Z',
        queue: [
          { opId: 'a', type: 'upsert', invoiceId: 'i1', seq: 2, attempts: 3, notBefore: 9e15 },
          { type: 'delete', invoiceId: 'i2', baseRevision: 4 },
          { type: 'settings' },
          { type: 'upsert' }, // no invoice id: dropped
          { type: 'bogus', invoiceId: 'i3' }, // unknown type: dropped
          null,
        ],
        bases: { i1: { toName: 'x' } },
        syncErrors: { i9: 'Invalid', bad: 3 },
      },
      0,
    );
    expect(result.workspace).toEqual({ id: 'ws', createdAt: '2026-11-17T00:00:00Z' });
    expect(result.token).toBe(token);
    expect(result.cursor).toBe('2026-11-17T10:00:00.000Z');
    expect(result.queue.map((op) => [op.type, op.invoiceId])).toEqual([
      ['upsert', 'i1'],
      ['delete', 'i2'],
      ['settings', undefined],
    ]);
    // Backoff is reset after a reload so pending changes retry promptly.
    expect(result.queue[0]).toMatchObject({ opId: 'a', seq: 2, attempts: 3, notBefore: 0 });
    expect(result.queue[1].baseRevision).toBe(4);
    expect(result.bases).toEqual({ i1: { toName: 'x' } });
    expect(result.syncErrors).toEqual({ i9: 'Invalid' });
  });

  it('drops queue, cursor and bases that have no token', () => {
    const result = migrateCloudStore({ cursor: 'c', queue: [{ type: 'settings' }], bases: { a: {} }, disconnectedReason: 'token_rejected' }, 0);
    expect(result).toMatchObject({ token: null, cursor: null, queue: [], bases: {}, disconnectedReason: 'token_rejected' });
  });

  it('keeps the token when data comes from a newer app version', () => {
    expect(migrateCloudStore({ token, workspace: { id: 'ws', createdAt: 'c' } }, CURRENT_CLOUD_VERSION + 1).token).toBe(token);
  });
});
