/**
 * Secret generation and hashing with Web Crypto only (works in workerd and Node 22).
 */

import { USER_CODE_ALPHABET, USER_CODE_LENGTH } from '../shared/user-code';

export { USER_CODE_ALPHABET, USER_CODE_LENGTH, normalizeUserCode, formatUserCode } from '../shared/user-code';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `prefix` + 32 random bytes (256 bits) encoded as base64url (43 chars). */
export function generateSecret(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + base64url(bytes);
}

/** Uniformly random user code like "WXYZ-BCDF" (rejection sampling, no modulo bias). */
export function generateUserCode(): string {
  const out: string[] = [];
  const n = USER_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  const buf = new Uint8Array(32);
  while (out.length < USER_CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < USER_CODE_LENGTH) out.push(USER_CODE_ALPHABET[b % n]);
    }
  }
  return `${out.slice(0, 4).join('')}-${out.slice(4).join('')}`;
}

/** Hex SHA-256. Secrets are high-entropy, so an unsalted fast hash is appropriate for lookup. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
