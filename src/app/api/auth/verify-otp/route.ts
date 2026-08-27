import { db } from "@/lib/db";
import { generateToken, getTokenExpiry } from "@/lib/auth";
import { getClientIp, getUserAgent, setAuthCookie } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { verifyOtp, OTP_CONFIG } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { trustDevice, DEVICE_COOKIE_NAME, DEVICE_COOKIE_MAX_AGE } from "@/lib/device-trust";
import { cookies } from "next/headers";

const schema = z.object({
  pendingToken: z.string().min(10, "Invalid pending token"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pendingToken, code } = schema.parse(body);
    const ip = await getClientIp();
    const rateLimit = await checkRateLimit(ip, "verify-otp");
    if (!rateLimit.allowed) {
      return err("Too many attempts. Please try again later.", 429);
    }
    const ua = await getUserAgent();
    const now = new Date();

    const user = await db.user.findFirst({
      where: {
        otpPendingToken: pendingToken,
        otpPendingExpiresAt: { gte: now },
      },
    });

    if (!user) {
      return err("Session expired or invalid. Please log in again.", 401);
    }

    if (!user.emailOtpExpiresAt || user.emailOtpExpiresAt < now) {
      return err("Verification code has expired. Please request a new one.", 401);
    }

    if (user.emailOtpAttempts >= OTP_CONFIG.maxAttempts) {
      return err("Too many failed attempts. Please log in again.", 429);
    }

    if (!user.emailOtpCode || !verifyOtp(code, user.emailOtpCode)) {
      await db.user.update({
        where: { id: user.id },
        data: { emailOtpAttempts: { increment: 1 } },
      });
      const remaining = OTP_CONFIG.maxAttempts - (user.emailOtpAttempts + 1);
      await logAudit({
        actorId: user.id,
        action: "OTP_FAILED",
        entity: "User",
        entityId: user.id,
        ipAddress: ip,
        userAgent: ua,
      });
      return err(`Invalid verification code. ${remaining} attempt(s) remaining.`, 401);
    }

    const token = generateToken();
    const expiresAt = getTokenExpiry(30);
    await db.userSession.create({
      data: { userId: user.id, token, expiresAt, ipAddress: ip, userAgent: ua },
    });

    const deviceToken = await trustDevice(user.id, ua, ip);
    const cookieStore = await cookies();
    cookieStore.set(DEVICE_COOKIE_NAME, deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      path: "/",
    });

    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        emailOtpCode: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
        otpPendingToken: null,
        otpPendingExpiresAt: null,
      },
    });

    await db.loginHistory.create({
      data: { userId: user.id, success: true, ipAddress: ip, userAgent: ua },
    });
    await logAudit({
      actorId: user.id,
      action: "OTP_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
      userAgent: ua,
    });
    await logAudit({
      actorId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
      userAgent: ua,
    });

    return setAuthCookie(
      ok({
        token,
        user: {
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
          twoFactorMethod: user.twoFactorMethod,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },
        expiresAt,
      }),
      token
    );
  } catch (e) {
    return handleApiError(e);
  }
}
