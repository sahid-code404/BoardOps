import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { hashPassword, validatePassword } from "@/lib/password-policy";
import { verifyOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  resetToken: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(1, "New password is required"),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rateLimit = await checkRateLimit(ip, "reset-password");
    if (!rateLimit.allowed) {
      return err("Too many attempts. Please try again later.", 429);
    }

    const body = await req.json();
    const { email, resetToken, newPassword } = schema.parse(body);

    const user = await db.user.findUnique({ where: { email } });
    if (!user) return err("Invalid or expired reset token", 400);
    if (!user.resetOtpHash || !user.resetOtpExpires) return err("Invalid or expired reset token", 400);

    if (user.resetOtpExpires < new Date()) {
      return err("Reset token has expired. Start the password reset process again.", 400);
    }

    if (!verifyOtp(resetToken, user.resetOtpHash)) {
      return err("Invalid reset token", 400);
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      return err(validation.errors.join("; "), 422);
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(newPassword),
        resetOtpHash: null,
        resetOtpExpires: null,
      },
    });

    await db.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await logAudit({
      actorId: user.id,
      action: "PASSWORD_RESET_COMPLETED",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ reset: true });
  } catch (e) {
    return handleApiError(e);
  }
}
