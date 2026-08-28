import bcrypt from "bcryptjs";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

function randomBytesHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateOtp(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] % 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, BCRYPT_ROUNDS);
}

export function verifyOtp(code: string, stored: string): boolean {
  if (!stored) return false;
  try {
    return bcrypt.compareSync(code, stored);
  } catch {
    return false;
  }
}

export function generatePendingToken(): string {
  return `otp_${randomBytesHex(32)}`;
}

export const OTP_CONFIG = {
  ttlMs: OTP_TTL_MS,
  maxAttempts: MAX_OTP_ATTEMPTS,
} as const;
