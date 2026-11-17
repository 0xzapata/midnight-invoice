/**
 * Per-workspace storage limits (security review): workspaces can be created
 * anonymously, so the number of live invoices, clients and templates one of
 * them may hold is capped by operator settings (`limits.*`, generous
 * defaults). Checked before every create (REST, MCP, sync PUT, recurring
 * generation); deleted rows do not count. 409 limit_reached when full.
 */
import { ApiError } from '../errors';
import type { ServiceContext } from './invoices';

const LIMITS = {
  invoices: { setting: 'limits.maxInvoicesPerWorkspace', noun: 'invoices' },
  clients: { setting: 'limits.maxClientsPerWorkspace', noun: 'clients' },
  templates: { setting: 'limits.maxTemplatesPerWorkspace', noun: 'templates' },
} as const;

export async function requireCapacity(ctx: Pick<ServiceContext, 'repo' | 'deps' | 'principal'>, kind: keyof typeof LIMITS): Promise<void> {
  const { setting, noun } = LIMITS[kind];
  const max = ctx.deps.settings.get(setting);
  if ((await ctx.repo.countLive(kind, ctx.principal.workspaceId)) < max) return;
  throw new ApiError(409, 'limit_reached', `This workspace already has the maximum of ${max} ${noun}. Delete some first, or ask the site operator to raise the limit.`, { max, kind });
}
