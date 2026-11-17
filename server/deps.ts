import { generateSecret, generateUserCode } from './crypto';

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
  return {
    clock: () => new Date(),
    ids: { uuid: () => crypto.randomUUID() },
    secrets: { generate: generateSecret, userCode: generateUserCode },
    rateLimiters: { create: allowAll, poll: allowAll },
    logError: (message, error) => console.error(message, error instanceof Error ? error.message : error),
    ...overrides,
    config: { ...DEFAULT_CONFIG, ...overrides.config },
  };
}
