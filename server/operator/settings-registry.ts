/**
 * Typed registry of runtime settings ("server ENV settings").
 *
 * Every setting the server reads at runtime is declared here once: key, type,
 * default, whether it is a secret, a description and validation. Values live
 * in D1 (`operator_settings`, secrets encrypted) and are edited in the operator
 * console; resolution order is D1 value → wrangler var (`envVar`) → default.
 *
 * To add a setting for a feature, append an entry to SETTINGS (keep keys
 * `<area>.<name>`), then read it with `deps.settings.get('area.name')`
 * (sync, non-secret) or `await deps.settings.getSecret('area.name')`.
 */
import { z } from 'zod';
import { ACTIVITY_RETENTION } from '../../shared/activity';

export type SettingType = 'string' | 'boolean' | 'integer' | 'url' | 'enum' | 'secret';

export interface SettingDef<T> {
  type: SettingType;
  group: string;
  label: string;
  description: string;
  default: T;
  schema: z.ZodType<T>;
  /** Encrypted at rest, write-only in the API/UI. */
  secret: boolean;
  /** Wrangler var/secret used when no D1 value is set. */
  envVar?: string;
  /** Managed by the server; never shown or editable in the console. */
  internal?: boolean;
  /** For integer settings (UI hints; enforced by `schema`). */
  min?: number;
  max?: number;
  /** For enum settings. */
  options?: readonly string[];
}

type Plain<T> = SettingDef<T> & { secret: false };
type Secret = SettingDef<string> & { secret: true };
type Common = { group: string; label: string; description: string; envVar?: string; internal?: boolean };

const httpsOrLocalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    if (v === '') return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
    } catch {
      return false;
    }
  }, 'Must be an https:// URL (http:// only for localhost)')
  .transform((v) => v.replace(/\/+$/, ''));

export const setting = {
  boolean: (o: Common & { default: boolean }): Plain<boolean> => ({ ...o, type: 'boolean', secret: false as const, schema: z.boolean() }),
  integer: (o: Common & { default: number; min: number; max: number }): Plain<number> => ({
    ...o,
    type: 'integer',
    secret: false as const,
    schema: z.number().int().min(o.min).max(o.max),
  }),
  string: (o: Common & { default: string; maxLength?: number; pattern?: RegExp; patternMessage?: string }): Plain<string> => {
    let schema = z.string().trim().max(o.maxLength ?? 500);
    if (o.pattern) schema = schema.regex(o.pattern, o.patternMessage ?? 'Invalid format');
    const { maxLength: _m, pattern: _p, patternMessage: _pm, ...rest } = o;
    return { ...rest, type: 'string', secret: false as const, schema: o.pattern ? schema.or(z.literal('')) as z.ZodType<string> : schema };
  },
  url: (o: Common & { default: string }): Plain<string> => ({ ...o, type: 'url', secret: false as const, schema: httpsOrLocalUrl as z.ZodType<string> }),
  enum: <const O extends readonly [string, ...string[]]>(o: Common & { default: O[number]; options: O }): Plain<O[number]> => ({
    ...o,
    type: 'enum',
    secret: false as const,
    schema: z.enum(o.options) as unknown as z.ZodType<O[number]>,
  }),
  secret: (o: Common & { maxLength?: number; pattern?: RegExp }): Secret => {
    let schema = z.string().trim().min(1).max(o.maxLength ?? 4096);
    if (o.pattern) schema = schema.regex(o.pattern, 'Invalid format');
    const { maxLength: _m, pattern: _p, ...rest } = o;
    return { ...rest, type: 'secret', secret: true as const, default: '', schema };
  },
};

