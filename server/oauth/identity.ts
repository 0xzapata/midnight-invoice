/**
 * "Who is the user" for OAuth consent, behind one small interface.
 *
 * Today the person approving an OAuth client is identified by the browser's
 * workspace: the consent screen calls the consent API with the workspace
 * token (`mi_ws_…`) in the Authorization header, and the approved client is
 * bound to that workspace. With optional user accounts (server/accounts) a
 * signed-in browser holds its own per-device workspace token for the
 * account's workspace, so this function did not need to change; the grant is
 * bound to the workspace, never to that device token (signing a device out
 * leaves agents connected).
 */
import { requireUser, type Principal } from '../auth';

export interface ConsentUser {
  /** The workspace the approved client gets access to. */
  workspaceId: string;
}

/** Throws 403 unless the request was made by a user (not an agent). */
export function consentUserOf(principal: Principal): ConsentUser {
  requireUser(principal);
  return { workspaceId: principal.workspaceId };
}
