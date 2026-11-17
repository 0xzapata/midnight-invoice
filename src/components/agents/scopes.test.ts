import { describe, expect, it } from 'vitest';
import { SCOPES } from '../../../shared/api';
import { ACTIVITY_ACTIONS, type ActivityEntry } from '../../../shared/activity';
import { SCOPE_INFO, SCOPE_SHORT } from './scopes';
import { describeEntry } from '../activity/describe';

describe('consent and management screens know every scope', () => {
  it.each([...SCOPES])('%s has a title, an explanation and a short label', (scope) => {
    expect(SCOPE_INFO[scope]?.title).toBeTruthy();
    expect(SCOPE_INFO[scope]?.allows).toBeTruthy();
    expect(SCOPE_SHORT[scope]).toBeTruthy();
  });

  it('describes no unknown scope', () => {
    expect(Object.keys(SCOPE_INFO).sort()).toEqual([...SCOPES].sort());
    expect(Object.keys(SCOPE_SHORT).sort()).toEqual([...SCOPES].sort());
  });
});

describe('the Activity page has a sentence for every action code', () => {
  it.each([...ACTIVITY_ACTIONS])('%s', (action) => {
    const entry: ActivityEntry = {
      id: 'act_1',
      time: '2026-11-17T12:00:00.000Z',
      actor: { type: 'user' },
      action,
      entity: { type: action.split('.')[0], id: 'x1', label: 'Label' },
      changes: null,
      source: 'rest',
      tool: null,
      requestId: null,
    };
    const parts = describeEntry(entry).parts.filter((p): p is string => typeof p === 'string').join('');
    // The generic fallback repeats the raw code ("invoice.created on …").
    expect(parts).not.toContain(action);
  });
});
