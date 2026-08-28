import type { Context } from "hono";

import { createDatabase } from "../db/client";
import { AuditLog } from "../db/schema";
import type { BoardOpsEnv } from "../types";

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
};

export async function logAudit(c: Context<BoardOpsEnv>, input: AuditInput): Promise<void> {
  try {
    const db = createDatabase(c.env.DB);
    await db.insert(AuditLog).values({
      id: crypto.randomUUID(),
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      oldValue: input.oldValue ? JSON.stringify(input.oldValue) : null,
      newValue: input.newValue ? JSON.stringify(input.newValue) : null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      reason: input.reason ?? null,
    });
  } catch (error) {
    console.error("audit log failed", {
      requestId: c.get("requestId"),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
