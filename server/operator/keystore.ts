/**
 * Envelope encryption for secret settings.
 *
 *   master key MK (256-bit; random, or PBKDF2 from an operator passphrase)
 *     ├─ "wrapped" mode: sealed in D1 under KEK = PBKDF2-SHA-256(INITIAL_PASSWORD, kek_salt, 100k, the Workers maximum)
 *     └─ "env" mode (hardened): only in the ENCRYPTION_KEY Worker secret; D1 holds no copy
 *   MK seals the DEK (AES-256-GCM), the DEK seals every secret value
 *   (AES-256-GCM, random 96-bit IV, AAD = setting key + row version + DEK version).
 *
 * Failure handling: any GCM authentication failure (changed root secret,
 * tampering, wrong context) makes the store "locked". Secrets then read as
 * unavailable and every write is refused; nothing is re-encrypted with a key
 * that might be wrong. Recovery = entering the recovery key (or passphrase).
 */
import {
  KEK_PBKDF2_ITERATIONS,
  LEGACY_KEK_PBKDF2_ITERATIONS,
  PASSPHRASE_PBKDF2_ITERATIONS,
  aesGcmDecrypt,
  aesGcmEncrypt,
  decodeMasterKey,
  decryptString,
  encodeMasterKey,
  encryptString,
  fromBase64Url,
  importAesKey,
  keyCheckValue,
  passphraseProblem,
  pbkdf2,
  randomBytes,
  secretsEqual,
  toBase64Url,
  DecryptionError,
} from './crypto';
import type { OperatorDb, OperatorStateRow, SettingRow } from './db';
import { OperatorError } from './errors';

export interface KeystoreEnv {
  initialPassword: string;
  /** Hardened mode: the master key (recovery-key format) set as a Worker secret. */
  encryptionKey?: string;
}

export type KeystoreProblem = 'root_secret_changed' | 'env_key_missing' | 'env_key_mismatch' | 'corrupt';

export interface EncryptionStatus {
  initialized: boolean;
  confirmed: boolean;
  mode: 'wrapped' | 'env' | null;
  state: 'uninitialized' | 'unlocked' | 'locked';
  problem: KeystoreProblem | null;
  envKeyPresent: boolean;
  /** ENCRYPTION_KEY is set and matches the master key check value. */
  envKeyMatches: boolean;
  pendingRewrap: boolean;
  pendingMasterRotation: boolean;
  masterKeyVersion: number;
  masterKeySource: 'generated' | 'passphrase' | null;
  masterKeyCreatedAt: number | null;
  dekVersion: number;
  dekRotatedAt: number | null;
  kdf: { algorithm: 'PBKDF2-SHA-256'; iterations: number } | null;
  cipher: 'AES-256-GCM';
}

interface Unlocked {
  mk: Uint8Array;
  dek: CryptoKey;
  dekVersion: number;
  cacheKey: string;
}

const MK_WRAP_AAD = 'mi/mk-wrap/v1';
const dekWrapAad = (dekVersion: number) => `mi/dek-wrap/v1|${dekVersion}`;
export const settingAad = (key: string, version: number, dekVersion: number) => `mi/setting/v1|${key}|${version}|${dekVersion}`;

