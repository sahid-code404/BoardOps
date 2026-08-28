import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SESSION_TOKEN_PREFIX = "bos_";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function hashPassword(password: string): string {
  const salt = bytesToHex(randomBytes(16));
  const hash = bytesToHex(scryptSync(password, salt, SCRYPT_KEY_LENGTH));
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex, ...extra] = storedHash.split(":");
  if (!salt || !expectedHex || extra.length > 0) return false;

  const expected = hexToBytes(expectedHex);
  if (!expected || expected.length !== SCRYPT_KEY_LENGTH) return false;

  try {
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return `${SESSION_TOKEN_PREFIX}${bytesToHex(randomBytes(32))}`;
}

export function parseSessionToken(token: string): string | null {
  return token.startsWith(SESSION_TOKEN_PREFIX) && token.length > SESSION_TOKEN_PREFIX.length
    ? token
    : null;
}

export function getTokenExpiry(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
