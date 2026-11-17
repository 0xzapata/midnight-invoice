/**
 * Runtime settings provider: a per-isolate snapshot of `operator_settings`
 * (plus the config version and the suspended-credential set), refreshed at
 * most every SNAPSHOT_TTL_MS by the request hook, and immediately in the
 * isolate that made a change. Changes made elsewhere therefore take effect
 * everywhere within SNAPSHOT_TTL_MS (5 s).
 *
 * Resolution: D1 value → `base` (deps.config overrides / wrangler var) → registry default.
 */
import type { AppConfig } from '../deps';
import type { OperatorDb, SettingRow } from './db';
import { createKeystore, type Keystore, type KeystoreEnv } from './keystore';
import { OperatorError } from './errors';
import {
  SETTINGS,
  SETTING_KEYS,
  definitionOf,
  isSettingKey,
  parseEnvValue,
  type PlainSettingKey,
  type SecretSettingKey,
  type SettingKey,
  type SettingValue,
} from './settings-registry';

export const SNAPSHOT_TTL_MS = 5_000;

/** Settings that back an AppConfig field (read by existing handlers via deps.config). */
const CONFIG_FIELDS = {
  'app.url': 'appUrl',
  'agents.registrationTtlSeconds': 'registrationTtlSeconds',
  'agents.pollIntervalSeconds': 'pollIntervalSeconds',
  'agents.userCodeFailureLimit': 'userCodeFailureLimit',
  'agents.lastUsedThrottleSeconds': 'lastUsedThrottleSeconds',
} as const satisfies Partial<Record<PlainSettingKey, keyof AppConfig>>;

