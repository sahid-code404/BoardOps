import { and, isNotNull, lt } from "drizzle-orm";
import type { Context } from "hono";

import { createDatabase } from "./db/client";
import { Notification } from "./db/schema";
import type { BoardOpsEnv } from "./types";

const READ_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function cleanupOldReadNotifications(c: Context<BoardOpsEnv>): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - READ_RETENTION_MS).toISOString();
    const db = createDatabase(c.env.DB);
    const stale = await db
      .select({ id: Notification.id })
      .from(Notification)
      .where(and(isNotNull(Notification.readAt), lt(Notification.readAt, cutoff)));

    if (stale.length === 0) return 0;

    await db
      .delete(Notification)
      .where(and(isNotNull(Notification.readAt), lt(Notification.readAt, cutoff)));
    return stale.length;
  } catch (error) {
    console.error("failed to cleanup old notifications", {
      requestId: c.get("requestId"),
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
