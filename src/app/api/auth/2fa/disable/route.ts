import { db } from "@/lib/db";
import { requireAuth, getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({
  password: z.string().min(1, "Password is required"),
});

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA after verifying the user's password.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { password } = schema.parse(body);

    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return err("User not found", 404);
    if (!fullUser.twoFactorEnabled) {
      return err("Two-factor authentication is not enabled", 422);
    }

    if (!verifyPassword(password, fullUser.passwordHash)) {
      return err("Password is incorrect", 403);
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "2FA_DISABLE",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ success: true });
  } catch (e) {
    return handleApiError(e);
  }
}
