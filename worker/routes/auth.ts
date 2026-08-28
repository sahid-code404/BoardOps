import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { generateToken, getTokenExpiry, verifyPassword } from "../auth/crypto";
import { isDeviceTrusted, trustDevice } from "../auth/device-trust";
import { sendOtpEmail } from "../auth/email";
import {
  generateOtp,
  generatePendingToken,
  hashOtp,
  OTP_CONFIG,
  verifyOtp,
} from "../auth/otp";
import { checkRateLimit } from "../auth/rate-limit";
import {
  clearAuthCookie,
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getSessionToken,
  getUserAgent,
  revokeCurrentSession,
  setAuthCookie,
} from "../auth/session";
import { verifyTotp } from "../auth/two-factor";
import { createDatabase } from "../db/client";
import { LoginHistory, User, UserSession } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type ErrorStatus = 400 | 401 | 403 | 422 | 429 | 500;
type UserRecord = typeof User.$inferSelect;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const verifyOtpSchema = z.object({
  pendingToken: z.string().min(10, "Invalid pending token"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const resendOtpSchema = z.object({
  pendingToken: z.string().min(10, "Invalid pending token"),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: ErrorStatus) {
  return c.json<ApiFailure>(
    {
      success: false,
      error,
      requestId: c.get("requestId"),
    },
    status,
  );
}

function dateToIso(value: unknown): string | null {
  return databaseDateToIso(value);
}

function isFutureDatabaseDate(value: unknown): boolean {
  const iso = dateToIso(value);
  return Boolean(iso && Date.parse(iso) > Date.now());
}

function publicUser(user: UserRecord, lastLoginAt?: string | null) {
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
    createdAt: dateToIso(user.createdAt),
    lastLoginAt: lastLoginAt === undefined ? dateToIso(user.lastLoginAt) : lastLoginAt,
  };
}

async function clearPendingChallenge(c: Context<BoardOpsEnv>, userId: string): Promise<void> {
  const db = createDatabase(c.env.DB);
  await db
    .update(User)
    .set({
      emailOtpCode: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      otpPendingToken: null,
      otpPendingExpiresAt: null,
    })
    .where(eq(User.id, userId));
}

async function recordFailedPassword(
  c: Context<BoardOpsEnv>,
  userId: string,
  ipAddress: string,
  userAgent: string | null,
): Promise<void> {
  const db = createDatabase(c.env.DB);
  await db.insert(LoginHistory).values({
    id: crypto.randomUUID(),
    userId,
    success: false,
    ipAddress,
    userAgent,
    reason: "WRONG_PASSWORD",
  });
}

async function issueSession(c: Context<BoardOpsEnv>, user: UserRecord) {
  const db = createDatabase(c.env.DB);
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);
  const token = generateToken();
  const expiresAt = getTokenExpiry(30);
  const lastLoginAt = new Date().toISOString();

  await db.insert(UserSession).values({
    id: crypto.randomUUID(),
    userId: user.id,
    token,
    expiresAt,
    ipAddress,
    userAgent,
  });

  await db.update(User).set({ lastLoginAt }).where(eq(User.id, user.id));
  await db.insert(LoginHistory).values({
    id: crypto.randomUUID(),
    userId: user.id,
    success: true,
    ipAddress,
    userAgent,
  });
  await logAudit(c, {
    actorId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  setAuthCookie(c, token);

  return {
    token,
    user: publicUser(user, lastLoginAt),
    expiresAt,
  };
}

export function registerAuthRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/login", async (c) => {
    const ipAddress = getClientIp(c);
    const userAgent = getUserAgent(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "login");
    if (!rateLimit.allowed) {
      return failure(c, "Too many login attempts. Please try again later.", 429);
    }

    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid login request", 400);
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, normalizedEmail)).limit(1);

    if (!user) {
      return failure(c, "Incorrect email or password", 401);
    }

    if (!verifyPassword(parsed.data.password, user.passwordHash)) {
      await recordFailedPassword(c, user.id, ipAddress, userAgent);
      return failure(c, "Incorrect email or password", 401);
    }

    if (user.status === "PENDING") {
      return failure(c, "Your account is awaiting admin approval", 403);
    }
    if (user.status === "SUSPENDED") {
      return failure(c, "Your account has been suspended. Contact admin.", 403);
    }
    if (user.status === "ARCHIVED" || user.status === "INACTIVE") {
      return failure(c, "Your account is no longer active", 403);
    }
    if (user.status !== "ACTIVE") {
      return failure(c, "Account access denied", 403);
    }
    if (!user.emailVerified) {
      return failure(
        c,
        "Please verify your email address first. Use the verification link sent to your inbox, or check your registration status page.",
        403,
      );
    }

    if (user.twoFactorEnabled && !(await isDeviceTrusted(c, user.id))) {
      const pendingToken = generatePendingToken();
      const expiresAt = new Date(Date.now() + OTP_CONFIG.ttlMs).toISOString();
      const method = user.twoFactorMethod === "TOTP" && user.twoFactorSecret ? "TOTP" : "EMAIL";

      if (method === "TOTP") {
        await db
          .update(User)
          .set({
            emailOtpCode: null,
            emailOtpExpiresAt: null,
            emailOtpAttempts: 0,
            otpPendingToken: pendingToken,
            otpPendingExpiresAt: expiresAt,
          })
          .where(eq(User.id, user.id));
      } else {
        const otp = generateOtp();
        await db
          .update(User)
          .set({
            twoFactorMethod: "EMAIL",
            emailOtpCode: hashOtp(otp),
            emailOtpExpiresAt: expiresAt,
            emailOtpAttempts: 0,
            otpPendingToken: pendingToken,
            otpPendingExpiresAt: expiresAt,
          })
          .where(eq(User.id, user.id));

        try {
          await sendOtpEmail(c, user.email, otp, "two-factor");
        } catch (error) {
          console.error("failed to send login OTP", {
            requestId: c.get("requestId"),
            error: error instanceof Error ? error.message : String(error),
          });
          await clearPendingChallenge(c, user.id);
          return failure(c, "Failed to send verification code. Please try again.", 500);
        }
      }

      await logAudit(c, {
        actorId: user.id,
        action: "LOGIN_2FA_CHALLENGE",
        entity: "User",
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { method },
      });

      return c.json<
        ApiSuccess<{
          requiresTwoFactor: true;
          pendingToken: string;
          method: "TOTP" | "EMAIL";
          expiresAt: string;
        }>
      >({
        success: true,
        data: {
          requiresTwoFactor: true,
          pendingToken,
          method,
          expiresAt,
        },
        requestId: c.get("requestId"),
      });
    }

    const session = await issueSession(c, user);
    return c.json<ApiSuccess<typeof session>>({
      success: true,
      data: session,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/verify-otp", async (c) => {
    const parsed = verifyOtpSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid verification request", 400);
    }

    const ipAddress = getClientIp(c);
    const userAgent = getUserAgent(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "verify-otp");
    if (!rateLimit.allowed) {
      return failure(c, "Too many attempts. Please try again later.", 429);
    }

    const db = createDatabase(c.env.DB);
    const [user] = await db
      .select()
      .from(User)
      .where(eq(User.otpPendingToken, parsed.data.pendingToken))
      .limit(1);

    if (!user || !isFutureDatabaseDate(user.otpPendingExpiresAt)) {
      return failure(c, "Session expired or invalid. Please log in again.", 401);
    }

    if (user.status !== "ACTIVE" || !user.emailVerified || !user.twoFactorEnabled) {
      await clearPendingChallenge(c, user.id);
      return failure(c, "Account access denied. Please log in again.", 403);
    }

    const method = user.twoFactorMethod === "TOTP" && user.twoFactorSecret ? "TOTP" : "EMAIL";
    let verified = false;

    if (method === "TOTP") {
      verified = verifyTotp(parsed.data.code, user.twoFactorSecret!);
    } else {
      if (!isFutureDatabaseDate(user.emailOtpExpiresAt)) {
        return failure(c, "Verification code has expired. Please request a new one.", 401);
      }
      if (user.emailOtpAttempts >= OTP_CONFIG.maxAttempts) {
        return failure(c, "Too many failed attempts. Please log in again.", 429);
      }

      verified = Boolean(user.emailOtpCode && verifyOtp(parsed.data.code, user.emailOtpCode));
      if (!verified) {
        const attempts = user.emailOtpAttempts + 1;
        await db.update(User).set({ emailOtpAttempts: attempts }).where(eq(User.id, user.id));
        const remaining = Math.max(0, OTP_CONFIG.maxAttempts - attempts);
        await logAudit(c, {
          actorId: user.id,
          action: "OTP_FAILED",
          entity: "User",
          entityId: user.id,
          ipAddress,
          userAgent,
          newValue: { method },
        });
        return failure(
          c,
          `Invalid verification code. ${remaining} attempt(s) remaining.`,
          401,
        );
      }
    }

    if (!verified) {
      await logAudit(c, {
        actorId: user.id,
        action: "OTP_FAILED",
        entity: "User",
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { method },
      });
      return failure(c, "Invalid verification code.", 401);
    }

    await trustDevice(c, user.id, userAgent, ipAddress);
    await clearPendingChallenge(c, user.id);
    await logAudit(c, {
      actorId: user.id,
      action: "OTP_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress,
      userAgent,
      newValue: { method },
    });

    const session = await issueSession(c, user);
    const response = {
      ...session,
      user: {
        ...session.user,
        twoFactorMethod: user.twoFactorMethod,
      },
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/resend-otp", async (c) => {
    const parsed = resendOtpSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid resend request", 400);
    }

    const db = createDatabase(c.env.DB);
    const [user] = await db
      .select()
      .from(User)
      .where(eq(User.otpPendingToken, parsed.data.pendingToken))
      .limit(1);

    if (!user || !isFutureDatabaseDate(user.otpPendingExpiresAt)) {
      return failure(c, "Session expired or invalid. Please log in again.", 401);
    }
    if (user.twoFactorMethod === "TOTP" && user.twoFactorSecret) {
      return failure(c, "Use your authenticator app to generate a verification code.", 422);
    }

    const now = Date.now();
    const previousExpiry = dateToIso(user.emailOtpExpiresAt);
    if (previousExpiry) {
      const previousSentAt = Date.parse(previousExpiry) - OTP_CONFIG.ttlMs;
      const elapsed = now - previousSentAt;
      if (elapsed < 30_000) {
        const wait = Math.ceil((30_000 - elapsed) / 1000);
        return failure(c, `Please wait ${wait} second(s) before requesting a new code.`, 429);
      }
    }

    const otp = generateOtp();
    const expiresAt = new Date(now + OTP_CONFIG.ttlMs).toISOString();
    await db
      .update(User)
      .set({
        emailOtpCode: hashOtp(otp),
        emailOtpExpiresAt: expiresAt,
        emailOtpAttempts: 0,
      })
      .where(eq(User.id, user.id));

    try {
      await sendOtpEmail(c, user.email, otp, "login");
    } catch (error) {
      console.error("failed to resend login OTP", {
        requestId: c.get("requestId"),
        error: error instanceof Error ? error.message : String(error),
      });
      await clearPendingChallenge(c, user.id);
      return failure(c, "Failed to send verification code. Please try again.", 500);
    }

    await logAudit(c, {
      actorId: user.id,
      action: "OTP_RESENT",
      entity: "User",
      entityId: user.id,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ resent: true; expiresAt: string }>>({
      success: true,
      data: { resent: true, expiresAt },
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/auth/me", async (c) => {
    const user = await getAuthUser(c);
    if (!user) {
      return c.json<ApiFailure>(
        { success: false, error: "Not authenticated", requestId: c.get("requestId") },
        401,
      );
    }

    return c.json<ApiSuccess<typeof user>>({
      success: true,
      data: user,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/logout", async (c) => {
    const user = await getAuthUser(c);
    const token = getSessionToken(c);

    if (user && token) {
      await revokeCurrentSession(c);
      await logAudit(c, {
        actorId: user.id,
        action: "LOGOUT",
        entity: "User",
        entityId: user.id,
        ipAddress: getClientIp(c),
        userAgent: getUserAgent(c),
      });
    }

    clearAuthCookie(c);
    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });
}
