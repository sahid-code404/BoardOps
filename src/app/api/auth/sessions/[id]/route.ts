import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";

/** DELETE /api/auth/sessions/[id] — revoke a specific session */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await ctx.params;
    const h = await headers();
    const currentToken = (h.get("authorization") || "").replace("Bearer ", "").trim();

    const session = await db.userSession.findUnique({ where: { id } });
    if (!session) return err("Session not found", 404);
    if (session.userId !== user.id) return err("This session does not belong to you", 403);
    if (session.token === currentToken) return err("Use logout to end your current session", 422);

    await db.userSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await logAudit({
      actorId: user.id,
      action: "SESSION_REVOKE",
      entity: "UserSession",
      entityId: id,
    });

    return ok({ success: true });
  } catch (e) {
    return handleApiError(e);
  }
}
