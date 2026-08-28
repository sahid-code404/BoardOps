import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { createDatabase } from "../db/client";
import { TrustedDevice } from "../db/schema";
import type { BoardOpsEnv } from "../types";
import { databaseDateToIso } from "./session";

const DEVICE_TRUST_DAYS = 30;

export const DEVICE_COOKIE_NAME = "boardops_device";
export const DEVICE_COOKIE_MAX_AGE = DEVICE_TRUST_DAYS * 24 * 60 * 60;

function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `dev_${hex}`;
}

function isExpired(value: unknown): boolean {
  const iso = databaseDateToIso(value);
  return !iso || Date.parse(iso) <= Date.now();
}

export async function isDeviceTrusted(
  c: Context<BoardOpsEnv>,
  userId: string,
): Promise<boolean> {
  const token = getCookie(c, DEVICE_COOKIE_NAME);
  if (!token) return false;

  const db = createDatabase(c.env.DB);
  const [device] = await db
    .select({ userId: TrustedDevice.userId, expiresAt: TrustedDevice.expiresAt })
    .from(TrustedDevice)
    .where(eq(TrustedDevice.token, token))
    .limit(1);

  return Boolean(device && device.userId === userId && !isExpired(device.expiresAt));
}

export async function trustDevice(
  c: Context<BoardOpsEnv>,
  userId: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<string> {
  const token = generateDeviceToken();
  const expiresAt = new Date(
    Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const db = createDatabase(c.env.DB);
  await db.insert(TrustedDevice).values({
    id: crypto.randomUUID(),
    userId,
    token,
    userAgent,
    ipAddress,
    expiresAt,
  });

  setCookie(c, DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: DEVICE_COOKIE_MAX_AGE,
    path: "/",
  });

  return token;
}

export async function revokeAllTrustedDevices(
  c: Context<BoardOpsEnv>,
  userId: string,
): Promise<void> {
  const db = createDatabase(c.env.DB);
  await db.delete(TrustedDevice).where(eq(TrustedDevice.userId, userId));
}

export async function revokeTrustedDevice(
  c: Context<BoardOpsEnv>,
  userId: string,
  deviceId: string,
): Promise<void> {
  const db = createDatabase(c.env.DB);
  await db
    .delete(TrustedDevice)
    .where(and(eq(TrustedDevice.id, deviceId), eq(TrustedDevice.userId, userId)));
}
