import { desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { hashPassword } from "../auth/crypto";
import { sendOtpEmail } from "../auth/email";
import { generateOtp, hashOtp, verifyOtp } from "../auth/otp";
import { validatePassword } from "../auth/password-policy";
import { checkRateLimit } from "../auth/rate-limit";
import { databaseDateToIso, getClientIp, getUserAgent } from "../auth/session";
import { createDatabase } from "../db/client";
import { RegistrationRequest, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type RegistrationErrorStatus = 400 | 409 | 422 | 429 | 500;

const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;

const registrationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  institutionName: z.string().min(2, "Institution name is required"),
  institutionUserId: z.string().min(1, "Institution User ID is required"),
  phone: z.string().min(8, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  room: z.string().min(1, "Room number is required"),
  gender: z.union([z.literal(""), z.enum(["MALE", "FEMALE", "OTHER"])]).optional(),
  consents: z.object({
    rules: z.boolean().refine((value) => value, "You must accept the Institution Rules"),
    privacy: z.boolean().refine((value) => value, "You must accept the Privacy Policy"),
    terms: z.boolean().refine((value) => value, "You must accept the Terms & Conditions"),
  }),
});

const emailSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

const verifyEmailSchema = z.object({
  email: z.string().email("Enter a valid email"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: RegistrationErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function isFutureDatabaseDate(value: unknown): boolean {
  const iso = databaseDateToIso(value);
  return Boolean(iso && Date.parse(iso) > Date.now());
}

function parseJsonValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function registerRegistrationRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/register", async (c) => {
    const parsed = registrationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid registration request", 400);
    }

    const data = parsed.data;
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.valid) {
      return failure(c, passwordValidation.errors.join("; "), 422);
    }
    if (data.password !== data.confirmPassword) {
      return failure(c, "Passwords do not match", 400);
    }

    const email = data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [[emailTaken], [phoneTaken], [institutionIdTaken]] = await Promise.all([
      db.select({ id: User.id }).from(User).where(eq(User.email, email)).limit(1),
      db.select({ id: User.id }).from(User).where(eq(User.phone, data.phone)).limit(1),
      db
        .select({ id: User.id })
        .from(User)
        .where(eq(User.institutionUserId, data.institutionUserId))
        .limit(1),
    ]);

    if (emailTaken) return failure(c, "This email is already registered", 409);
    if (phoneTaken) return failure(c, "This phone number is already registered", 409);
    if (institutionIdTaken) return failure(c, "This Institution User ID is already taken", 409);

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const otp = generateOtp();
    const emailVerifyExpires = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
    const gender = data.gender && data.gender.length > 0 ? data.gender : null;

    await db.insert(User).values({
      id: userId,
      name: data.name,
      email,
      phone: data.phone,
      passwordHash: hashPassword(data.password),
      role: "USER",
      status: "PENDING",
      room: data.room,
      gender,
      institutionName: data.institutionName,
      institutionUserId: data.institutionUserId,
      emailVerified: false,
      emailVerifyToken: hashOtp(otp),
      emailVerifyExpires,
      updatedAt: now,
    });

    await db.insert(RegistrationRequest).values({
      id: crypto.randomUUID(),
      userId,
      cycle: 1,
      status: "PENDING_REVIEW",
      fields: JSON.stringify({
        name: data.name,
        email,
        phone: data.phone,
        room: data.room,
        gender,
        institutionName: data.institutionName,
        institutionUserId: data.institutionUserId,
      }),
    });

    try {
      await sendOtpEmail(c, email, otp, "email-verification");
    } catch (error) {
      console.error("failed to send registration verification code", {
        requestId: c.get("requestId"),
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(c, "Registration was saved, but the verification email could not be sent. Request a new verification code.", 500);
    }

    await logAudit(c, {
      actorId: userId,
      action: "USER_REGISTER",
      entity: "User",
      entityId: userId,
      newValue: {
        email,
        institutionUserId: data.institutionUserId,
        room: data.room,
      },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = { userId, email };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/auth/registration-status", async (c) => {
    const email = c.req.query("email");
    if (!email) {
      return c.json<ApiSuccess<{ exists: false }>>({
        success: true,
        data: { exists: false },
        requestId: c.get("requestId"),
      });
    }

    const parsed = emailSchema.safeParse({ email });
    if (!parsed.success) {
      return c.json<ApiSuccess<{ exists: false }>>({
        success: true,
        data: { exists: false },
        requestId: c.get("requestId"),
      });
    }

    const db = createDatabase(c.env.DB);
    const [user] = await db
      .select()
      .from(User)
      .where(eq(User.email, parsed.data.email.trim().toLowerCase()))
      .limit(1);

    if (!user) {
      return c.json<ApiSuccess<{ exists: false }>>({
        success: true,
        data: { exists: false },
        requestId: c.get("requestId"),
      });
    }

    const [latest] = await db
      .select()
      .from(RegistrationRequest)
      .where(eq(RegistrationRequest.userId, user.id))
      .orderBy(desc(RegistrationRequest.cycle))
      .limit(1);

    const response = {
      exists: true,
      status: user.status,
      emailVerified: user.emailVerified,
      name: user.name,
      email: user.email,
      institutionName: user.institutionName,
      institutionUserId: user.institutionUserId,
      phone: user.phone,
      room: user.room,
      gender: user.gender,
      changesRequested: parseJsonValue(user.changesRequested),
      changesRequestReason: user.changesRequestReason,
      changesRequestedAt: databaseDateToIso(user.changesRequestedAt),
      rejectionReason: user.rejectionReason,
      cycle: latest?.cycle ?? null,
      reviewStatus: latest?.status ?? null,
      reviewedAt: databaseDateToIso(latest?.reviewedAt),
      submittedAt: databaseDateToIso(latest?.createdAt),
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/auth/send-verification", async (c) => {
    const ipAddress = getClientIp(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "send-verification");
    if (!rateLimit.allowed) {
      return failure(c, "Too many requests. Please try again later.", 429);
    }

    const parsed = emailSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid verification request", 400);
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
    if (user.emailVerified) {
      const response = { sent: true, alreadyVerified: true };
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
    await db
      .update(User)
      .set({
        emailVerifyToken: hashOtp(otp),
        emailVerifyExpires: expiresAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, user.id));

    try {
      await sendOtpEmail(c, user.email, otp, "email-verification");
    } catch (error) {
      console.error("failed to send email verification code", {
        requestId: c.get("requestId"),
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(c, "Failed to send verification code. Please try again.", 500);
    }

    await logAudit(c, {
      actorId: user.id,
      action: "VERIFICATION_RESENT",
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

  app.post("/api/auth/verify-email", async (c) => {
    const ipAddress = getClientIp(c);
    const rateLimit = await checkRateLimit(c, ipAddress, "verify-email");
    if (!rateLimit.allowed) {
      return failure(c, "Too many attempts. Please try again later.", 429);
    }

    const parsed = verifyEmailSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid verification request", 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, email)).limit(1);

    if (!user) return failure(c, "Invalid or expired code", 400);

    const response = { userId: user.id, email: user.email, emailVerified: true as const };
    if (user.emailVerified) {
      return c.json<ApiSuccess<typeof response>>({
        success: true,
        data: response,
        requestId: c.get("requestId"),
      });
    }

    if (
      !user.emailVerifyToken ||
      !isFutureDatabaseDate(user.emailVerifyExpires) ||
      !verifyOtp(parsed.data.otp, user.emailVerifyToken)
    ) {
      return failure(c, "Invalid or expired code", 400);
    }

    await db
      .update(User)
      .set({
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(User.id, user.id));

    await logAudit(c, {
      actorId: user.id,
      action: "EMAIL_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress,
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
