import { db } from "@/lib/db";
import { verifyPassword, generateToken, getTokenExpiry } from "@/lib/auth";
import { getClientIp, getUserAgent, setAuthCookie } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rateLimit = await checkRateLimit(ip, "login");
    if (!rateLimit.allowed) {
      return err("Too many login attempts. Please try again later.", 429);
    }

    const body = await req.json();
    const { email, password } = schema.parse(body);

    const user = await db.user.findUnique({ where: { email } });
    if (!user) return err("Incorrect email or password", 401);

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      await db.loginHistory.create({
        data: {
          userId: user.id,
          success: false,
          ipAddress: await getClientIp(),
          userAgent: await getUserAgent(),
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

    const token = generateToken();
    const expiresAt = getTokenExpiry(30);
    await db.userSession.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      },
    });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await db.loginHistory.create({
      data: {
        userId: user.id,
        success: true,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      },
    });
    await logAudit({
      actorId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
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
