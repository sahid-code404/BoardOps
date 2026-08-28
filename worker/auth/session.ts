import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { createDatabase } from "../db/client";
import { User, UserSession } from "../db/schema";
import type { BoardOpsEnv } from "../types";

export const AUTH_COOKIE_NAME = "boardops_session";
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  room: string | null;
  gender: string | null;
  emergencyContact: string | null;
  theme: string;
  language: string;
  timezone: string;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

function parseDatabaseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const date = new Date(sqliteUtc);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeDatabaseDate(value: unknown): string | null {
  const date = parseDatabaseDate(value);
  return date ? date.toISOString() : null;
}

export function getClientIp(c: Context<BoardOpsEnv>): string {
  const cloudflareIp = c.req.header("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedIp = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (forwardedIp) return forwardedIp;

  return c.req.header("x-real-ip")?.trim() || "127.0.0.1";
}

export function getUserAgent(c: Context<BoardOpsEnv>): string | null {
  return c.req.header("user-agent") ?? null;
}

export function getSessionToken(c: Context<BoardOpsEnv>): string | null {
  const cookieToken = getCookie(c, AUTH_COOKIE_NAME) ?? null;
  if (cookieToken) return cookieToken;

  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function isSessionToken(token: string): boolean {
  return token.startsWith("bos_") && token.length > 4;
}

export async function getAuthUser(c: Context<BoardOpsEnv>): Promise<SessionUser | null> {
  const token = getSessionToken(c);
  if (!token || !isSessionToken(token)) return null;

  const db = createDatabase(c.env.DB);
  const [record] = await db
    .select({
      sessionExpiresAt: UserSession.expiresAt,
      sessionRevokedAt: UserSession.revokedAt,
      id: User.id,
      name: User.name,
      email: User.email,
      phone: User.phone,
      role: User.role,
      status: User.status,
      avatarUrl: User.avatarUrl,
      room: User.room,
      gender: User.gender,
      emergencyContact: User.emergencyContact,
      theme: User.theme,
      language: User.language,
      timezone: User.timezone,
      twoFactorEnabled: User.twoFactorEnabled,
      createdAt: User.createdAt,
      lastLoginAt: User.lastLoginAt,
    })
    .from(UserSession)
    .innerJoin(User, eq(UserSession.userId, User.id))
    .where(eq(UserSession.token, token))
    .limit(1);

  if (!record || record.sessionRevokedAt !== null) return null;

  const expiresAt = parseDatabaseDate(record.sessionExpiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return null;

  const createdAt = serializeDatabaseDate(record.createdAt);
  if (!createdAt) return null;

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    role: record.role,
    status: record.status,
    avatarUrl: record.avatarUrl,
    room: record.room,
    gender: record.gender,
    emergencyContact: record.emergencyContact,
    theme: record.theme,
    language: record.language,
    timezone: record.timezone,
    twoFactorEnabled: record.twoFactorEnabled,
    createdAt,
    lastLoginAt: serializeDatabaseDate(record.lastLoginAt),
  };
}

export async function requireAuth(c: Context<BoardOpsEnv>): Promise<SessionUser> {
  const user = await getAuthUser(c);
  if (!user) throw new Error("UNAUTHORIZED");
  if (user.status !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
  return user;
}

export async function requireRole(
  c: Context<BoardOpsEnv>,
  ...roles: string[]
): Promise<SessionUser> {
  const user = await requireAuth(c);
  if (!roles.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export function setAuthCookie(c: Context<BoardOpsEnv>, token: string): void {
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
}

export function clearAuthCookie(c: Context<BoardOpsEnv>): void {
  deleteCookie(c, AUTH_COOKIE_NAME, {
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
  });
}

export async function revokeCurrentSession(c: Context<BoardOpsEnv>): Promise<string | null> {
  const token = getSessionToken(c);
  if (!token || !isSessionToken(token)) return null;

  const db = createDatabase(c.env.DB);
  await db
    .update(UserSession)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(UserSession.token, token), isNull(UserSession.revokedAt)));
  return token;
}

export function databaseDateToIso(value: unknown): string | null {
  return serializeDatabaseDate(value);
}
