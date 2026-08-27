import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { ok, err, handleApiError } from "@/lib/api-response";
import { z } from "zod";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  enable: z.boolean(),
  password: z.string().min(1, "Password is required to change 2FA settings"),
});

/** POST /api/auth/2fa/toggle — enable or disable email-based 2FA.
 *  Requires the current password for security. No TOTP/QR setup needed —
 *  the OTP is sent to the user's registered email. */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { enable, password } = schema.parse(body);

    // Verify current password
    const fullUser = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, email: true } });
    if (!fullUser) return err("User not found", 404);
    if (!verifyPassword(password, fullUser.passwordHash)) {
      return err("Incorrect password", 401);
    }

    if (enable) {
      // Enable email 2FA — no setup needed, OTP goes to user's email
      await db.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: "EMAIL",
          // Clear legacy TOTP fields
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      });
      await logAudit({
        actorId: user.id,
        action: "2FA_ENABLE",
        entity: "User",
        entityId: user.id,
        newValue: { method: "EMAIL" },
      });
      return ok({ enabled: true, method: "EMAIL", message: "Two-factor authentication enabled. A verification code will be sent to your email on each login." });
    } else {
      // Disable 2FA
      await db.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorMethod: "EMAIL",
          emailOtpCode: null,
          emailOtpExpiresAt: null,
          emailOtpAttempts: 0,
          otpPendingToken: null,
          otpPendingExpiresAt: null,
        },
      });
      await logAudit({
        actorId: user.id,
        action: "2FA_DISABLE",
        entity: "User",
        entityId: user.id,
      });
      return ok({ enabled: false, message: "Two-factor authentication disabled." });
    }
  } catch (e) {
    return handleApiError(e);
  }
}
