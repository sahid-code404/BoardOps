import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual(hashBuf, testBuf);
}

export function generateToken(): string {
  // Opaque session token with identifiable prefix
  return `bos_${randomBytes(32).toString("hex")}`;
}

export function getTokenExpiry(days = 30): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

const SESSION_HEADER = "bos_";

export function parseSessionToken(token: string): { valid: boolean } | null {
  // Token format: bos_<random_hex>. The actual user/session lookup happens in the DB.
  if (!token || !token.startsWith(SESSION_HEADER)) return null;
  return { valid: true };
}
