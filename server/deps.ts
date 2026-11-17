import { generateSecret, generateUserCode } from './crypto';
import type { EmailSender } from './email/sender';
import { MIN_INITIAL_PASSWORD_LENGTH } from './operator/crypto';
import { createOperatorDb } from './operator/db';
import { createSettingsProvider, type SettingsProvider } from './operator/settings';

/** Same shape as the Workers Rate Limiting binding (`env.RATE_LIMIT_*`). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Reads a file that is shipped as a static asset (e.g. `/fonts/x.ttf`). */
export type AssetReader = (path: string) => Promise<ArrayBuffer>;

export interface AppConfig {
  /** Public base URL for verification links; falls back to the request origin. */
  appUrl?: string;
  /** Lifetime of a pending agent registration, seconds. */
  registrationTtlSeconds: number;
  /** Minimum polling interval for POST /agents/token, seconds. */
  pollIntervalSeconds: number;
  /** Failed user-code lookups allowed per window (per workspace and per IP). */
  userCodeFailureLimit: number;
  userCodeFailureWindowSeconds: number;
  /** lastUsedAt is written at most this often per agent. */
  lastUsedThrottleSeconds: number;
}

export interface AppDeps {
  db: D1Database;
  /** Wall clock for expiries and agent bookkeeping. Invoice timestamps come from D1's clock (see sync docs). */
  clock: () => Date;
  ids: { uuid: () => string };
  secrets: { generate: (prefix: string) => string; userCode: () => string };
  rateLimiters: { create: RateLimiter; poll: RateLimiter };
  readAsset: AssetReader;
  /** Outbound fetch for Client ID Metadata Documents (OAuth); defaults to the global fetch. */
  outboundFetch?: typeof fetch;
  config: AppConfig;
  /** Logs operational errors. Never receives secrets. */
  logError?: (message: string, error: unknown) => void;
  /** Operator console inputs (server/operator). */
  operator: OperatorDeps;
  /** Runtime settings (D1-backed, see server/operator/settings-registry.ts). `config` reads through it. */
  settings: SettingsProvider;
  /** Email sending inputs (server/email). Configuration itself comes from `settings`. */
  email?: EmailDeps;
}

export interface EmailDeps {
  /** Outbound fetch for the email provider (tests inject a fake). */
  fetch?: typeof fetch;
  /** Dev only (vite dev): fake Resend server base URL. Never set in production builds. */
  resendBaseUrl?: string;
  /** Replaces the configured provider entirely (tests). */
  sender?: EmailSender;
}

export interface OperatorDeps {
  /** INITIAL_PASSWORD secret. Unset = operator console disabled (503). */
  initialPassword?: string;
  /** Optional ENCRYPTION_KEY secret (hardened encryption mode). */
  encryptionKey?: string;
  /** Dev only (vite dev + `workos dev`): WorkOS emulator base URL. Never set in production builds. */
  workosBaseUrl?: string;
  /** Outbound fetch for WorkOS/GitHub (tests inject a fake). */
  fetch?: typeof fetch;
  /** Workers version metadata binding, if configured. */
  versionMetadata?: { id?: string; tag?: string; timestamp?: string };
  /** Build info injected at build time. */
  build?: { sha?: string; time?: string };
  /** Waits before a bootstrap/recovery attempt once many failed site-wide (security fix L5). Tests inject a recorder. */
  sleep?: (ms: number) => Promise<void>;
  /** Telemetry flush coalescing delay (ms). Tests use 0. */
  telemetryFlushDelayMs?: number;
  /** Wrangler vars/secrets that settings may fall back to (see `envVar` in the registry). */
  vars?: Record<string, string | undefined>;
}

export const DEFAULT_CONFIG: AppConfig = {
  registrationTtlSeconds: 600,
  pollIntervalSeconds: 5,
  userCodeFailureLimit: 10,
  userCodeFailureWindowSeconds: 600,
  lastUsedThrottleSeconds: 60,
};

export const allowAll: RateLimiter = { limit: async () => ({ success: true }) };

export function defaultDeps(
  overrides: Pick<AppDeps, 'db' | 'readAsset'> & Partial<Omit<AppDeps, 'config'>> & { config?: Partial<AppConfig> },
): AppDeps {
  const base = {
    clock: () => new Date(),
    ids: { uuid: () => crypto.randomUUID() },
    secrets: { generate: generateSecret, userCode: generateUserCode },
    rateLimiters: { create: allowAll, poll: allowAll },
    logError: (message: string, error: unknown) => console.error(message, error instanceof Error ? error.message : error),
    operator: {},
    ...overrides,
  };
  // Runtime settings override the static config (resolved per request from a cached snapshot).
  const settings =
    overrides.settings ??
    createSettingsProvider({
      odb: createOperatorDb(base.db),
      clock: base.clock,
      // A too-short INITIAL_PASSWORD never protects encrypted settings (security fix L4; the console refuses it too).
      keystoreEnv: (base.operator.initialPassword?.length ?? 0) >= MIN_INITIAL_PASSWORD_LENGTH
        ? { initialPassword: base.operator.initialPassword!, encryptionKey: base.operator.encryptionKey }
        : null,
      vars: base.operator.vars,
      logError: base.logError,
    });
  return { ...base, settings, config: settings.configView({ ...DEFAULT_CONFIG, ...overrides.config }) };
}
