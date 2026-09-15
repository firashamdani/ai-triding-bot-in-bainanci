import crypto from 'crypto';

/**
 * Password hashing and token generation.
 *
 * Two defects existed before this module:
 *
 *  1. Passwords were stored as plaintext in the `passwordHash` field and compared
 *     with `!==`. The seeded demo credentials were therefore readable directly out
 *     of the committed source, and the comparison leaked timing information.
 *
 *  2. Session tokens were built as `tok_${userId}_${Date.now()}` and, worse,
 *     `getRequestUser` accepted ANY string matching `tok_<id>_<anything>` by
 *     parsing the user id straight out of it without checking that a session
 *     existed. Sending `Authorization: Bearer tok_usr_admin_x` granted full admin
 *     access — a complete RBAC bypass requiring no credentials at all. The
 *     `x-user-id` header did the same thing.
 *
 * Tokens are now 256 bits of CSPRNG output and are only ever valid if present in
 * the server-side session map. Nothing about a user's identity is encoded in them.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

/** Returns `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification. Returns false for malformed or legacy values. */
export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = crypto.scryptSync(plain, salt, expected.length, SCRYPT_OPTS);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** 256-bit unpredictable session token. Contains no user identity. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
