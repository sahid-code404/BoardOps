import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { hashOtp, generateOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rateLimit = await checkRateLimit(ip, "forgot-password");
    if (!rateLimit.allowed) {
      return err("Too many requests. Please try again later.", 429);
    }

    const body = await req.json();
    const { email } = schema.parse(body);

    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      return ok({ sent: true });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: {
        resetOtpHash: otpHash,
        resetOtpExpires: expiresAt,
      },
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(`[PASSWORD RESET OTP for ${email}]: ${otp}`);
    }

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
