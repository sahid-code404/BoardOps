import { db } from "@/lib/db";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { verifyOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export async function POST(req: Request) {
  try {
    const ip = await getClientIp();
    const rateLimit = await checkRateLimit(ip, "verify-email");
    if (!rateLimit.allowed) {
      return err("Too many attempts. Please try again later.", 429);
    }

    const body = await req.json();
    const { email, otp } = schema.parse(body);
    const normalizedEmail = email.toLowerCase();

    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return err("Invalid or expired code", 400);

    if (user.emailVerified) {
      return ok({ userId: user.id, email: user.email, emailVerified: true });
    }

    if (!user.emailVerifyToken || !user.emailVerifyExpires) {
      return err("Invalid or expired code", 400);
    }
    if (user.emailVerifyExpires < new Date()) {
      return err("Invalid or expired code", 400);
    }
    if (!verifyOtp(otp, user.emailVerifyToken)) {
      return err("Invalid or expired code", 400);
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "EMAIL_VERIFIED",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ userId: user.id, email: user.email, emailVerified: true });
  } catch (e) {
    return handleApiError(e);
  }
}
