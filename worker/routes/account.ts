import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { hashPassword, verifyPassword } from "../auth/crypto";
import { validatePassword } from "../auth/password-policy";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getSessionToken,
  getUserAgent,
  type SessionUser,
} from "../auth/session";
import { parseUserAgent } from "../auth/user-agent";
import { createDatabase } from "../db/client";
import { User, UserSession } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type AccountErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().min(8, "Invalid phone number").optional(),
  room: z.string().max(20).optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  emergencyContact: z.string().max(30).optional().nullable(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: AccountErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function activeUser(c: Context<BoardOpsEnv>): Promise<SessionUser | null> {
  const user = await getAuthUser(c);
  return user?.status === "ACTIVE" ? user : null;
}

function serializeUser(user: typeof User.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
    room: user.room,
    gender: user.gender,
    emergencyContact: user.emergencyContact,
    theme: user.theme,
    language: user.language,
    timezone: user.timezone,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: databaseDateToIso(user.createdAt),
    lastLoginAt: databaseDateToIso(user.lastLoginAt),
  };
}

function isUnexpired(value: unknown): boolean {
  const iso = databaseDateToIso(value);
  return Boolean(iso && Date.parse(iso) > Date.now());
}

export function registerAccountRoutes(app: Hono<BoardOpsEnv>): void {
  app.put("/api/auth/profile", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const parsed = updateProfileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid profile update", 400);
    }

    const data = parsed.data;
    const db = createDatabase(c.env.DB);

    if (data.phone) {
      const [existing] = await db
        .select({ id: User.id })
        .from(User)
        .where(eq(User.phone, data.phone))
        .limit(1);
      if (existing && existing.id !== user.id) {
        return failure(c, "This phone number is already in use", 409);
      }
    }

    const updatedAt = new Date().toISOString();
    await db
      .update(User)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.room !== undefined ? { room: data.room } : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.emergencyContact !== undefined
          ? { emergencyContact: data.emergencyContact }
          : {}),
        ...(data.theme !== undefined ? { theme: data.theme } : {}),
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        updatedAt,
      })
      .where(eq(User.id, user.id));

    const [updated] = await db.select().from(User).where(eq(User.id, user.id)).limit(1);
    if (!updated) return failure(c, "User not found", 404);

    await logAudit(c, {
      actorId: user.id,
      action: "PROFILE_UPDATE",
      entity: "User",
      entityId: user.id,
      oldValue: { name: user.name, phone: user.phone, room: user.room },
      newValue: data,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = serializeUser(updated);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/change-password", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid password change request", 400);
    }

    const db = createDatabase(c.env.DB);
    const [fullUser] = await db.select().from(User).where(eq(User.id, user.id)).limit(1);
    if (!fullUser) return failure(c, "User not found", 404);

    if (!verifyPassword(parsed.data.currentPassword, fullUser.passwordHash)) {
      return failure(c, "Current password is incorrect", 403);
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return failure(c, "New password must be different from the current password", 422);
    }

    const validation = validatePassword(parsed.data.newPassword);
    if (!validation.valid) {
      return failure(c, validation.errors.join("; "), 422);
    }

    const currentToken = getSessionToken(c);
    if (!currentToken) return failure(c, "Not authenticated", 401);

    const now = new Date().toISOString();
    await db
      .update(User)
      .set({ passwordHash: hashPassword(parsed.data.newPassword), updatedAt: now })
      .where(eq(User.id, user.id));

    await db
      .update(UserSession)
      .set({ revokedAt: now })
      .where(
        and(
          eq(UserSession.userId, user.id),
          isNull(UserSession.revokedAt),
          ne(UserSession.token, currentToken),
        ),
      );

    await logAudit(c, {
      actorId: user.id,
      action: "PASSWORD_CHANGE",
      entity: "User",
      entityId: user.id,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/auth/sessions", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const currentToken = getSessionToken(c);
    if (!currentToken) return failure(c, "Not authenticated", 401);

    const db = createDatabase(c.env.DB);
    const sessions = await db
      .select()
      .from(UserSession)
      .where(and(eq(UserSession.userId, user.id), isNull(UserSession.revokedAt)))
      .orderBy(desc(UserSession.createdAt));

    const shaped = sessions.filter((session) => isUnexpired(session.expiresAt)).map((session) => {
      const ua = parseUserAgent(session.userAgent);
      return {
        id: session.id,
        current: session.token === currentToken,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        ipAddress: session.ipAddress || "Unknown",
        createdAt: databaseDateToIso(session.createdAt),
        expiresAt: databaseDateToIso(session.expiresAt),
      };
    });

    return c.json<ApiSuccess<typeof shaped>>({
      success: true,
      data: shaped,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/auth/sessions", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const currentToken = getSessionToken(c);
    if (!currentToken) return failure(c, "Not authenticated", 401);

    const db = createDatabase(c.env.DB);
    const candidates = await db
      .select({ id: UserSession.id })
      .from(UserSession)
      .where(
        and(
          eq(UserSession.userId, user.id),
          isNull(UserSession.revokedAt),
          ne(UserSession.token, currentToken),
        ),
      );

    if (candidates.length > 0) {
      await db
        .update(UserSession)
        .set({ revokedAt: new Date().toISOString() })
        .where(
          and(
            eq(UserSession.userId, user.id),
            isNull(UserSession.revokedAt),
            ne(UserSession.token, currentToken),
          ),
        );
    }

    return c.json<ApiSuccess<{ revoked: number }>>({
      success: true,
      data: { revoked: candidates.length },
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/auth/sessions/:id", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const currentToken = getSessionToken(c);
    if (!currentToken) return failure(c, "Not authenticated", 401);

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [session] = await db
      .select()
      .from(UserSession)
      .where(eq(UserSession.id, id))
      .limit(1);

    if (!session) return failure(c, "Session not found", 404);
    if (session.userId !== user.id) {
      return failure(c, "This session does not belong to you", 403);
    }
    if (session.token === currentToken) {
      return failure(c, "Use logout to end your current session", 422);
    }

    await db
      .update(UserSession)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(UserSession.id, id));

    await logAudit(c, {
      actorId: user.id,
      action: "SESSION_REVOKE",
      entity: "UserSession",
      entityId: id,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });
}
