import { db } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";
import { generateOtp, hashOtp } from "../register/route";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = schema.parse(body);
    const normalizedEmail = email.toLowerCase();

    const user = await db.user.findUnique({ where: { email: normalizedEmail } });

    // Don't leak existence — return ok regardless.
    if (!user) return ok({ sent: true });
    if (user.emailVerified) return ok({ sent: true, alreadyVerified: true });

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: otpHash,
        emailVerifyExpires: otpExpires,
      },
    });

    // Dev-only: log the OTP so we can grab it from the dev server log.
    console.log(`[EMAIL OTP for ${user.email}]: ${otp}`);

    await logAudit({
      actorId: user.id,
      action: "VERIFICATION_RESENT",
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
