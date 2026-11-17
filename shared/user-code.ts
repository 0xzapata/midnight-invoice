/**
 * Agent registration user codes ("WDJB-MJHT"), shared by the API (lookups)
 * and the app (the approve page normalises what the user types or pastes).
 */

/** RFC 8628 §6.1 suggests consonants only: no vowels (no accidental words), no 0/O/1/I confusion. */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const USER_CODE_LENGTH = 8;

/**
 * Canonical form used for storage and lookups: upper-case, separators
 * (dashes/spaces) removed. Returns null if it cannot be a valid code, so
 * malformed input never reaches the database.
 */
export function normalizeUserCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== USER_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}
