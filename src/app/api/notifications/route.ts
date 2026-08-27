import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { cleanupOldReadNotifications } from "@/lib/notification-cleanup";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();

    // Auto-delete read notifications older than 24 hours (for all users)
    await cleanupOldReadNotifications();

    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const notifications = await db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unreadCount = await db.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return ok({ notifications, unreadCount });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireAuth();
    const body = (await req.json()) as { markAllRead?: boolean; id?: string };
    if (body.markAllRead) {
      await db.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
      // Clean up old read notifications after marking all as read
      await cleanupOldReadNotifications();
      return ok({ success: true });
    }
    if (body.id) {
      const n = await db.notification.findUnique({ where: { id: body.id } });
      if (!n || n.userId !== user.id) return err("Notification not found", 404);
      await db.notification.update({
        where: { id: body.id },
        data: { readAt: n.readAt ? null : new Date() },
      });
      // Clean up old read notifications
      await cleanupOldReadNotifications();
      return ok({ success: true });
    }
    return err("Nothing to update", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
