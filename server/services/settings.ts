/**
 * Settings writes (PUT /settings, workspace token only). Reads stay in
 * services/invoices.ts (`getSettings`), which agents use for defaults.
 */
import type { SettingsResponse } from '../../shared/api';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { requireUser } from '../auth';
import { errors } from '../errors';
import { settingsSchema, zodDetails } from '../schemas';
import { activityWriteIf, changedFields } from './activity';
import type { ServiceContext } from './invoices';

/** Replaces the default settings; records `settings.updated` with the changed field names (nothing if unchanged). */
export async function putSettings(ctx: ServiceContext, body: unknown): Promise<SettingsResponse & { updatedAt: string }> {
  requireUser(ctx.principal);
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(body as object) });
  if (!parsed.success) throw errors.validation(zodDetails(parsed.error));
  const before = (await ctx.repo.getSettings(ctx.principal.workspaceId))?.settings ?? DEFAULT_SETTINGS;
  const fields = changedFields(before, parsed.data, []);
  const { updatedAt } = await ctx.repo.putSettings(
    ctx.principal.workspaceId,
    parsed.data,
    activityWriteIf(ctx, fields.length ? { action: 'settings.updated', entity: { type: 'settings', id: 'default', label: null }, changes: { fields } } : null),
  );
  return { settings: parsed.data, updatedAt };
}
