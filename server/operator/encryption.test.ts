import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startD1 } from '../test/helpers';
import {
  GITHUB_TOKEN,
  INITIAL_PASSWORD,
  WORKOS_API_KEY,
  browser,
  buildOperatorApp,
  completeSetup,
  fakeWorkos,
  routeFetch,
  signIn,
} from '../test/operator';
import { aesGcmDecrypt, aesGcmEncrypt, decodeMasterKey, encodeMasterKey, importAesKey, keyCheckValue, randomBytes, DecryptionError } from './crypto';
import { createOperatorDb } from './db';
import { createKeystore, settingAad } from './keystore';

let d1: Awaited<ReturnType<typeof startD1>>;
beforeAll(async () => {
  d1 = await startD1();
});
afterAll(async () => {
  await d1?.close();
});

const TABLES = ['operator_sessions', 'operators', 'operator_oauth_states', 'operator_login_attempts', 'operator_settings', 'operator_audit', 'operator_state'];
beforeEach(async () => {
  await d1.db.batch(TABLES.map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
});

const workos = fakeWorkos();
const appWith = (opts: { initialPassword?: string; encryptionKey?: string } = {}) =>
  buildOperatorApp(d1.db, { fetch: routeFetch({ 'api.workos.com': workos.fetch }), ...opts });

const OWNER = { id: 'user_owner', email: 'owner@example.com' };
const state = () => d1.db.prepare('SELECT * FROM operator_state WHERE id = 1').first<Record<string, unknown>>();
const settingRow = (key: string) => d1.db.prepare('SELECT * FROM operator_settings WHERE key = ?').bind(key).first<Record<string, unknown>>();

describe('AES-256-GCM primitives', () => {
  it('round-trips, uses a fresh IV per write, and detects tampering and AAD changes', async () => {
    const key = await importAesKey(randomBytes(32));
    const plain = new TextEncoder().encode('secret value');
    const a = await aesGcmEncrypt(key, plain, 'ctx');
    const b = await aesGcmEncrypt(key, plain, 'ctx');
    expect(a).not.toBe(b);
    expect(new TextDecoder().decode(await aesGcmDecrypt(key, a, 'ctx'))).toBe('secret value');
    const flipped = a.slice(0, 20) + (a[20] === 'A' ? 'B' : 'A') + a.slice(21);
    await expect(aesGcmDecrypt(key, flipped, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
    await expect(aesGcmDecrypt(key, a, 'other-ctx')).rejects.toBeInstanceOf(DecryptionError);
    await expect(aesGcmDecrypt(await importAesKey(randomBytes(32)), a, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('encodes master keys as recovery keys and identifies them by check value', async () => {
    const mk = randomBytes(32);
    const encoded = encodeMasterKey(mk);
    expect(encoded).toMatch(/^mi_mk_[A-Za-z0-9_-]{43}$/);
    expect(decodeMasterKey(encoded)).toEqual(mk);
    expect(decodeMasterKey('mi_mk_short')).toBeNull();
    expect(await keyCheckValue(mk)).toBe(await keyCheckValue(decodeMasterKey(encoded)!));
    expect(await keyCheckValue(mk)).not.toBe(await keyCheckValue(randomBytes(32)));
  });
});

describe('envelope encryption of settings', () => {
  it('stores secrets only as ciphertext bound to key + version (AAD)', async () => {
    const { app } = appWith();
    const { browser: b } = await completeSetup(app, workos, OWNER);
    expect((await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN })).status).toBe(200);
    const row = await settingRow('github.token');
    expect(row!.value).toBeNull();
    expect(String(row!.value_enc)).not.toContain(GITHUB_TOKEN);
    expect(row!.last4).toBe(GITHUB_TOKEN.slice(-4));

    // Copying the ciphertext under another key fails authentication (AAD binds the key).
    await d1.db.prepare("UPDATE operator_settings SET value_enc = ?, version = ?, dek_version = ? WHERE key = 'workos.apiKey'").bind(row!.value_enc, row!.version, row!.dek_version).run();
    const ks = createKeystore(createOperatorDb(d1.db), { initialPassword: INITIAL_PASSWORD }, () => new Date());
    const moved = (await settingRow('workos.apiKey'))!;
    await expect(ks.decrypt(moved as never)).rejects.toBeInstanceOf(DecryptionError);
    await expect(ks.decrypt(row as never)).resolves.toBe(GITHUB_TOKEN);
    // Bumping the version without re-encrypting also fails.
    await expect(ks.decrypt({ ...(row as object), version: Number(row!.version) + 1 } as never)).rejects.toBeInstanceOf(DecryptionError);
    expect(settingAad('a', 1, 1)).not.toBe(settingAad('b', 1, 1));
  });

  it('fails closed (no data returned) when a stored secret was tampered with', async () => {
    const { app } = appWith();
    const { browser: b } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    await b.put('/api/operator/settings/github.repository', { value: 'acme/site' });
    const enc = String((await settingRow('github.token'))!.value_enc);
    await d1.db.prepare("UPDATE operator_settings SET value_enc = ? WHERE key = 'github.token'").bind(enc.slice(0, -3) + 'AAA').run();
    const fresh = appWith();
    const s2 = await signIn(fresh.app, workos, OWNER);
    const res = await s2.browser.post('/api/operator/deployments/redeploy');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(GITHUB_TOKEN);
  });
});

describe('root secret changes and recovery', () => {
  it('detects a changed INITIAL_PASSWORD, fails closed, and restores access with the recovery key', async () => {
    const { app } = appWith();
    const { browser: b, recoveryKey } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const before = await state();

    const changed = appWith({ initialPassword: 'a-completely-different-root-secret-value' });
    const ob = browser(changed.app);
    expect((await ob.get('/api/operator/status')).json).toEqual({ phase: 'ready', encryptionLocked: true });
    const login = await ob.post('/api/operator/auth/login');
    expect(login.status).toBe(423);
    expect(login.json.error.code).toBe('encryption_locked');
    expect(login.json.error.message).toMatch(/INITIAL_PASSWORD no longer unwraps/);
    // The existing session (signed with a key from the encrypted store) stops working too.
    const sameCookie = browser(changed.app);
    sameCookie.jar.set('__Secure-mi_op_session', b.jar.get('__Secure-mi_op_session')!);
    expect((await sameCookie.get('/api/operator/overview')).status).toBe(401);
    // Nothing was rewritten.
    expect(await state()).toEqual(before);

    // Wrong recovery key: generic 401, counted toward lockout.
    const bad = await ob.post('/api/operator/recover', { recoveryKey: encodeMasterKey(randomBytes(32)) });
    expect(bad.status).toBe(401);
    // Correct key: MK re-wrapped under the new INITIAL_PASSWORD.
    const ok = await ob.post('/api/operator/recover', { recoveryKey });
    expect(ok.status).toBe(200);
    expect((await ob.get('/api/operator/status')).json.encryptionLocked).toBe(false);
    const s = await signIn(changed.app, workos, OWNER);
    expect(s.location).toBe('/operator');
    const settings = await s.browser.get('/api/operator/settings');
    expect(settings.json.settings.find((x: { key: string }) => x.key === 'github.token')).toMatchObject({ isSet: true, last4: GITHUB_TOKEN.slice(-4) });
    // Recovery is refused when nothing is locked.
    expect((await ob.post('/api/operator/recover', { recoveryKey })).status).toBe(409);
    const audit = await d1.db.prepare("SELECT action FROM operator_audit WHERE action IN ('encryption.recovery_failed', 'encryption.recovered') ORDER BY id").all();
    expect(audit.results.map((r) => r.action)).toEqual(['encryption.recovery_failed', 'encryption.recovered']);
  });

  it('accepts the passphrase for recovery when the master key was derived from one', async () => {
    const { app } = appWith();
    const b = browser(app);
    await b.post('/api/operator/bootstrap/login', { password: INITIAL_PASSWORD });
    const passphrase = 'Correct-Horse-Battery-Staple-42';
    await b.post('/api/operator/setup/encryption', { mode: 'passphrase', passphrase });
    await b.post('/api/operator/setup/encryption/confirm', { saved: true });
    await b.post('/api/operator/setup/workos', { apiKey: WORKOS_API_KEY, clientId: 'client_test_operator' });
    const changed = appWith({ initialPassword: 'another-root-secret-value-for-test' });
    const ob = browser(changed.app);
    expect((await ob.post('/api/operator/recover', { recoveryKey: 'Wrong-Horse-Battery-Staple-42' })).status).toBe(401);
    expect((await ob.post('/api/operator/recover', { recoveryKey: passphrase })).status).toBe(200);
  });

  it('re-wraps for a planned INITIAL_PASSWORD change: prepare, deploy new secret, promoted on first use', async () => {
    const { app } = appWith();
    const { browser: b } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const NEW = 'the-new-initial-password-value-xyz-123';
    expect((await b.post('/api/operator/security/rewrap', { newInitialPassword: 'short' })).status).toBe(400);
    expect((await b.post('/api/operator/security/rewrap', { newInitialPassword: INITIAL_PASSWORD })).status).toBe(400);
    expect((await b.post('/api/operator/security/rewrap', { newInitialPassword: NEW })).status).toBe(200);
    expect((await b.get('/api/operator/security')).json.encryption.pendingRewrap).toBe(true);
    const oldSalt = (await state())!.kek_salt;

    // "Redeploy" with the new secret.
    const next = appWith({ initialPassword: NEW });
    expect((await browser(next.app).get('/api/operator/status')).json.encryptionLocked).toBe(false);
    const st = (await state())!;
    expect(st.mk_pending_wrapped).toBeNull();
    expect(st.kek_salt).not.toBe(oldSalt);
    const s = await signIn(next.app, workos, OWNER);
    expect(s.location).toBe('/operator');
    // The old secret no longer unwraps.
    expect((await browser(appWith().app).get('/api/operator/status')).json.encryptionLocked).toBe(true);
    const audit = await d1.db.prepare("SELECT action FROM operator_audit WHERE action = 'encryption.rewrap_completed'").all();
    expect(audit.results).toHaveLength(1);
  });
});

describe('key rotation', () => {
  it('rotates the DEK, re-encrypting every secret', async () => {
    const { app, deps } = appWith();
    const { browser: b } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const before = (await settingRow('github.token'))!;
    const res = await b.post('/api/operator/security/rotate-dek');
    expect(res.status).toBe(200);
    expect(res.json.reencrypted).toBeGreaterThanOrEqual(3); // workos.apiKey, session key, github.token
    const after = (await settingRow('github.token'))!;
    expect(after.value_enc).not.toBe(before.value_enc);
    expect(after.dek_version).toBe(Number(before.dek_version) + 1);
    await deps.settings.refresh(true);
    expect(await deps.settings.getSecret('github.token')).toBe(GITHUB_TOKEN);
    // Sessions survive (the signing key was re-encrypted, not replaced).
    expect((await b.get('/api/operator/overview')).status).toBe(200);
  });

  it('rotates the master key (wrapped mode), shows the new key once, and retires the old one', async () => {
    const { app } = appWith();
    const { browser: b, recoveryKey: oldKey } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const res = await b.post('/api/operator/security/rotate-master', { mode: 'generate' });
    expect(res.status).toBe(200);
    expect(res.json.pending).toBe(false);
    const newKey = res.json.recoveryKey;
    expect(newKey).not.toBe(oldKey);
    expect((await b.get('/api/operator/security')).text).not.toContain(newKey);

    const changed = appWith({ initialPassword: 'yet-another-root-secret-value-000' });
    const ob = browser(changed.app);
    expect((await ob.post('/api/operator/recover', { recoveryKey: oldKey })).status).toBe(401);
    expect((await ob.post('/api/operator/recover', { recoveryKey: newKey })).status).toBe(200);
    const s = await signIn(changed.app, workos, OWNER);
    expect((await s.browser.get('/api/operator/settings')).json.encryptionLocked).toBe(false);
  });
});

describe('hardened mode (ENCRYPTION_KEY)', () => {
  it('requires a matching ENCRYPTION_KEY, then deletes the wrapped copy so D1 alone cannot decrypt', async () => {
    const { app } = appWith();
    const { browser: b, recoveryKey } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    // Not available without the env secret.
    expect((await b.post('/api/operator/security/hardened', { enabled: true })).json.error.code).toBe('env_key_missing');

    // Wrong env key: detected via the check value.
    const wrong = appWith({ encryptionKey: encodeMasterKey(randomBytes(32)) });
    const w = await signIn(wrong.app, workos, OWNER);
    const wsec = await w.browser.get('/api/operator/security');
    expect(wsec.json.encryption).toMatchObject({ envKeyPresent: true, envKeyMatches: false, mode: 'wrapped', state: 'unlocked' });
    expect((await w.browser.post('/api/operator/security/hardened', { enabled: true })).json.error.code).toBe('env_key_mismatch');

    // Right env key.
    const hard = appWith({ encryptionKey: recoveryKey });
    const h = await signIn(hard.app, workos, OWNER);
    expect((await h.browser.get('/api/operator/security')).json.encryption.envKeyMatches).toBe(true);
    const on = await h.browser.post('/api/operator/security/hardened', { enabled: true });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ mode: 'env', state: 'unlocked' });
    const st = (await state())!;
    expect(st.mk_wrapped).toBeNull();
    expect(st.kek_salt).toBeNull();
    expect(await (await buildOperatorApp(d1.db, { encryptionKey: recoveryKey }).deps.settings).keystore.isUnlocked()).toBe(true);

    // Without ENCRYPTION_KEY (only INITIAL_PASSWORD + the database) nothing decrypts.
    const noKey = appWith();
    expect((await browser(noKey.app).get('/api/operator/status')).json.encryptionLocked).toBe(true);
    expect((await noKey.deps.settings.keystore.status()).problem).toBe('env_key_missing');
    const mismatch = appWith({ encryptionKey: encodeMasterKey(randomBytes(32)) });
    expect((await mismatch.deps.settings.keystore.status()).problem).toBe('env_key_mismatch');

    // Switching back re-wraps under INITIAL_PASSWORD.
    const off = await h.browser.post('/api/operator/security/hardened', { enabled: false });
    expect(off.json.mode).toBe('wrapped');
    expect((await noKey.deps.settings.keystore.status()).state).toBe('unlocked');
  });

  it('rotates the master key in env mode as a pending change completed by the new ENCRYPTION_KEY', async () => {
    const { app } = appWith();
    const { recoveryKey } = await completeSetup(app, workos, OWNER);
    const hard = appWith({ encryptionKey: recoveryKey });
    const h = await signIn(hard.app, workos, OWNER);
    await h.browser.post('/api/operator/security/hardened', { enabled: true });
    await h.browser.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    const rot = await h.browser.post('/api/operator/security/rotate-master', { mode: 'generate' });
    expect(rot.json.pending).toBe(true);
    const newKey = rot.json.recoveryKey;
    // Old env key keeps working until the new one is deployed.
    expect((await hard.deps.settings.keystore.status()).state).toBe('unlocked');
    const next = appWith({ encryptionKey: newKey });
    const status = await next.deps.settings.keystore.status();
    expect(status).toMatchObject({ state: 'unlocked', pendingMasterRotation: false, mode: 'env' });
    await next.deps.settings.refresh(true);
    expect(await next.deps.settings.getSecret('github.token')).toBe(GITHUB_TOKEN);
    expect((await appWith({ encryptionKey: recoveryKey }).deps.settings.keystore.status()).problem).toBe('env_key_mismatch');
  });

  it('recovers from a lost ENCRYPTION_KEY with the recovery key, back to wrapped mode', async () => {
    const { app } = appWith();
    const { recoveryKey } = await completeSetup(app, workos, OWNER);
    const hard = appWith({ encryptionKey: recoveryKey });
    const h = await signIn(hard.app, workos, OWNER);
    await h.browser.post('/api/operator/security/hardened', { enabled: true });
    const lost = appWith();
    expect((await browser(lost.app).post('/api/operator/recover', { recoveryKey })).status).toBe(200);
    expect((await lost.deps.settings.keystore.status())).toMatchObject({ mode: 'wrapped', state: 'unlocked' });
  });
});

describe('no key material leaves the server after the wizard step', () => {
  it('never returns or logs the recovery key, DEK, KEK or secret values', async () => {
    const { app, logged } = appWith();
    const { browser: b, recoveryKey } = await completeSetup(app, workos, OWNER);
    await b.put('/api/operator/settings/github.token', { value: GITHUB_TOKEN });
    await b.put('/api/operator/settings/resend.apiKey', { value: 're_secret_value_abcdef123456' });
    for (const path of ['/status', '/session', '/overview', '/telemetry', '/workspaces', '/agents', '/settings', '/deployments', '/audit', '/security']) {
      expect((await b.get(`/api/operator${path}`)).status, path).toBe(200);
    }
    await b.post('/api/operator/security/rotate-dek');
    const st = (await state())!;
    const forbidden = [
      recoveryKey,
      recoveryKey.slice('mi_mk_'.length),
      GITHUB_TOKEN,
      're_secret_value_abcdef123456',
      WORKOS_API_KEY,
      INITIAL_PASSWORD,
      String(st.dek_wrapped),
      String(st.mk_wrapped),
      String(st.kek_salt),
      String(st.mk_kcv),
    ];
    // Responses after the one that displayed the recovery key.
    const shownAt = b.responses.findIndex((r) => r.text.includes(recoveryKey));
    const later = b.responses.slice(shownAt + 1);
    expect(later.length).toBeGreaterThan(10);
    for (const r of later) {
      const blob = r.text + JSON.stringify([...r.headers.entries()]);
      for (const f of forbidden) expect(blob.includes(f), `${r.url} leaked ${f.slice(0, 8)}…`).toBe(false);
    }
    const logs = JSON.stringify(logged.map((l) => [l.message, String(l.error)]));
    for (const f of forbidden) expect(logs.includes(f)).toBe(false);
    const audit = JSON.stringify((await d1.db.prepare('SELECT * FROM operator_audit').all()).results);
    for (const f of [recoveryKey, GITHUB_TOKEN, WORKOS_API_KEY, INITIAL_PASSWORD]) expect(audit.includes(f)).toBe(false);
  });
});
