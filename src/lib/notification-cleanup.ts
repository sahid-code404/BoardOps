import { db } from "@/lib/db";

/**
 * Delete notifications that were read more than 24 hours ago.
 * Called on every GET /api/notifications and on mark-as-read to keep
 * the notification list clean for all users.
 */
export async function cleanupOldReadNotifications(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const result = await db.notification.deleteMany({
      where: {
        readAt: { not: null, lt: cutoff },
      },
    });
    return result.count;
  } catch (e) {
    console.error("Failed to cleanup old notifications:", e);
    return 0;
  }
}
