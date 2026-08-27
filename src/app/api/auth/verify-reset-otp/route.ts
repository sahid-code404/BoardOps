import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { hashOtp, verifyOtp } from "@/lib/otp";
import crypto from "crypto";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  otp: z.string().length(6, "Enter the 6-digit code"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, otp } = schema.parse(body);

    const user = await db.user.findUnique({ where: { email } });
    if (!user) return err("Invalid or expired code", 400);
    if (!user.resetOtpHash || !user.resetOtpExpires) return err("No reset code was sent. Request a new one.", 400);

    if (user.resetOtpExpires < new Date()) {
      return err("Reset code has expired. Request a new one.", 400);
    }

    if (!verifyOtp(otp, user.resetOtpHash)) {
      return err("Invalid reset code", 400);
    }

    // Generate a temporary reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = hashOtp(resetToken);

    await db.user.update({
      where: { id: user.id },
      data: {
        resetOtpHash: resetTokenHash,
        resetOtpExpires: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await logAudit({
      actorId: user.id,
      action: "PASSWORD_RESET_OTP_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ verified: true, resetToken });
  } catch (e) {
    return handleApiError(e);
  }
}
