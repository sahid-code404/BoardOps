import { db } from "@/lib/db";
import { randomBytes } from "crypto";

/**
 * Trusted device management.
 *
 * When a user completes 2FA OTP verification, their device is "trusted" —
 * a long-lived token is stored in an HTTP-only cookie. On future logins
 * from the same device, the OTP step is skipped.
 *
 * OTP is still required when:
 *  - The cookie is missing (new device/browser, incognito mode)
 *  - The cookie has expired (default 30 days)
 *  - The trusted device was revoked by the user
 */

const DEVICE_TRUST_DAYS = 30;

/** Generate a unique device trust token. */
export function generateDeviceToken(): string {
  return `dev_${randomBytes(32).toString("hex")}`;
}

/** Get the cookie name for the device trust token. */
export const DEVICE_COOKIE_NAME = "boardops_device";

/** Get the cookie max-age in seconds. */
export const DEVICE_COOKIE_MAX_AGE = DEVICE_TRUST_DAYS * 24 * 60 * 60;

/**
 * Create a trusted device record for a user.
 * Returns the token to be set as a cookie.
 */
export async function trustDevice(userId: string, userAgent: string | null, ipAddress: string | null): Promise<string> {
  const token = generateDeviceToken();
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000);

  await db.trustedDevice.create({
    data: { userId, token, userAgent, ipAddress, expiresAt },
  });

  return token;
}

/**
 * Check if a device trust token is valid for a given user.
 * Returns true if the token exists, belongs to the user, and hasn't expired.
 */
export async function isDeviceTrusted(userId: string, token: string | null): Promise<boolean> {
  if (!token) return false;

  const device = await db.trustedDevice.findUnique({
    where: { token },
    select: { userId: true, expiresAt: true },
  });

  if (!device) return false;
  if (device.userId !== userId) return false;
  if (device.expiresAt < new Date()) return false;

  return true;
}

/**
 * Revoke all trusted devices for a user (e.g. on password reset, logout-all).
 */
export async function revokeAllTrustedDevices(userId: string): Promise<void> {
  await db.trustedDevice.deleteMany({ where: { userId } });
}

/**
 * Get all trusted devices for a user (for the profile management UI).
 */
export async function getTrustedDevices(userId: string) {
  return db.trustedDevice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
  });
}

/**
 * Revoke a single trusted device by ID.
 */
export async function revokeTrustedDevice(userId: string, deviceId: string): Promise<void> {
  await db.trustedDevice.deleteMany({ where: { id: deviceId, userId } });
}
