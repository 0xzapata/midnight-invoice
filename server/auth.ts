import { SCOPES, TOKEN_PREFIX, type Scope } from '../shared/api';
import { OAUTH_TOKEN_PREFIX } from '../shared/oauth';
import type { Actor } from '../shared/types/invoice';
import { sha256Hex } from './crypto';
import { errors } from './errors';
import type { Repository } from './db/repository';

export type Principal =
  | { type: 'user'; workspaceId: string; scopes: readonly Scope[] }
  | {
      type: 'agent';
      workspaceId: string;
      agentId: string;
      agentName: string;
      agentDescription: string | null;
      agentCreatedAt: string;
      lastUsedAt: string | null;
      scopes: readonly Scope[];
      /** How the agent authenticated: an OAuth access token (MCP only) or, when absent, its API key. */
      credential?: 'oauth';
    };

export function parseScopes(json: string | null): Scope[] {
  if (!json) return [];
  const parsed = JSON.parse(json) as unknown;
  return Array.isArray(parsed) ? parsed.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)) : [];
}

/** Extracts the bearer token, or null if the header is absent/malformed. */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+([A-Za-z0-9_\-.~+/]+=*)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Resolves a bearer token to a principal. Workspace tokens and agent keys are
 * told apart by prefix and looked up by SHA-256 hash; revoked agents never
 * resolve. Throws 401 on anything else.
 */
export async function authenticate(repo: Repository, authorization: string | undefined | null): Promise<Principal> {
  const token = bearerToken(authorization);
  if (!token) throw errors.unauthorized();
  if (token.startsWith(TOKEN_PREFIX.workspace)) {
    const ws = await repo.findWorkspaceByTokenHash(await sha256Hex(token));
    if (!ws) throw errors.unauthorized();
    return { type: 'user', workspaceId: ws.id, scopes: SCOPES };
  }
  if (token.startsWith(TOKEN_PREFIX.agentKey)) {
    const agent = await repo.findActiveAgentByKeyHash(await sha256Hex(token));
    if (!agent) throw errors.unauthorized();
    return {
      type: 'agent',
      workspaceId: agent.workspace_id,
      agentId: agent.id,
      agentName: agent.name,
      agentDescription: agent.description,
      agentCreatedAt: agent.created_at,
      lastUsedAt: agent.last_used_at,
      scopes: parseScopes(agent.scopes),
    };
  }
  if (token.startsWith(OAUTH_TOKEN_PREFIX.access)) {
    // OAuth access tokens are audience-bound to the MCP endpoint (see server/oauth/routes.ts).
    throw errors.unauthorized('OAuth access tokens are only valid at /api/mcp; use an agent API key for the REST API');
  }
  throw errors.unauthorized();
}

export function hasScope(principal: Principal, scope: Scope): boolean {
  return principal.scopes.includes(scope);
}

export function requireScope(principal: Principal, scope: Scope): void {
  if (!hasScope(principal, scope)) throw errors.insufficientScope(scope);
}

/** Only the workspace token (the user) may manage agents, settings and the workspace itself. */
export function requireUser(principal: Principal): asserts principal is Extract<Principal, { type: 'user' }> {
  if (principal.type !== 'user') throw errors.forbidden('This endpoint requires the workspace token, not an agent key');
}

export function actorOf(principal: Principal): Actor {
  return principal.type === 'user'
    ? { type: 'user' }
    : { type: 'agent', agentId: principal.agentId, agentName: principal.agentName };
}
