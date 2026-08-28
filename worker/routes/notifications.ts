import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Notification } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { cleanupOldReadNotifications } from "../notification-cleanup";
import type { BoardOpsEnv } from "../types";

type NotificationErrorStatus = 400 | 401 | 404;

const patchSchema = z.object({
  markAllRead: z.boolean().optional(),
  id: z.string().min(1).optional(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: NotificationErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializeNotification(record: typeof Notification.$inferSelect) {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    description: record.description,
    type: record.type,
    priority: record.priority,
    route: record.route,
    readAt: databaseDateToIso(record.readAt),
    createdAt: databaseDateToIso(record.createdAt),
  };
}

export function registerNotificationRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/notifications", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    await cleanupOldReadNotifications(c);

    const unreadOnly = c.req.query("unread") === "true";
    const db = createDatabase(c.env.DB);
    const notifications = unreadOnly
      ? await db
          .select()
          .from(Notification)
          .where(and(eq(Notification.userId, user.id), isNull(Notification.readAt)))
          .orderBy(desc(Notification.createdAt))
          .limit(50)
      : await db
          .select()
          .from(Notification)
          .where(eq(Notification.userId, user.id))
          .orderBy(desc(Notification.createdAt))
          .limit(50);

    const [countRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(Notification)
      .where(and(eq(Notification.userId, user.id), isNull(Notification.readAt)));

    const response = {
      notifications: notifications.map(serializeNotification),
      unreadCount: Number(countRow?.value ?? 0),
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.patch("/api/notifications", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid notification update", 400);
    }

    const db = createDatabase(c.env.DB);

    if (parsed.data.markAllRead) {
      await db
        .update(Notification)
        .set({ readAt: new Date().toISOString() })
        .where(and(eq(Notification.userId, user.id), isNull(Notification.readAt)));
      await cleanupOldReadNotifications(c);

      return c.json<ApiSuccess<{ success: true }>>({
        success: true,
        data: { success: true },
        requestId: c.get("requestId"),
      });
    }

    if (parsed.data.id) {
      const [notification] = await db
        .select()
        .from(Notification)
        .where(eq(Notification.id, parsed.data.id))
        .limit(1);

      if (!notification || notification.userId !== user.id) {
        return failure(c, "Notification not found", 404);
      }

      await db
        .update(Notification)
        .set({ readAt: notification.readAt ? null : new Date().toISOString() })
        .where(eq(Notification.id, notification.id));
      await cleanupOldReadNotifications(c);

      return c.json<ApiSuccess<{ success: true }>>({
        success: true,
        data: { success: true },
        requestId: c.get("requestId"),
      });
    }

    return failure(c, "Nothing to update", 400);
  });
}
