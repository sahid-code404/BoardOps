import { db } from "@/lib/db";

export async function createNotification(input: {
  userId: string;
  title: string;
  description?: string;
  type?: "INFO" | "SUCCESS" | "WARNING" | "DANGER";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  route?: string;
}) {
  try {
    return await db.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        description: input.description,
        type: input.type ?? "INFO",
        priority: input.priority ?? "NORMAL",
        route: input.route,
      },
    });
  } catch (e) {
    console.error("notify failed:", e);
  }
}
