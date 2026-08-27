import { db } from "@/lib/db";
import { requireAuth, getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { generateBackupCodes } from "@/lib/two-factor";
import { verifyTotp } from "@/lib/two-factor";
import { z } from "zod";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

/**
 * POST /api/auth/2fa/backup-codes
 * Regenerates backup codes. Requires a valid TOTP code.
 * Returns new backup codes (shown only once).
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { code } = schema.parse(body);

    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return err("User not found", 404);
    if (!fullUser.twoFactorEnabled || !fullUser.twoFactorSecret) {
      return err("Two-factor authentication is not enabled", 422);
    }

    if (!verifyTotp(code, fullUser.twoFactorSecret)) {
      return err("Invalid verification code", 403);
    }

    const { plain, hashes } = generateBackupCodes();

    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorBackupCodes: JSON.stringify(hashes),
      },
    });

    await logAudit({
      actorId: user.id,
      action: "2FA_BACKUP_CODES_REGEN",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ backupCodes: plain });
  } catch (e) {
    return handleApiError(e);
  }
}
