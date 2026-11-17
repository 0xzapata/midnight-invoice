/**
 * "Who is the user" for OAuth consent, behind one small interface.
 *
 * Today the person approving an OAuth client is identified by the browser's
 * workspace: the consent screen calls the consent API with the workspace
 * token (`mi_ws_…`) in the Authorization header, and the approved client is
 * bound to that workspace. When real accounts arrive (e.g. WorkOS sign-in),
 * only this function needs to change: return the account's workspace from
 * the new session credential instead.
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