export function createKeystore(odb: OperatorDb, env: KeystoreEnv, clock: () => Date) {
  let unlocked: Unlocked | null = null;
  let lastProblem: { cacheKey: string; problem: KeystoreProblem } | null = null;
  const kekCache = new Map<string, Uint8Array>();

  const now = () => clock().getTime();
  const cacheKeyOf = (s: OperatorStateRow) =>
    [s.mk_version, s.dek_version, s.mk_kcv, s.mk_mode, s.kek_salt, s.mk_pending_kcv, s.kek_pending_salt, !!env.encryptionKey].join(':');

  async function kekFor(salt: string, iterations: number): Promise<CryptoKey> {
    const id = `${salt}:${iterations}`;
    let raw = kekCache.get(id);
    if (!raw) {
      raw = await pbkdf2(env.initialPassword, fromBase64Url(salt), iterations);
      kekCache.set(id, raw);
    }
    return importAesKey(raw);
  }

  async function wrapMk(mk: Uint8Array): Promise<{ mk_wrapped: string; kek_salt: string; kek_iterations: number }> {
    const salt = toBase64Url(randomBytes(16));
    const kek = await kekFor(salt, KEK_PBKDF2_ITERATIONS);
    return { mk_wrapped: await aesGcmEncrypt(kek, mk, MK_WRAP_AAD), kek_salt: salt, kek_iterations: KEK_PBKDF2_ITERATIONS };
  }

  async function wrapDek(mk: Uint8Array, dekRaw: Uint8Array, dekVersion: number): Promise<string> {
    return aesGcmEncrypt(await importAesKey(mk), dekRaw, dekWrapAad(dekVersion));
  }

  async function tryUnwrapMk(state: OperatorStateRow, wrapped: string | null, salt: string | null, iterations: number): Promise<Uint8Array | null> {
    if (!wrapped || !salt) return null;
    try {
      const mk = await aesGcmDecrypt(await kekFor(salt, iterations), wrapped, MK_WRAP_AAD);
      return (await keyCheckValue(mk)) === state.mk_kcv ? mk : null;
    } catch (e) {
      if (e instanceof DecryptionError) return null;
      throw e;
    }
  }

  function envMk(): Uint8Array | null {
    return env.encryptionKey ? decodeMasterKey(env.encryptionKey) : null;
  }

  /** Resolves MK for the current state, promoting pending re-wraps/rotations when the deployed secret now matches them. */
  async function resolveMk(state: OperatorStateRow): Promise<{ mk: Uint8Array } | { problem: KeystoreProblem }> {
    const fromEnv = envMk();
    const envKcv = fromEnv ? await keyCheckValue(fromEnv) : null;

    // A pending master-key rotation in env mode completes once ENCRYPTION_KEY holds the new key.
    if (fromEnv && state.mk_pending_kcv && envKcv === state.mk_pending_kcv && state.dek_pending_wrapped) {
      const ok = await odb.updateState(
        {
          mk_kcv: state.mk_pending_kcv,
          mk_version: state.mk_version + 1,
          dek_wrapped: state.dek_pending_wrapped,
          mk_pending_kcv: null,
          dek_pending_wrapped: null,
          mk_passphrase_salt: null,
          mk_passphrase_iterations: null,
          mk_created_at: now(),
          config_version: state.config_version + 1,
        },
        { mk_version: state.mk_version },
        [odb.auditStatement({ at: now(), actorType: 'system', action: 'encryption.master_rotation_completed', detail: { mode: 'env' } })],
      );
      if (ok) throw new RetryUnlock();
    }

    if (state.mk_mode === 'env') {
      if (!fromEnv) return { problem: 'env_key_missing' };
      if (envKcv !== state.mk_kcv) return { problem: 'env_key_mismatch' };
      return { mk: fromEnv };
    }

    // Wrapped mode. A matching ENCRYPTION_KEY also works (it is the same key).
    if (fromEnv && envKcv === state.mk_kcv) return { mk: fromEnv };
    const storedIterations = state.kek_iterations ?? LEGACY_KEK_PBKDF2_ITERATIONS;
    const current = await tryUnwrapMk(state, state.mk_wrapped, state.kek_salt, storedIterations);
    if (current) {
      if (storedIterations < KEK_PBKDF2_ITERATIONS) {
        // Upgrade on unlock (security fix L4): re-wrap under a KEK with the current iteration count.
        // Compare-and-set on the salt, so concurrent isolates upgrade once; a lost race keeps the old wrap working.
        const upgraded = await wrapMk(current);
        if (await odb.updateState({ ...upgraded, config_version: state.config_version + 1 }, { kek_salt: state.kek_salt })) {
          await odb.audit({ at: now(), actorType: 'system', action: 'encryption.kdf_upgraded', detail: { from: storedIterations, to: KEK_PBKDF2_ITERATIONS } });
        }
      }
      return { mk: current };
    }
    // Pending wraps (prepare re-wrap) are always made with the current iteration count.
    const pending = await tryUnwrapMk(state, state.mk_pending_wrapped, state.kek_pending_salt, KEK_PBKDF2_ITERATIONS);
    if (pending) {
      // INITIAL_PASSWORD was changed after "prepare re-wrap": promote the pending wrap.
      const ok = await odb.updateState(
        {
          mk_wrapped: state.mk_pending_wrapped,
          kek_salt: state.kek_pending_salt,
          kek_iterations: KEK_PBKDF2_ITERATIONS,
          mk_pending_wrapped: null,
          kek_pending_salt: null,
          config_version: state.config_version + 1,
        },
        { kek_salt: state.kek_salt },
        [odb.auditStatement({ at: now(), actorType: 'system', action: 'encryption.rewrap_completed' })],
      );
      if (ok) throw new RetryUnlock();
      return { mk: pending };
    }
    return { problem: 'root_secret_changed' };
  }

  async function unlockState(state: OperatorStateRow): Promise<Unlocked | { problem: KeystoreProblem }> {
    const key = cacheKeyOf(state);
    if (unlocked?.cacheKey === key) return unlocked;
    if (lastProblem?.cacheKey === key) return { problem: lastProblem.problem };
    const res = await resolveMk(state);
    if ('problem' in res) {
      lastProblem = { cacheKey: key, problem: res.problem };
      return res;
    }
    if (!state.dek_wrapped) return { problem: 'corrupt' };
    try {
      const dekRaw = await aesGcmDecrypt(await importAesKey(res.mk), state.dek_wrapped, dekWrapAad(state.dek_version));
      unlocked = { mk: res.mk, dek: await importAesKey(dekRaw), dekVersion: state.dek_version, cacheKey: key };
      lastProblem = null;
      return unlocked;
    } catch (e) {
      if (!(e instanceof DecryptionError)) throw e;
      lastProblem = { cacheKey: key, problem: 'corrupt' };
      return { problem: 'corrupt' };
    }
  }

  async function loadUnlocked(): Promise<{ state: OperatorStateRow; keys: Unlocked | null; problem: KeystoreProblem | null }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await odb.getState();
      if (!state?.mk_kcv) return { state: state!, keys: null, problem: null };
      try {
        const r = await unlockState(state);
        return 'problem' in r ? { state, keys: null, problem: r.problem } : { state, keys: r, problem: null };
      } catch (e) {
        if (e instanceof RetryUnlock) continue;
        throw e;
      }
    }
    throw new Error('Keystore state kept changing during unlock');
  }

  async function requireUnlocked(): Promise<{ state: OperatorStateRow; keys: Unlocked }> {
    const { state, keys, problem } = await loadUnlocked();
    if (!state?.mk_kcv) throw OperatorError.conflict('encryption_uninitialized', 'The encryption key has not been set up yet.');
    if (!keys) throw lockedError(problem);
    return { state, keys };
  }

  async function newMasterKey(input: { mode: 'generate' } | { mode: 'passphrase'; passphrase: string }) {
    if (input.mode === 'generate') return { mk: randomBytes(32), passphraseSalt: null as string | null };
    const problem = passphraseProblem(input.passphrase);
    if (problem) throw OperatorError.validation(problem, { field: 'passphrase' });
    if (await secretsEqual(input.passphrase, env.initialPassword)) {
      throw OperatorError.validation('The passphrase must differ from INITIAL_PASSWORD.', { field: 'passphrase' });
    }
    const salt = toBase64Url(randomBytes(16));
    return { mk: await pbkdf2(input.passphrase, fromBase64Url(salt), PASSPHRASE_PBKDF2_ITERATIONS), passphraseSalt: salt };
  }

  /** Re-encrypts secret rows that a concurrent write left on an old DEK version. */
  async function reencryptStragglers(oldDek: CryptoKey, oldVersion: number, newDek: CryptoKey, newVersion: number) {
    const rows = (await odb.listSettings()).filter((r) => r.secret && r.value_enc && r.dek_version === oldVersion);
    if (rows.length === 0) return;
    const stmts: D1PreparedStatement[] = [];
    for (const r of rows) {
      const plain = await decryptString(oldDek, r.value_enc!, settingAad(r.key, r.version, oldVersion));
      stmts.push(odb.reencryptSettingStatement(r.key, await encryptString(newDek, plain, settingAad(r.key, r.version, newVersion)), newVersion, r.version));
    }
    await odb.raw.batch(stmts);
  }

  const keystore = {
    async status(): Promise<EncryptionStatus> {
      const { state, keys, problem } = await loadUnlocked();
      const fromEnv = envMk();
      const envKeyMatches = !!(fromEnv && state?.mk_kcv && (await keyCheckValue(fromEnv)) === state.mk_kcv);
      return {
        initialized: !!state?.mk_kcv,
        confirmed: !!state?.mk_confirmed_at,
        mode: state?.mk_mode ?? null,
        state: !state?.mk_kcv ? 'uninitialized' : keys ? 'unlocked' : 'locked',
        problem,
        envKeyPresent: !!env.encryptionKey,
        envKeyMatches,
        pendingRewrap: !!state?.mk_pending_wrapped,
        pendingMasterRotation: !!state?.mk_pending_kcv,
        masterKeyVersion: state?.mk_version ?? 0,
        masterKeySource: !state?.mk_kcv ? null : state.mk_passphrase_salt ? 'passphrase' : 'generated',
        masterKeyCreatedAt: state?.mk_created_at ?? null,
        dekVersion: state?.dek_version ?? 0,
        dekRotatedAt: state?.dek_rotated_at ?? null,
        kdf: state?.mk_mode === 'wrapped' ? { algorithm: 'PBKDF2-SHA-256', iterations: state.kek_iterations ?? KEK_PBKDF2_ITERATIONS } : null,
        cipher: 'AES-256-GCM',
      };
    },

    /** True when secrets can be read and written right now. */
    async isUnlocked(): Promise<boolean> {
      return !!(await loadUnlocked()).keys;
    },

    /**
     * Wizard step: creates (or, until confirmed, replaces) the master key in
     * wrapped mode and returns the recovery key. This is the only time the
     * key leaves the server.
     */
    async initialize(input: { mode: 'generate' } | { mode: 'passphrase'; passphrase: string }): Promise<{ recoveryKey: string }> {
      const state = await odb.getState();
      if (!state) throw new Error('operator_state missing');
      if (state.mk_confirmed_at) throw OperatorError.conflict('encryption_confirmed', 'The encryption key is already set up.');
      const secretRows = (await odb.listSettings()).filter((r) => r.secret);
      if (secretRows.length > 0) throw OperatorError.conflict('encryption_in_use', 'Secrets are already stored with the current key.');
      const { mk, passphraseSalt } = await newMasterKey(input);
      const dekRaw = randomBytes(32);
      const dekVersion = state.dek_version + 1;
      const wrapped = await wrapMk(mk);
      const ok = await odb.updateState(
        {
          mk_kcv: await keyCheckValue(mk),
          mk_version: state.mk_version + 1,
          mk_mode: 'wrapped',
          mk_created_at: now(),
          ...wrapped,
          mk_pending_wrapped: null,
          kek_pending_salt: null,
          mk_pending_kcv: null,
          dek_pending_wrapped: null,
          mk_passphrase_salt: passphraseSalt,
          mk_passphrase_iterations: passphraseSalt ? PASSPHRASE_PBKDF2_ITERATIONS : null,
          dek_wrapped: await wrapDek(mk, dekRaw, dekVersion),
          dek_version: dekVersion,
          dek_rotated_at: now(),
          config_version: state.config_version + 1,
        },
        { mk_version: state.mk_version, mk_confirmed_at: null },
      );
      if (!ok) throw OperatorError.conflict('concurrent_change', 'The encryption setup changed concurrently; reload and try again.');
      unlocked = null;
      return { recoveryKey: encodeMasterKey(mk) };
    },

    async confirm(): Promise<void> {
      const state = await odb.getState();
      if (!state?.mk_kcv) throw OperatorError.conflict('encryption_uninitialized', 'Create the encryption key first.');
      if (!state.mk_confirmed_at) await odb.updateState({ mk_confirmed_at: now() }, { mk_confirmed_at: null });
    },

    async encrypt(key: string, value: string, version: number): Promise<{ valueEnc: string; dekVersion: number }> {
      const { keys } = await requireUnlocked();
      return { valueEnc: await encryptString(keys.dek, value, settingAad(key, version, keys.dekVersion)), dekVersion: keys.dekVersion };
    },

    /** Decrypts a stored secret. Throws OperatorError (locked) or DecryptionError (tampered row). */
    async decrypt(row: Pick<SettingRow, 'key' | 'value_enc' | 'version' | 'dek_version'>): Promise<string> {
      const { keys } = await requireUnlocked();
      if (!row.value_enc) throw new DecryptionError();
      return decryptString(keys.dek, row.value_enc, settingAad(row.key, row.version, row.dek_version ?? keys.dekVersion));
    },

    /** New DEK; every secret is re-encrypted in one transaction. */
    async rotateDek(): Promise<{ dekVersion: number; reencrypted: number }> {
      const { state, keys } = await requireUnlocked();
      const newRaw = randomBytes(32);
      const newDek = await importAesKey(newRaw);
      const newVersion = state.dek_version + 1;
      const rows = (await odb.listSettings()).filter((r) => r.secret && r.value_enc);
      const stmts: D1PreparedStatement[] = [];
      for (const r of rows) {
        const plain = await decryptString(keys.dek, r.value_enc!, settingAad(r.key, r.version, r.dek_version ?? keys.dekVersion));
        stmts.push(odb.reencryptSettingStatement(r.key, await encryptString(newDek, plain, settingAad(r.key, r.version, newVersion)), newVersion, r.version));
      }
      const pendingDek = state.dek_pending_wrapped && state.mk_pending_kcv ? null : undefined;
      const ok = await odb.updateState(
        {
          dek_wrapped: await wrapDek(keys.mk, newRaw, newVersion),
          dek_version: newVersion,
          dek_rotated_at: now(),
          config_version: state.config_version + 1,
          // A pending env-mode master rotation sealed the old DEK; it must be prepared again.
          ...(pendingDek === null ? { dek_pending_wrapped: null, mk_pending_kcv: null } : {}),
        },
        { dek_version: state.dek_version },
        stmts,
      );
      if (!ok) throw OperatorError.conflict('concurrent_change', 'The keys changed concurrently; reload and try again.');
      await reencryptStragglers(keys.dek, keys.dekVersion, newDek, newVersion);
      unlocked = null;
      return { dekVersion: newVersion, reencrypted: rows.length };
    },

    /**
     * New master key. Wrapped mode: immediate (DEK re-sealed, MK wrapped under INITIAL_PASSWORD).
     * Env mode: prepared; completes once ENCRYPTION_KEY is set to the new key.
     */
    async rotateMaster(input: { mode: 'generate' } | { mode: 'passphrase'; passphrase: string }): Promise<{ recoveryKey: string; pending: boolean }> {
      const { state, keys } = await requireUnlocked();
      const { mk, passphraseSalt } = await newMasterKey(input);
      const dekRaw = await aesGcmDecrypt(await importAesKey(keys.mk), state.dek_wrapped!, dekWrapAad(state.dek_version));
      const kcv = await keyCheckValue(mk);
      if (state.mk_mode === 'env') {
        const ok = await odb.updateState(
          { mk_pending_kcv: kcv, dek_pending_wrapped: await wrapDek(mk, dekRaw, state.dek_version), config_version: state.config_version + 1 },
          { mk_version: state.mk_version, dek_version: state.dek_version },
        );
        if (!ok) throw OperatorError.conflict('concurrent_change', 'The keys changed concurrently; reload and try again.');
        return { recoveryKey: encodeMasterKey(mk), pending: true };
      }
      const ok = await odb.updateState(
        {
          mk_kcv: kcv,
          mk_version: state.mk_version + 1,
          mk_created_at: now(),
          ...(await wrapMk(mk)),
          mk_pending_wrapped: null,
          kek_pending_salt: null,
          mk_passphrase_salt: passphraseSalt,
          mk_passphrase_iterations: passphraseSalt ? PASSPHRASE_PBKDF2_ITERATIONS : null,
          dek_wrapped: await wrapDek(mk, dekRaw, state.dek_version),
          config_version: state.config_version + 1,
        },
        { mk_version: state.mk_version, dek_version: state.dek_version },
      );
      if (!ok) throw OperatorError.conflict('concurrent_change', 'The keys changed concurrently; reload and try again.');
      unlocked = null;
      return { recoveryKey: encodeMasterKey(mk), pending: false };
    },

    /**
     * Wrapped mode, step 1 of changing INITIAL_PASSWORD: seals MK under a KEK
     * from the new value. Step 2 is `wrangler secret put INITIAL_PASSWORD`;
     * the next unlock with the new secret promotes the pending wrap.
     */
    async prepareRewrap(newInitialPassword: string): Promise<void> {
      const { state, keys } = await requireUnlocked();
      if (state.mk_mode !== 'wrapped') throw OperatorError.conflict('wrong_mode', 'Re-wrapping applies to the default (wrapped) mode only.');
      if (newInitialPassword.length < 24) throw OperatorError.validation('Use at least 24 characters (e.g. openssl rand -base64 32).', { field: 'newInitialPassword' });
      if (await secretsEqual(newInitialPassword, env.initialPassword)) {
        throw OperatorError.validation('That is the current INITIAL_PASSWORD.', { field: 'newInitialPassword' });
      }
      const salt = toBase64Url(randomBytes(16));
      const raw = await pbkdf2(newInitialPassword, fromBase64Url(salt), KEK_PBKDF2_ITERATIONS);
      const sealed = await aesGcmEncrypt(await importAesKey(raw), keys.mk, MK_WRAP_AAD);
      await odb.updateState({ mk_pending_wrapped: sealed, kek_pending_salt: salt, config_version: state.config_version + 1 }, { mk_version: state.mk_version });
    },

    async cancelPending(): Promise<void> {
      const state = await odb.getState();
      if (!state) return;
      await odb.updateState({ mk_pending_wrapped: null, kek_pending_salt: null, mk_pending_kcv: null, dek_pending_wrapped: null, config_version: state.config_version + 1 });
    },

    /** Hardened mode: requires a matching ENCRYPTION_KEY, then deletes the wrapped copy from D1. */
    async enableEnvMode(): Promise<void> {
      const { state, keys } = await requireUnlocked();
      const fromEnv = envMk();
      if (!fromEnv) throw OperatorError.conflict('env_key_missing', 'ENCRYPTION_KEY is not set on this deployment.');
      if ((await keyCheckValue(fromEnv)) !== state.mk_kcv) {
        throw OperatorError.conflict('env_key_mismatch', 'ENCRYPTION_KEY does not match the current master key (check value differs).');
      }
      void keys;
      await odb.updateState(
        { mk_mode: 'env', mk_wrapped: null, kek_salt: null, kek_iterations: null, mk_pending_wrapped: null, kek_pending_salt: null, config_version: state.config_version + 1 },
        { mk_version: state.mk_version },
      );
      unlocked = null;
    },

    /** Back to the default mode: MK wrapped in D1 under INITIAL_PASSWORD. */
    async disableEnvMode(): Promise<void> {
      const { state, keys } = await requireUnlocked();
      if (state.mk_mode !== 'env') return;
      await odb.updateState(
        { mk_mode: 'wrapped', ...(await wrapMk(keys.mk)), mk_pending_kcv: null, dek_pending_wrapped: null, config_version: state.config_version + 1 },
        { mk_version: state.mk_version },
      );
      unlocked = null;
    },

    /**
     * Restores access with the recovery key (or the passphrase the master key
     * was derived from): verifies the check value, then wraps MK under the
     * current INITIAL_PASSWORD (wrapped mode). Only allowed while locked.
     */
    async recover(input: string): Promise<boolean> {
      const { state, keys } = await loadUnlocked();
      if (!state?.mk_kcv) throw OperatorError.conflict('encryption_uninitialized', 'Nothing to recover.');
      if (keys) throw OperatorError.conflict('not_locked', 'The encrypted settings are not locked.');
      let mk = decodeMasterKey(input);
      if (!mk && state.mk_passphrase_salt && input.length >= 20 && input.length <= 1024) {
        mk = await pbkdf2(input, fromBase64Url(state.mk_passphrase_salt), state.mk_passphrase_iterations ?? PASSPHRASE_PBKDF2_ITERATIONS);
      }
      if (!mk || (await keyCheckValue(mk)) !== state.mk_kcv) return false;
      await odb.updateState(
        { mk_mode: 'wrapped', ...(await wrapMk(mk)), mk_pending_wrapped: null, kek_pending_salt: null, config_version: state.config_version + 1 },
        { mk_version: state.mk_version },
      );
      unlocked = null;
      lastProblem = null;
      return true;
    },

    /** Drops cached keys (after a version change seen in another isolate). */
    invalidate() {
      unlocked = null;
      lastProblem = null;
    },
  };
  return keystore;
}

export type Keystore = ReturnType<typeof createKeystore>;

class RetryUnlock extends Error {}

export function lockedError(problem: KeystoreProblem | null): OperatorError {
  const messages: Record<KeystoreProblem, string> = {
    root_secret_changed:
      'Encrypted settings are locked: INITIAL_PASSWORD no longer unwraps the master key (it was changed without a re-wrap). Restore the previous value, or enter the recovery key.',
    env_key_missing: 'Encrypted settings are locked: hardened mode is on but ENCRYPTION_KEY is not set. Set it again, or enter the recovery key.',
    env_key_mismatch: 'Encrypted settings are locked: ENCRYPTION_KEY does not match the master key. Set the right value, or enter the recovery key.',
    corrupt: 'Encrypted settings are locked: the data-encryption key failed authentication (tampered or corrupt). Enter the recovery key.',
  };
  return new OperatorError(423, 'encryption_locked', problem ? messages[problem] : 'Encrypted settings are locked.', { problem });
}
