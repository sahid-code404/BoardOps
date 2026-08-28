import type { Context } from "hono";

import { createDatabase } from "./db/client";
import { Notification } from "./db/schema";
import type { BoardOpsEnv } from "./types";

export async function createNotification(
  c: Context<BoardOpsEnv>,
  input: {
    userId: string;
    title: string;
    description?: string;
    type?: "INFO" | "SUCCESS" | "WARNING" | "DANGER";
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    route?: string;
  },
): Promise<void> {
  try {
    const db = createDatabase(c.env.DB);
    await db.insert(Notification).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      type: input.type ?? "INFO",
      priority: input.priority ?? "NORMAL",
      route: input.route ?? null,
    });
  } catch (error) {
    console.error("notification insert failed", {
      requestId: c.get("requestId"),
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
