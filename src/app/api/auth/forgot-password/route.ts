import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { hashOtp, generateOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * POST /api/auth/forgot-password
 * PRD 03.12: Forgot Password flow — Email → OTP → Reset Password → Invalidate sessions
 *
 * Generates a 6-digit OTP, stores a bcrypt hash + 10-min expiry on the user.
 * The OTP is logged to console (dev) so it can be retrieved from the server log.
 */
const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rateLimit = checkRateLimit(ip, "forgot-password");
    if (!rateLimit.allowed) {
      return err("Too many requests. Please try again later.", 429);
    }

    const body = await req.json();
    const { email } = schema.parse(body);

    const user = await db.user.findUnique({ where: { email } });

    // Always return success — don't leak whether the email exists
    if (!user) {
      return ok({ sent: true });
    }

    // Generate 6-digit OTP
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.user.update({
      where: { id: user.id },
      data: {
        resetOtpHash: otpHash,
        resetOtpExpires: expiresAt,
      },
    });

    // Log OTP to console (dev mode — in production this would be emailed)
    console.log(`[PASSWORD RESET OTP for ${email}]: ${otp}`);

    await logAudit({
      actorId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ sent: true });
  } catch (e) {
    return handleApiError(e);
  }
}
