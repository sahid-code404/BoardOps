import { db } from "@/lib/db";
import { getAuthUser, getClientIp, getUserAgent, getSessionToken, clearAuthCookie } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

export async function POST() {
  try {
    const user = await getAuthUser();
    const token = await getSessionToken();
    if (user && token) {
      await db.userSession.updateMany({
        where: { token, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await logAudit({
        actorId: user.id,
        action: "LOGOUT",
        entity: "User",
        entityId: user.id,
        ipAddress: await getClientIp(),
        userAgent: await getUserAgent(),
      });
    }
    return clearAuthCookie(ok({ success: true }));
  } catch (e) {
    return handleApiError(e);
  }
}
