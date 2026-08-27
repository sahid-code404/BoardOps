import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

/**
 * Email OTP helpers.
 *
 * Generates 6-digit numeric OTPs, hashes them with bcrypt (slow hash designed
 * for passwords / OTPs — resistant to brute-force) for secure storage, and
 * verifies via `bcrypt.compareSync`. OTPs expire after 5 minutes. Max 5
 * failed verification attempts before the OTP is invalidated.
 *
 * NOTE: bcrypt hashes are ~60 chars and self-describe their salt+rounds, so
 * the stored value does not need a separate salt column.
 */

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10; // ~100ms — slow enough to deter brute force

/** Generate a cryptographically-random 6-digit OTP code. */
export function generateOtp(): string {
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, "0");
}

/** Hash an OTP code for secure storage (bcrypt with 10 rounds). */
export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, BCRYPT_ROUNDS);
}

/** Verify an OTP code against a stored bcrypt hash. */
export function verifyOtp(code: string, stored: string): boolean {
  if (!stored) return false;
  try {
    return bcrypt.compareSync(code, stored);
  } catch {
    return false;
  }
}

/** Generate a short-lived pending token for the OTP verification step. */
export function generatePendingToken(): string {
  return `otp_${randomBytes(32).toString("hex")}`;
}

export const OTP_CONFIG = {
  ttlMs: OTP_TTL_MS,
  maxAttempts: MAX_OTP_ATTEMPTS,
};
