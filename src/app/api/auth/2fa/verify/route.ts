import { db } from "@/lib/db";
import { requireAuth, getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { verifyTotp, generateBackupCodes } from "@/lib/two-factor";
import { z } from "zod";

const schema = z.object({
  secret: z.string().min(16, "Invalid secret"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

/**
 * POST /api/auth/2fa/verify
 * Verifies the TOTP code and enables authenticator-app 2FA.
 * Returns backup codes (shown only once).
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { secret, code } = schema.parse(body);

    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (fullUser?.twoFactorEnabled) {
      return err("Two-factor authentication is already enabled", 422);
    }

    if (!verifyTotp(code, secret)) {
      return err("Invalid verification code. Try again.", 403);
    }

    const { plain, hashes } = generateBackupCodes();

    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: "TOTP",
        twoFactorSecret: secret,
        twoFactorBackupCodes: JSON.stringify(hashes),
        emailOtpCode: null,
        emailOtpExpiresAt: null,
        emailOtpAttempts: 0,
        otpPendingToken: null,
        otpPendingExpiresAt: null,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "2FA_ENABLE",
      entity: "User",
      entityId: user.id,
      newValue: { method: "TOTP" },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ backupCodes: plain, method: "TOTP" });
  } catch (e) {
    return handleApiError(e);
  }
}