export interface SettingView {
  key: SettingKey;
  group: string;
  label: string;
  description: string;
  type: string;
  secret: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  /** Non-secret only. */
  value?: unknown;
  defaultValue?: unknown;
  source: 'database' | 'environment' | 'default';
  /** Secrets only: write-only metadata. */
  isSet?: boolean;
  last4?: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface Actor {
  id: string | null;
  email: string | null;
  type: 'operator' | 'bootstrap' | 'recovery' | 'system';
  ip?: string | null;
}

export interface SettingsProvider {
  get<K extends PlainSettingKey>(key: K): SettingValue<K>;
  getSecret(key: SecretSettingKey): Promise<string | null>;
  /** Reloads the snapshot if older than the TTL (or always with force). Never throws. */
  refresh(force?: boolean): Promise<void>;
  invalidate(): void;
  isSuspendedCredentialHash(hash: string): boolean;
  readonly configVersion: number;
  configView(base: AppConfig): AppConfig;
  list(): Promise<SettingView[]>;
  set(key: string, value: unknown, actor: Actor): Promise<void>;
  reset(key: string, actor: Actor): Promise<void>;
  readonly keystore: Keystore;
}

export interface SettingsOptions {
  odb: OperatorDb;
  clock: () => Date;
  keystoreEnv: KeystoreEnv | null;
  /** Wrangler vars/secrets (fallback layer for settings with `envVar`). */
  vars?: Record<string, string | undefined>;
  ttlMs?: number;
  logError?: (message: string, error: unknown) => void;
}

export function createSettingsProvider(opts: SettingsOptions): SettingsProvider {
  const { odb, clock } = opts;
  const ttl = opts.ttlMs ?? SNAPSHOT_TTL_MS;
  const keystore = createKeystore(odb, opts.keystoreEnv ?? { initialPassword: '' }, clock);
  let rows = new Map<string, SettingRow>();
  let suspended = new Set<string>();
  let version = 0;
  let stateKey = '';
  let loadedAt = -Infinity;
  let inflight: Promise<void> | null = null;
  const secretCache = new Map<string, { tag: string; value: string }>();

  function envValue(key: SettingKey): unknown {
    const def = definitionOf(key);
    return def.envVar ? parseEnvValue(def, opts.vars?.[def.envVar]) : undefined;
  }

  function plainValue(key: SettingKey): { value: unknown; source: SettingView['source'] } | undefined {
    const row = rows.get(key);
    if (row && !row.secret && row.value !== null) {
      try {
        const parsed = definitionOf(key).schema.safeParse(JSON.parse(row.value));
        if (parsed.success) return { value: parsed.data, source: 'database' };
      } catch {
        // fall through to defaults
      }
    }
    return undefined;
  }

  async function load() {
    try {
      const snap = await odb.loadSnapshot();
      rows = new Map(snap.settings.map((r) => [r.key, r]));
      suspended = new Set(snap.suspendedHashes);
      const nextKey = snap.state ? `${snap.state.config_version}:${snap.state.mk_version}:${snap.state.dek_version}` : '';
      if (nextKey !== stateKey) {
        secretCache.clear();
        keystore.invalidate();
        stateKey = nextKey;
      }
      version = snap.state?.config_version ?? 0;
      loadedAt = clock().getTime();
    } catch (error) {
      // Keep serving the previous snapshot (or defaults); try again after the TTL.
      loadedAt = clock().getTime();
      opts.logError?.('Failed to load runtime settings', error);
    }
  }

  const provider: SettingsProvider = {
    keystore,
    get configVersion() {
      return version;
    },

    get<K extends PlainSettingKey>(key: K): SettingValue<K> {
      const fromDb = plainValue(key);
      if (fromDb) return fromDb.value as SettingValue<K>;
      const fromEnv = envValue(key);
      if (fromEnv !== undefined) return fromEnv as SettingValue<K>;
      return SETTINGS[key].default as SettingValue<K>;
    },

    async getSecret(key) {
      const row = rows.get(key);
      if (row?.secret && row.value_enc) {
        const tag = `${row.version}:${row.dek_version}:${stateKey}`;
        const cached = secretCache.get(key);
        if (cached?.tag === tag) return cached.value;
        const value = await keystore.decrypt(row);
        secretCache.set(key, { tag, value });
        return value;
      }
      const fromEnv = envValue(key);
      return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : null;
    },

    async refresh(force = false) {
      if (!force && clock().getTime() - loadedAt < ttl) return;
      inflight ??= load().finally(() => {
        inflight = null;
      });
      await inflight;
    },

    invalidate() {
      loadedAt = -Infinity;
      secretCache.clear();
      keystore.invalidate();
    },

    isSuspendedCredentialHash(hash) {
      return suspended.has(hash);
    },

    configView(base) {
      const view = { ...base };
      for (const [key, field] of Object.entries(CONFIG_FIELDS) as [PlainSettingKey, keyof AppConfig][]) {
        Object.defineProperty(view, field, {
          enumerable: true,
          get() {
            const fromDb = plainValue(key);
            if (fromDb) return key === 'app.url' ? (fromDb.value as string) || base.appUrl : fromDb.value;
            return base[field];
          },
        });
      }
      return view;
    },

    async list() {
      await provider.refresh(true);
      return SETTING_KEYS.filter((k) => !definitionOf(k).internal).map((key): SettingView => {
        const def = definitionOf(key);
        const row = rows.get(key);
        const common = {
          key,
          group: def.group,
          label: def.label,
          description: def.description,
          type: def.type,
          secret: def.secret,
          ...(def.options ? { options: def.options } : {}),
          ...(def.min !== undefined ? { min: def.min, max: def.max } : {}),
          updatedAt: row?.updated_at ?? null,
          updatedBy: row?.updated_by ?? null,
        };
        if (def.secret) {
          const envSet = !!(def.envVar && opts.vars?.[def.envVar]);
          return {
            ...common,
            isSet: !!row?.value_enc || envSet,
            last4: row?.value_enc ? row.last4 : null,
            source: row?.value_enc ? 'database' : envSet ? 'environment' : 'default',
          };
        }
        const fromDb = plainValue(key);
        const fromEnv = envValue(key);
        return {
          ...common,
          value: provider.get(key as PlainSettingKey),
          defaultValue: def.default,
          source: fromDb ? 'database' : fromEnv !== undefined ? 'environment' : 'default',
        };
      });
    },

    async set(key, value, actor) {
      if (!isSettingKey(key) || definitionOf(key).internal && actor.type !== 'system') {
        throw OperatorError.validation(`Unknown setting "${key}"`);
      }
      const def = definitionOf(key);
      const parsed = def.schema.safeParse(value);
      if (!parsed.success) {
        throw OperatorError.validation(parsed.error.issues[0]?.message ?? 'Invalid value', { key, issues: parsed.error.issues.map((i) => i.message) });
      }
      const now = clock().getTime();
      const existing = await odb.getSetting(key);
      const nextVersion = (existing?.version ?? 0) + 1;
      if (def.secret) {
        const plain = parsed.data as string;
        let applied = false;
        for (let attempt = 0; attempt < 2 && !applied; attempt++) {
          const { valueEnc, dekVersion } = await keystore.encrypt(key, plain, nextVersion);
          const res = await odb.upsertSecretSettingStatement({
            key,
            value_enc: valueEnc,
            last4: plain.length >= 12 ? plain.slice(-4) : null,
            version: nextVersion,
            dek_version: dekVersion,
            updated_at: now,
            updated_by: actor.email ?? actor.type,
          }).run();
          applied = (res.meta.changes ?? 0) > 0;
          if (!applied) keystore.invalidate();
        }
        if (!applied) throw OperatorError.conflict('concurrent_change', 'The encryption keys changed concurrently; try again.');
      } else {
        await odb.upsertSettingStatement({
          key,
          secret: 0,
          value: JSON.stringify(parsed.data),
          value_enc: null,
          last4: null,
          version: nextVersion,
          dek_version: null,
          updated_at: now,
          updated_by: actor.email ?? actor.type,
        }).run();
      }
      if (!def.internal) {
        await odb.raw.batch([
          odb.auditStatement({
            at: now,
            actorType: actor.type,
            actorId: actor.id,
            actorEmail: actor.email,
            action: 'settings.update',
            target: key,
            detail: def.secret ? { secret: true } : { value: parsed.data },
            ip: actor.ip,
          }),
          odb.bumpConfigVersionStatement(),
        ]);
      }
      provider.invalidate();
      await provider.refresh(true);
    },

    async reset(key, actor) {
      if (!isSettingKey(key) || definitionOf(key).internal) throw OperatorError.validation(`Unknown setting "${key}"`);
      const now = clock().getTime();
      await odb.raw.batch([
        odb.deleteSettingStatement(key),
        odb.auditStatement({ at: now, actorType: actor.type, actorId: actor.id, actorEmail: actor.email, action: 'settings.reset', target: key, ip: actor.ip }),
        odb.bumpConfigVersionStatement(),
      ]);
      provider.invalidate();
      await provider.refresh(true);
    },
  };
  return provider;
}
