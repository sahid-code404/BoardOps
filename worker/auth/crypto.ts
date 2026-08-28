import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SESSION_TOKEN_PREFIX = "bos_";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex, ...extra] = storedHash.split(":");
  if (!salt || !expectedHex || extra.length > 0) return false;

  try {
    const expected = Buffer.from(expectedHex, "hex");
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function parseSessionToken(token: string): string | null {
  return token.startsWith(SESSION_TOKEN_PREFIX) && token.length > SESSION_TOKEN_PREFIX.length
    ? token
    : null;
}

export function getTokenExpiry(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
