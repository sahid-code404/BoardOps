import type { Hono } from "hono";

import { logAudit } from "../auth/audit";
import {
  clearAuthCookie,
  getAuthUser,
  getClientIp,
  getSessionToken,
  getUserAgent,
  revokeCurrentSession,
} from "../auth/session";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

export function registerAuthRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/auth/me", async (c) => {
    const user = await getAuthUser(c);
    if (!user) {
      return c.json<ApiFailure>(
        { success: false, error: "Not authenticated" },
        401,
      );
    }

    return c.json<ApiSuccess<typeof user>>({ success: true, data: user });
  });

  app.post("/api/auth/logout", async (c) => {
    const user = await getAuthUser(c);
    const token = getSessionToken(c);

    if (user && token) {
      await revokeCurrentSession(c);
      await logAudit(c, {
        actorId: user.id,
        action: "LOGOUT",
        entity: "User",
        entityId: user.id,
        ipAddress: getClientIp(c),
        userAgent: getUserAgent(c),
      });
    }

    clearAuthCookie(c);
    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
    });
  });
}