export const SETTINGS = {
  // --- General -------------------------------------------------------------
  'app.url': setting.url({
    group: 'General',
    label: 'Public base URL',
    description: 'Used in agent verification links and the WorkOS redirect URI. Empty = request origin.',
    default: '',
    envVar: 'APP_URL',
  }),
  'maintenance.enabled': setting.boolean({
    group: 'General',
    label: 'Maintenance mode',
    description: 'Answers every public API and MCP request (except /health) with 503 and the message below. The console keeps working.',
    default: false,
  }),
  'maintenance.message': setting.string({
    group: 'General',
    label: 'Maintenance message',
    description: 'Shown to API clients and agents while maintenance mode is on.',
    default: 'Midnight Invoice is undergoing maintenance. Please try again shortly.',
    maxLength: 280,
  }),
  'registration.workspacesOpen': setting.boolean({
    group: 'General',
    label: 'New workspaces',
    description: 'Allow browsers to enable cloud sync (POST /workspaces). Existing workspaces are unaffected.',
    default: true,
  }),
  'registration.agentsOpen': setting.boolean({
    group: 'General',
    label: 'Agent registrations',
    description: 'Allow agents to start the device flow (POST /agents/register).',
    default: true,
  }),

  // --- Agents --------------------------------------------------------------
  'agents.registrationTtlSeconds': setting.integer({
    group: 'Agents',
    label: 'Registration lifetime (s)',
    description: 'How long a pending agent registration (user code) stays valid.',
    default: 600,
    min: 60,
    max: 3600,
  }),
  'agents.pollIntervalSeconds': setting.integer({
    group: 'Agents',
    label: 'Token poll interval (s)',
    description: 'Minimum interval between POST /agents/token polls.',
    default: 5,
    min: 1,
    max: 60,
  }),
  'agents.userCodeFailureLimit': setting.integer({
    group: 'Agents',
    label: 'User-code failures per window',
    description: 'Failed user-code lookups allowed per workspace and per IP before lockout.',
    default: 10,
    min: 3,
    max: 100,
  }),
  'agents.lastUsedThrottleSeconds': setting.integer({
    group: 'Agents',
    label: 'lastUsedAt write interval (s)',
    description: 'An agent’s lastUsedAt is written at most this often.',
    default: 60,
    min: 10,
    max: 3600,
  }),

  // --- OAuth for MCP clients (server/oauth) ---------------------------------
  'oauth.registrationEnabled': setting.boolean({
    group: 'OAuth (MCP clients)',
    label: 'Dynamic client registration',
    description: 'Let MCP clients register themselves (POST /api/oauth/register, RFC 7591). Already registered clients keep working.',
    default: true,
  }),
  'oauth.metadataDocumentsEnabled': setting.boolean({
    group: 'OAuth (MCP clients)',
    label: 'Client ID Metadata Documents',
    description: 'Accept https:// client IDs and fetch their metadata documents. Off = only registered clients.',
    default: true,
  }),
  'oauth.accessTokenMinutes': setting.integer({
    group: 'OAuth (MCP clients)',
    label: 'Access token lifetime (min)',
    description: 'Lifetime of newly issued OAuth access tokens (MCP endpoint only).',
    default: 60,
    min: 5,
    max: 1440,
  }),
  'oauth.refreshTokenDays': setting.integer({
    group: 'OAuth (MCP clients)',
    label: 'Refresh token lifetime (days)',
    description: 'Lifetime of each newly issued refresh token (they rotate on every use).',
    default: 30,
    min: 1,
    max: 365,
  }),
  'oauth.unusedClientHours': setting.integer({
    group: 'OAuth (MCP clients)',
    label: 'Unused registration lifetime (h)',
    description: 'A dynamically registered client that never completes a token exchange is deleted after this.',
    default: 24,
    min: 1,
    max: 720,
  }),

  // --- Telemetry -----------------------------------------------------------
  'telemetry.enabled': setting.boolean({
    group: 'Telemetry',
    label: 'Collect request telemetry',
    description: 'Per-route counts, errors and latency histograms in D1 rollups (no request bodies, tokens or client IPs).',
    default: true,
  }),
  'telemetry.minuteRetentionHours': setting.integer({
    group: 'Telemetry',
    label: 'Minute buckets retention (h)',
    description: 'Minute-level rollups older than this are pruned by the scheduled job.',
    default: 48,
    min: 1,
    max: 168,
  }),
  'telemetry.hourRetentionDays': setting.integer({
    group: 'Telemetry',
    label: 'Hour buckets retention (days)',
    description: 'Hour-level rollups older than this are pruned by the scheduled job.',
    default: 90,
    min: 7,
    max: 400,
  }),

  // --- Activity log -------------------------------------------------------
  'activity.retentionDays': setting.integer({
    group: 'Activity log',
    label: 'Retention (days)',
    description: 'Workspace activity log entries older than this are deleted by the daily activity.retention job.',
    default: ACTIVITY_RETENTION.days,
    min: 7,
    max: 3650,
  }),
  'activity.maxRowsPerWorkspace': setting.integer({
    group: 'Activity log',
    label: 'Max entries per workspace',
    description: 'Only the newest this many activity log entries of each workspace are kept (pruned by the daily job).',
    default: ACTIVITY_RETENTION.maxRows,
    min: 100,
    max: 1_000_000,
  }),

  // --- Operator console ----------------------------------------------------
  'operator.idleTimeoutMinutes': setting.integer({
    group: 'Operator console',
    label: 'Session idle timeout (min)',
    description: 'Operator sessions end after this much inactivity.',
    default: 30,
    min: 5,
    max: 240,
  }),
  'operator.absoluteTimeoutHours': setting.integer({
    group: 'Operator console',
    label: 'Session absolute timeout (h)',
    description: 'Operator sessions end this long after sign-in, active or not.',
    default: 12,
    min: 1,
    max: 72,
  }),

  // --- WorkOS (operator sign-in) ------------------------------------------
  'workos.clientId': setting.string({
    group: 'WorkOS',
    label: 'WorkOS client ID',
    description: 'AuthKit client ID (client_…) used for operator sign-in and, when enabled, user accounts.',
    default: '',
    maxLength: 200,
    pattern: /^client_[A-Za-z0-9_]+$/,
    patternMessage: 'Expected a WorkOS client ID (client_…)',
  }),
  'workos.apiKey': setting.secret({
    group: 'WorkOS',
    label: 'WorkOS API key',
    description: 'Secret key (sk_…) used to exchange AuthKit codes server-side.',
    maxLength: 500,
    pattern: /^sk_[A-Za-z0-9_]+$/,
  }),

  // --- User accounts (server/accounts) ------------------------------------
  'accounts.enabled': setting.boolean({
    group: 'Accounts',
    label: 'User accounts',
    description:
      'Let users sign in with WorkOS AuthKit to reach their workspace from any browser. Needs the WorkOS credentials above and the redirect URI <public URL>/api/account/auth/callback in the WorkOS dashboard. Turning it off later hides sign-in; already signed-in devices keep syncing (see Users → Accounts).',
    default: false,
  }),
  'accounts.requiredForNewWorkspaces': setting.boolean({
    group: 'Accounts',
    label: 'Require an account for new workspaces',
    description: 'When accounts are on: only signed-in users can turn on cloud sync. Existing anonymous workspaces keep working.',
    default: false,
  }),
  'accounts.sessionIdleDays': setting.integer({
    group: 'Accounts',
    label: 'Account session idle timeout (days)',
    description: 'Account sessions (used for account management, not for sync) end after this much inactivity.',
    default: 14,
    min: 1,
    max: 90,
  }),
  'accounts.sessionAbsoluteDays': setting.integer({
    group: 'Accounts',
    label: 'Account session absolute timeout (days)',
    description: 'Account sessions end this long after sign-in. Device sync tokens are not affected.',
    default: 30,
    min: 1,
    max: 365,
  }),

  // --- Deployments (GitHub Actions) ---------------------------------------
  'github.token': setting.secret({
    group: 'Deployments',
    label: 'GitHub token',
    description: 'Fine-grained token with Actions: read & write on the repository only.',
    maxLength: 500,
  }),
  'github.repository': setting.string({
    group: 'Deployments',
    label: 'Repository',
    description: 'owner/name of the repository whose deploy workflow is dispatched.',
    default: '',
    maxLength: 200,
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    patternMessage: 'Expected owner/name',
  }),
  'github.workflow': setting.string({
    group: 'Deployments',
    label: 'Workflow file',
    description: 'Workflow file name under .github/workflows (must have a workflow_dispatch trigger).',
    default: 'deploy.yml',
    maxLength: 200,
    pattern: /^[A-Za-z0-9_.-]+\.ya?ml$/,
    patternMessage: 'Expected a file name like deploy.yml',
  }),
  'github.ref': setting.string({
    group: 'Deployments',
    label: 'Git ref',
    description: 'Branch or tag the workflow runs on.',
    default: 'main',
    maxLength: 200,
    pattern: /^[A-Za-z0-9_./-]+$/,
  }),
  'github.apiUrl': setting.url({
    group: 'Deployments',
    label: 'GitHub API URL',
    description: 'https://api.github.com, or a GitHub Enterprise API URL.',
    default: 'https://api.github.com',
  }),

  // --- Email (sending invoices, server/email) ------------------------------
  'email.enabled': setting.boolean({
    group: 'Email',
    label: 'Send invoices by email',
    description: 'Lets users and agents with the invoices:send scope email invoices (PDF attached). Needs a provider API key and a From address below.',
    default: true,
  }),
  'email.provider': setting.enum({
    group: 'Email',
    label: 'Email provider',
    description: 'Service that delivers the messages.',
    default: 'resend',
    options: ['resend'] as const,
  }),
  'resend.apiKey': setting.secret({
    group: 'Email',
    label: 'Resend API key',
    description: 'API key (re_…) with "Sending access", ideally restricted to your sending domain.',
    maxLength: 500,
    envVar: 'RESEND_API_KEY',
  }),
  'email.fromAddress': setting.string({
    group: 'Email',
    label: 'From address',
    description: 'Address on a domain verified with the provider, e.g. invoices@mail.example.org. Users never choose it; their name is shown as "<name> via <From name>".',
    default: '',
    maxLength: 254,
    pattern: /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/,
    patternMessage: 'Expected an email address like invoices@mail.example.org',
    envVar: 'EMAIL_FROM_ADDRESS',
  }),
  'email.fromName': setting.string({
    group: 'Email',
    label: 'From name',
    description: 'Service name in the From display name ("Acme Studio via Midnight Invoice").',
    default: 'Midnight Invoice',
    maxLength: 60,
    // eslint-disable-next-line no-control-regex -- refuses control characters (header injection)
    pattern: /^[^\u0000-\u001f\u007f"<>\\]+$/,
    patternMessage: 'No quotes, angle brackets, backslashes or line breaks',
  }),
  'email.replyTo': setting.enum({
    group: 'Email',
    label: 'Reply-To',
    description: 'sender = replies go to the invoice’s From email (recommended); none = no Reply-To header.',
    default: 'sender',
    options: ['sender', 'none'] as const,
  }),
  'email.pdfTheme': setting.enum({
    group: 'Email',
    label: 'Attached PDF theme',
    description: 'Default look of the attached PDF. Light prints well and reads like a paper invoice; users can pick dark per send.',
    default: 'light',
    options: ['light', 'dark'] as const,
  }),
  'email.cooldownMinutes': setting.integer({
    group: 'Email',
    label: 'Resend cooldown (min)',
    description: 'Minimum time between two sends of the same invoice.',
    default: 10,
    min: 0,
    max: 1440,
  }),
  'email.workspaceHourlyLimit': setting.integer({
    group: 'Email',
    label: 'Sends per workspace per hour',
    description: 'Rate limit per workspace (user and agents together).',
    default: 20,
    min: 1,
    max: 1000,
  }),
  'email.workspaceDailyCap': setting.integer({
    group: 'Email',
    label: 'Sends per workspace per day',
    description: 'Daily cap per workspace (UTC day).',
    default: 50,
    min: 1,
    max: 10000,
  }),
  'email.agentHourlyLimit': setting.integer({
    group: 'Email',
    label: 'Sends per agent per hour',
    description: 'Rate limit per agent key (counts towards the workspace limits too).',
    default: 5,
    min: 1,
    max: 1000,
  }),
  'email.agentDailyCap': setting.integer({
    group: 'Email',
    label: 'Sends per agent per day',
    description: 'Daily cap per agent key (UTC day).',
    default: 20,
    min: 1,
    max: 10000,
  }),
  'email.globalDailyCap': setting.integer({
    group: 'Email',
    label: 'Sends per day (whole site)',
    description: 'Hard daily cap across all workspaces; protects the sending domain and the provider quota.',
    default: 500,
    min: 1,
    max: 1000000,
  }),

  // --- Internal ------------------------------------------------------------
  'operator.sessionSigningKey': setting.secret({
    group: 'Internal',
    label: 'Session signing key',
    description: 'HMAC key for operator session cookies and CSRF tokens. Generated by the server.',
    internal: true,
  }),
  'accounts.sessionSigningKey': setting.secret({
    group: 'Internal',
    label: 'Account session signing key',
    description: 'HMAC key for user account session cookies and CSRF tokens. Generated by the server; separate from the operator key.',
    internal: true,
  }),
} as const satisfies Record<string, SettingDef<unknown>>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K] extends SettingDef<infer T> ? T : never;
export type SecretSettingKey = { [K in SettingKey]: (typeof SETTINGS)[K]['secret'] extends true ? K : never }[SettingKey];
export type PlainSettingKey = Exclude<SettingKey, SecretSettingKey>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function definitionOf(key: SettingKey): SettingDef<unknown> {
  return SETTINGS[key] as SettingDef<unknown>;
}

/** Parses a wrangler var (always a string) into the setting's type; undefined if empty/invalid. */
export function parseEnvValue(def: SettingDef<unknown>, raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return undefined;
  let candidate: unknown = raw;
  if (def.type === 'boolean') candidate = raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (def.type === 'integer') candidate = Number(raw);
  const parsed = def.schema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
