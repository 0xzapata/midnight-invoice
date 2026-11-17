/**
 * Web Crypto building blocks for the operator console (workerd and Node 22).
 *
 * Key hierarchy (see AGENTS.md "Encryption at rest"):
 *   master key (MK, 256-bit)  --wraps-->  data-encryption key (DEK, AES-256-GCM)
 *   DEK  --encrypts-->  each secret setting (AES-256-GCM, random 96-bit IV, AAD = key + version)
 *   MK is either wrapped in D1 under a KEK = PBKDF2(INITIAL_PASSWORD) ("wrapped" mode)
 *   or supplied as the ENCRYPTION_KEY Worker secret ("env" / hardened mode).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * PBKDF2-SHA-256 iterations for new wraps of the KEK derived from INITIAL_PASSWORD (security fix L4: was
 * 100,000). Measured in local workerd: ~93 ms of CPU vs ~16 ms for 100k. Derived once per isolate and cached
 * (only when an encrypted setting is first needed); the iteration count is stored with the wrap, so wraps made
 * with fewer iterations still unlock and are re-wrapped with this count on unlock.
 */
export const KEK_PBKDF2_ITERATIONS = 600_000;
/** Iterations of wraps made before the count was stored per wrap (and the default of migration 0004). */
export const LEGACY_KEK_PBKDF2_ITERATIONS = 100_000;
/** INITIAL_PASSWORD shorter than this disables the operator console (security fix L4). */
export const MIN_INITIAL_PASSWORD_LENGTH = 24;

export const MASTER_KEY_PREFIX = 'mi_mk_';
/** PBKDF2-SHA-256 iterations when the operator chooses a passphrase as master key (~90 ms, only in the wizard/recovery). */
export const PASSPHRASE_PBKDF2_ITERATIONS = 600_000;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Constant-time comparison of two equal-length byte strings (length mismatch returns false). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof value === 'string' ? enc.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

/** Compares two secrets by hashing both first, so neither length nor content leaks through timing. */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return constantTimeEqual(ha, hb);
}

export async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

export async function hkdf(input: Uint8Array, salt: Uint8Array, info: string, bytes = 32): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', input as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
    k,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export async function pbkdf2(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, k, 256);
  return new Uint8Array(bits);
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('AES-256 keys must be 32 bytes');
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM with a fresh random 96-bit IV. Output: base64url(iv || ciphertext || tag). */
export async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) }, key, plaintext as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64Url(out);
}

/** Throws DecryptionError when the tag does not verify (wrong key, tampered data or wrong AAD). */
export async function aesGcmDecrypt(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(sealed);
  } catch {
    throw new DecryptionError();
  }
  if (bytes.length < 12 + 16) throw new DecryptionError();
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(0, 12) as BufferSource, additionalData: enc.encode(aad) },
        key,
        bytes.slice(12) as BufferSource,
      ),
    );
  } catch {
    throw new DecryptionError();
  }
}

export async function encryptString(key: CryptoKey, value: string, aad: string): Promise<string> {
  return aesGcmEncrypt(key, enc.encode(value), aad);
}

export async function decryptString(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  return dec.decode(await aesGcmDecrypt(key, sealed, aad));
}

export class DecryptionError extends Error {
  constructor() {
    super('Decryption failed (wrong key, tampered ciphertext or mismatched context)');
    this.name = 'DecryptionError';
  }
}

/** Key check value: identifies a master key without revealing it. */
export async function keyCheckValue(masterKey: Uint8Array): Promise<string> {
  return toBase64Url((await hmacSha256(masterKey, 'midnight-invoice/kcv/v1')).slice(0, 16));
}

export function encodeMasterKey(masterKey: Uint8Array): string {
  return MASTER_KEY_PREFIX + toBase64Url(masterKey);
}

/** Parses a `mi_mk_…` recovery key; returns null for anything else. */
export function decodeMasterKey(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(MASTER_KEY_PREFIX)) return null;
  const body = trimmed.slice(MASTER_KEY_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(body)) return null;
  const bytes = fromBase64Url(body);
  return bytes.length === 32 ? bytes : null;
}

/**
 * Passphrase policy for an operator-chosen master key: at least 20 characters
 * and three character classes, or at least 32 characters; no long repeats.
 * Returns a human-readable problem, or null if acceptable.
 */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length > 1024) return 'Passphrase is too long (max 1024 characters).';
  if (passphrase.length < 20) return 'Use at least 20 characters.';
  if (/(.)\1{5,}/.test(passphrase)) return 'Avoid long runs of the same character.';
  if (new Set(passphrase).size < 8) return 'Use more distinct characters.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(passphrase)).length;
  if (passphrase.length < 32 && classes < 3) return 'Mix upper- and lower-case letters, digits and symbols, or use 32+ characters.';
  return null;
}
