import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { verifyPassword } from "../auth/crypto";
import { revokeAllTrustedDevices } from "../auth/device-trust";
import { getAuthUser, getClientIp, getUserAgent } from "../auth/session";
import {
  generateBackupCodes,
  generateOtpAuthUri,
  generateQrCodeDataUrl,
  generateTwoFactorSecret,
  verifyTotp,
} from "../auth/two-factor";
import { createDatabase } from "../db/client";
import { User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type TwoFactorErrorStatus = 400 | 401 | 403 | 404 | 422;

const verifySetupSchema = z.object({
  secret: z.string().min(16, "Invalid secret"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const disableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

const backupCodesSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const toggleSchema = z.object({
  enable: z.boolean(),
  password: z.string().min(1, "Password is required to change 2FA settings"),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: TwoFactorErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function activeUserId(c: Context<BoardOpsEnv>): Promise<string | null> {
  const user = await getAuthUser(c);
  return user?.status === "ACTIVE" ? user.id : null;
}

async function loadUser(c: Context<BoardOpsEnv>, userId: string) {
  const db = createDatabase(c.env.DB);
  const [user] = await db.select().from(User).where(eq(User.id, userId)).limit(1);
  return user ?? null;
}

export function registerTwoFactorRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/2fa/setup", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const fullUser = await loadUser(c, user.id);
    if (!fullUser) return failure(c, "User not found", 404);
    if (fullUser.twoFactorEnabled) {
      return failure(c, "Two-factor authentication is already enabled", 422);
    }

    const secret = generateTwoFactorSecret();
    const otpauth = generateOtpAuthUri(user.email, secret);
    const qrCode = await generateQrCodeDataUrl(otpauth);
    const response = { secret, qrCode, otpauth };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/2fa/verify", async (c) => {
    const userId = await activeUserId(c);
    if (!userId) return failure(c, "Not authenticated", 401);

    const parsed = verifySetupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid verification request", 400);
    }

    const fullUser = await loadUser(c, userId);
    if (!fullUser) return failure(c, "User not found", 404);
    if (fullUser.twoFactorEnabled) {
      return failure(c, "Two-factor authentication is already enabled", 422);
    }
    if (!verifyTotp(parsed.data.code, parsed.data.secret)) {
      return failure(c, "Invalid verification code. Try again.", 403);
    }

    const { plain, hashes } = generateBackupCodes();
    const db = createDatabase(c.env.DB);
    await db
      .update(User)
      .set({
        twoFactorEnabled: true,
        twoFactorMethod: "TOTP",
        twoFactorSecret: parsed.data.secret,
        twoFactorBackupCodes: JSON.stringify(hashes),
        emailOtpCode: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
        otpPendingToken: null,
        otpPendingExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, userId));

    await revokeAllTrustedDevices(c, userId);
    await logAudit(c, {
      actorId: userId,
      action: "2FA_ENABLE",
      entity: "User",
      entityId: userId,
      newValue: { method: "TOTP" },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = { backupCodes: plain, method: "TOTP" as const };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/2fa/disable", async (c) => {
    const userId = await activeUserId(c);
    if (!userId) return failure(c, "Not authenticated", 401);

    const parsed = disableSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid disable request", 400);
    }

    const fullUser = await loadUser(c, userId);
    if (!fullUser) return failure(c, "User not found", 404);
    if (!fullUser.twoFactorEnabled) {
      return failure(c, "Two-factor authentication is not enabled", 422);
    }
    if (!verifyPassword(parsed.data.password, fullUser.passwordHash)) {
      return failure(c, "Password is incorrect", 403);
    }

    const db = createDatabase(c.env.DB);
    await db
      .update(User)
      .set({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        emailOtpCode: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
        otpPendingToken: null,
        otpPendingExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, userId));

    await revokeAllTrustedDevices(c, userId);
    await logAudit(c, {
      actorId: userId,
      action: "2FA_DISABLE",
      entity: "User",
      entityId: userId,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/2fa/backup-codes", async (c) => {
    const userId = await activeUserId(c);
    if (!userId) return failure(c, "Not authenticated", 401);

    const parsed = backupCodesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid verification request", 400);
    }

    const fullUser = await loadUser(c, userId);
    if (!fullUser) return failure(c, "User not found", 404);
    if (!fullUser.twoFactorEnabled || !fullUser.twoFactorSecret) {
      return failure(c, "Two-factor authentication is not enabled", 422);
    }
    if (!verifyTotp(parsed.data.code, fullUser.twoFactorSecret)) {
      return failure(c, "Invalid verification code", 403);
    }

    const { plain, hashes } = generateBackupCodes();
    const db = createDatabase(c.env.DB);
    await db
      .update(User)
      .set({
        twoFactorBackupCodes: JSON.stringify(hashes),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, userId));

    await logAudit(c, {
      actorId: userId,
      action: "2FA_BACKUP_CODES_REGEN",
      entity: "User",
      entityId: userId,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ backupCodes: string[] }>>({
      success: true,
      data: { backupCodes: plain },
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/2fa/toggle", async (c) => {
    const userId = await activeUserId(c);
    if (!userId) return failure(c, "Not authenticated", 401);

    const parsed = toggleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid 2FA request", 400);
    }

    const fullUser = await loadUser(c, userId);
    if (!fullUser) return failure(c, "User not found", 404);
    if (!verifyPassword(parsed.data.password, fullUser.passwordHash)) {
      return failure(c, "Incorrect password", 401);
    }

    const db = createDatabase(c.env.DB);
    const updatedAt = new Date().toISOString();

    if (parsed.data.enable) {
      await db
        .update(User)
        .set({
          twoFactorEnabled: true,
          twoFactorMethod: "EMAIL",
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
          emailOtpCode: null,
          emailOtpExpiresAt: null,
          emailOtpAttempts: 0,
          otpPendingToken: null,
          otpPendingExpiresAt: null,
          updatedAt,
        })
        .where(eq(User.id, userId));

      await revokeAllTrustedDevices(c, userId);
      await logAudit(c, {
        actorId: userId,
        action: "2FA_ENABLE",
        entity: "User",
        entityId: userId,
        newValue: { method: "EMAIL" },
        ipAddress: getClientIp(c),
        userAgent: getUserAgent(c),
      });

      const response = {
        enabled: true,
        method: "EMAIL" as const,
        message:
          "Two-factor authentication enabled. A verification code will be sent to your email on each login.",
      };
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    await db
      .update(User)
      .set({
        twoFactorEnabled: false,
        twoFactorMethod: "EMAIL",
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        emailOtpCode: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
        otpPendingToken: null,
        otpPendingExpiresAt: null,
        updatedAt,
      })
      .where(eq(User.id, userId));

    await revokeAllTrustedDevices(c, userId);
    await logAudit(c, {
      actorId: userId,
      action: "2FA_DISABLE",
      entity: "User",
      entityId: userId,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = { enabled: false, message: "Two-factor authentication disabled." };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
