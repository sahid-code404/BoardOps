import { db } from "@/lib/db";
import { requireAuth, parseUserAgent } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { headers } from "next/headers";

export async function GET() {
  try {
    const user = await requireAuth();
    const h = await headers();
    const currentToken = (h.get("authorization") || "").replace("Bearer ", "").trim();

    const sessions = await db.userSession.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    const shaped = sessions.map((s) => {
      const ua = parseUserAgent(s.userAgent);
      return {
        id: s.id,
        current: s.token === currentToken,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        ipAddress: s.ipAddress || "Unknown",
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      };
    });

    return ok(shaped);
  } catch (e) {
    return handleApiError(e);
  }
}

/** Revoke all other sessions (not the current one) */
export async function DELETE() {
  try {
    const user = await requireAuth();
    const h = await headers();
    const currentToken = (h.get("authorization") || "").replace("Bearer ", "").trim();

    const result = await db.userSession.updateMany({
      where: {
        userId: user.id,
        NOT: { token: currentToken },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return ok({ revoked: result.count });
  } catch (e) {
    return handleApiError(e);
  }
}
