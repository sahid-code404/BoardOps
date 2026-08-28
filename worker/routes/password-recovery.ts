import { and, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { hashPassword } from "../auth/crypto";
import { revokeAllTrustedDevices } from "../auth/device-trust";
import { sendOtpEmail } from "../auth/email";
import { generateOtp, hashOtp, verifyOtp } from "../auth/otp";
import { validatePassword } from "../auth/password-policy";
import { checkRateLimit } from "../auth/rate-limit";
import { databaseDateToIso, getClientIp, getUserAgent } from "../auth/session";
import { createDatabase } from "../db/client";
import { User, UserSession } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type RecoveryErrorStatus = 400 | 422 | 429 | 500;

const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 5 * 60 * 1000;

const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

const verifyResetOtpSchema = z.object({
  email: z.string().email("Enter a valid email"),
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Enter a valid email"),
  resetToken: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(1, "New password is required"),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: RecoveryErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function isFutureDatabaseDate(value: unknown): boolean {
  const iso = databaseDateToIso(value);
  return Boolean(iso && Date.parse(iso) > Date.now());
}

function generateResetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function registerPasswordRecoveryRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/forgot-password", async (c) => {
    const ipAddress = getClientIp(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "forgot-password");
    if (!rateLimit.allowed) {
      return failure(c, "Too many requests. Please try again later.", 429);
    }

    const parsed = forgotPasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid password reset request", 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, email)).limit(1);

    if (!user) {
      return c.json<ApiSuccess<{ sent: true }>>({
        success: true,
        data: { sent: true },
        requestId: c.get("requestId"),
      });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MS).toISOString();
    await db
      .update(User)
      .set({
        resetOtpHash: hashOtp(otp),
        resetOtpExpires: expiresAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, user.id));

    try {
      await sendOtpEmail(c, user.email, otp, "password-reset");
    } catch (error) {
      console.error("failed to send password reset code", {
        requestId: c.get("requestId"),
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(c, "Failed to send password reset code. Please try again.", 500);
    }

    await logAudit(c, {
      actorId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entity: "User",
      entityId: user.id,
      ipAddress,
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ sent: true }>>({
      success: true,
      data: { sent: true },
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/verify-reset-otp", async (c) => {
    const ipAddress = getClientIp(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "verify-reset-otp");
    if (!rateLimit.allowed) {
      return failure(c, "Too many attempts. Please try again later.", 429);
    }

    const parsed = verifyResetOtpSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid reset verification request", 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, email)).limit(1);

    if (!user) return failure(c, "Invalid or expired code", 400);
    if (!user.resetOtpHash || !user.resetOtpExpires) {
      return failure(c, "No reset code was sent. Request a new one.", 400);
    }
    if (!isFutureDatabaseDate(user.resetOtpExpires)) {
      return failure(c, "Reset code has expired. Request a new one.", 400);
    }
    if (!verifyOtp(parsed.data.otp, user.resetOtpHash)) {
      return failure(c, "Invalid reset code", 400);
    }

    const resetToken = generateResetToken();
    await db
      .update(User)
      .set({
        resetOtpHash: hashOtp(resetToken),
        resetOtpExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, user.id));

    await logAudit(c, {
      actorId: user.id,
      action: "PASSWORD_RESET_OTP_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress,
      userAgent: getUserAgent(c),
    });

    const response = { verified: true, resetToken };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/reset-password", async (c) => {
    const ipAddress = getClientIp(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "reset-password");
    if (!rateLimit.allowed) {
      return failure(c, "Too many attempts. Please try again later.", 429);
    }

    const parsed = resetPasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid password reset request", 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, email)).limit(1);

    if (!user || !user.resetOtpHash || !isFutureDatabaseDate(user.resetOtpExpires)) {
      return failure(c, "Invalid or expired reset token", 400);
    }
    if (!verifyOtp(parsed.data.resetToken, user.resetOtpHash)) {
      return failure(c, "Invalid reset token", 400);
    }

    const passwordValidation = validatePassword(parsed.data.newPassword);
    if (!passwordValidation.valid) {
      return failure(c, passwordValidation.errors.join("; "), 422);
    }

    const now = new Date().toISOString();
    await db
      .update(User)
      .set({
        passwordHash: hashPassword(parsed.data.newPassword),
        resetOtpHash: null,
        resetOtpExpires: null,
        updatedAt: now,
      })
      .where(eq(User.id, user.id));

    await db
      .update(UserSession)
      .set({ revokedAt: now })
      .where(and(eq(UserSession.userId, user.id), isNull(UserSession.revokedAt)));
    await revokeAllTrustedDevices(c, user.id);

    await logAudit(c, {
      actorId: user.id,
      action: "PASSWORD_RESET_COMPLETED",
      entity: "User",
      entityId: user.id,
      ipAddress,
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ reset: true }>>({
      success: true,
      data: { reset: true },
      requestId: c.get("requestId"),
    });
  });
}
