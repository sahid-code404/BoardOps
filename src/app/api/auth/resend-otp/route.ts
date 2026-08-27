import { db } from "@/lib/db";
import { getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { generateOtp, hashOtp, OTP_CONFIG } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";

const schema = z.object({
  pendingToken: z.string().min(10, "Invalid pending token"),
});

/** POST /api/auth/resend-otp — resend the 6-digit OTP code.
 *  Rate-limited: max 1 resend per 30 seconds. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pendingToken } = schema.parse(body);
    const ip = await getClientIp();
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

    // Rate limit: check if the last OTP was sent less than 30s ago
    if (user.emailOtpExpiresAt) {
      const elapsed = now.getTime() - (user.emailOtpExpiresAt.getTime() - OTP_CONFIG.ttlMs);
      if (elapsed < 30_000) {
        const wait = Math.ceil((30_000 - elapsed) / 1000);
        return err(`Please wait ${wait} second(s) before requesting a new code.`, 429);
      }
    }

    // Generate new OTP
    const otpCode = generateOtp();
    const otpHash = hashOtp(otpCode);

    await db.user.update({
      where: { id: user.id },
      data: {
        emailOtpCode: otpHash,
        emailOtpExpiresAt: new Date(now.getTime() + OTP_CONFIG.ttlMs),
        emailOtpAttempts: 0,
      },
    });

    try {
      await sendOtpEmail(user.email, otpCode, "login");
    } catch (e) {
      console.error("Failed to resend OTP email:", e);
      return err("Failed to send verification code. Please try again.", 500);
    }

    await logAudit({
      actorId: user.id,
      action: "OTP_RESENT",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
      userAgent: ua,
    });

    return ok({
      resent: true,
      expiresAt: new Date(now.getTime() + OTP_CONFIG.ttlMs).toISOString(),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
