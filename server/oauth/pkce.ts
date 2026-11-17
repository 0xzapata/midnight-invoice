/** PKCE (RFC 7636) with S256 only, using Web Crypto. */

/** code_verifier and code_challenge share the unreserved-character syntax, 43–128 chars. */
export const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Length-independent comparison of two ASCII strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!PKCE_VALUE.test(verifier)) return false;
  return timingSafeEqual(await s256(verifier), challenge);
}
