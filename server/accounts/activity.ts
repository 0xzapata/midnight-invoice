/**
 * Account events in the workspace activity log (server/services/activity.ts).
 * Entries are about the workspace the account owns; they carry the device
 * label at most (never tokens, session ids or email addresses).
 */
import type { Context } from 'hono';
import type { ActivityActor, ActivityChanges } from '../../shared/activity';
import type { AppDeps } from '../deps';
import { runInBackground } from '../http';
import { activityWrite, recordActivity, type ActivityContext, type ActivityInput } from '../services/activity';

export type AccountActivityAction =
  | 'account.workspace_created'
  | 'account.workspace_claimed'
  | 'account.device_signed_in'
  | 'account.device_revoked'
  | 'account.signed_out_everywhere'
  | 'account.signed_out_other_devices'
  | 'account.recovery_key_rotated'
  | 'account.recovery_key_created'
  | 'account.recovery_key_disabled'
  | 'account.deleted'
  | 'account.disabled';

export function accountActivityContext(deps: AppDeps, c?: Context): ActivityContext {
  return {
    deps,
    activity: c
      ? { source: 'rest', requestId: c.req.header('cf-ray') ?? crypto.randomUUID(), waitUntil: (p) => runInBackground(c, p) }
      : { source: 'system', requestId: null },
  };
}

export function accountEntry(
  action: AccountActivityAction,
  workspaceId: string,
  opts: { device?: { id: string; label: string }; changes?: ActivityChanges; actor?: ActivityActor } = {},
): ActivityInput {
  return {
    action,
    workspaceId,
    actor: opts.actor ?? { type: 'user' },
    entity: opts.device ? { type: 'device', id: opts.device.id, label: opts.device.label } : null,
    changes: opts.changes ?? null,
  };
}

/** Statements committing `input` in the same batch as the account write (after a statement that changed a row). */
export const accountWriteStatements = (ctx: ActivityContext, input: ActivityInput) => activityWrite(ctx, input).statements;

/** After-the-fact entry; never rejects. */
export const recordAccountActivity = (ctx: ActivityContext, input: ActivityInput) => recordActivity(ctx, input);
