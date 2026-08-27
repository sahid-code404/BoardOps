import { db } from "@/lib/db";
import { verifyPassword, generateToken, getTokenExpiry } from "@/lib/auth";
import { getClientIp, getUserAgent, setAuthCookie } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateOtp, generatePendingToken, hashOtp, OTP_CONFIG } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";
import { DEVICE_COOKIE_NAME, isDeviceTrusted } from "@/lib/device-trust";
import { cookies } from "next/headers";

const schema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const userAgent = await getUserAgent();
    const rateLimit = await checkRateLimit(ip, "login");
    if (!rateLimit.allowed) {
      return err("Too many login attempts. Please try again later.", 429);
    }

    const body = await req.json();
    const { email, password } = schema.parse(body);
    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return err("Incorrect email or password", 401);

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      await db.loginHistory.create({
        data: {
          userId: user.id,
          success: false,
          ipAddress: ip,
          userAgent,
          reason: "WRONG_PASSWORD",
        },
      });
      return err("Incorrect email or password", 401);
    }

    if (user.status === "PENDING") return err("Your account is awaiting admin approval", 403);
    if (user.status === "SUSPENDED") return err("Your account has been suspended. Contact admin.", 403);
    if (user.status === "ARCHIVED" || user.status === "INACTIVE")
      return err("Your account is no longer active", 403);
    if (user.status !== "ACTIVE") return err("Account access denied", 403);

    if (!user.emailVerified) {
      return err("Please verify your email address first. Use the verification link sent to your inbox, or check your registration status page.", 403);
    }

    if (user.twoFactorEnabled) {
      const cookieStore = await cookies();
      const deviceToken = cookieStore.get(DEVICE_COOKIE_NAME)?.value ?? null;
      const trustedDevice = await isDeviceTrusted(user.id, deviceToken);

      if (!trustedDevice) {
        const otp = generateOtp();
        const pendingToken = generatePendingToken();
        const expiresAt = new Date(Date.now() + OTP_CONFIG.ttlMs);

        await db.user.update({
          where: { id: user.id },
          data: {
            twoFactorMethod: "EMAIL",
            emailOtpCode: hashOtp(otp),
            emailOtpExpiresAt: expiresAt,
            emailOtpAttempts: 0,
            otpPendingToken: pendingToken,
            otpPendingExpiresAt: expiresAt,
          },
        });

        await sendOtpEmail(user.email, otp, "two-factor");
        await logAudit({
          actorId: user.id,
          action: "LOGIN_2FA_CHALLENGE",
          entity: "User",
          entityId: user.id,
          ipAddress: ip,
          userAgent,
          newValue: { method: "EMAIL" },
        });

        return ok({
          requiresTwoFactor: true,
          pendingToken,
          method: "EMAIL",
          expiresAt,
        });
      }
    }

    const token = generateToken();
    const expiresAt = getTokenExpiry(30);
    await db.userSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
        ipAddress: ip,
        userAgent,
      },
    });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await db.loginHistory.create({
      data: {
        userId: user.id,
        success: true,
        ipAddress: ip,
        userAgent,
      },
    });
    await logAudit({
      actorId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
      userAgent,
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
