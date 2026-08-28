import { asc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Setting } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type SettingErrorStatus = 400 | 401 | 403 | 404;

const upsertSchema = z.object({
  key: z.string(),
  value: z.string(),
  category: z.string().default("GENERAL"),
  type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "JSON"]).default("TEXT"),
  description: z.string().optional(),
  isPublic: z.boolean().default(false),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: SettingErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializeSetting(record: typeof Setting.$inferSelect) {
  return {
    id: record.id,
    key: record.key,
    value: record.value,
    category: record.category,
    type: record.type,
    description: record.description,
    isPublic: record.isPublic,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

async function requireActiveUser(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  return { user, response: null } as const;
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const access = await requireActiveUser(c);
  if (access.response) return access;
  if (access.user!.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return access;
}

export function registerSettingRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/settings", async (c) => {
    const access = await requireActiveUser(c);
    if (access.response) return access.response;
    const user = access.user!;

    const category = c.req.query("category")?.trim() || null;
    const includePrivate = user.role === "ADMIN";
    const db = createDatabase(c.env.DB);

    const records = category
      ? includePrivate
        ? await db
            .select()
            .from(Setting)
            .where(eq(Setting.category, category))
            .orderBy(asc(Setting.category))
        : await db
            .select()
            .from(Setting)
            .where(eq(Setting.category, category))
            .orderBy(asc(Setting.category))
      : await db.select().from(Setting).orderBy(asc(Setting.category));

    const visible = includePrivate ? records : records.filter((record) => record.isPublic);
    const response = visible.map(serializeSetting);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/settings", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const parsed = upsertSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid setting", 400);
    }

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select()
      .from(Setting)
      .where(eq(Setting.key, parsed.data.key))
      .limit(1);
    const now = new Date().toISOString();

    if (existing) {
      await db
        .update(Setting)
        .set({
          value: parsed.data.value,
          category: parsed.data.category,
          type: parsed.data.type,
          description: parsed.data.description ?? null,
          isPublic: parsed.data.isPublic,
          updatedAt: now,
        })
        .where(eq(Setting.id, existing.id));
    } else {
      await db.insert(Setting).values({
        id: crypto.randomUUID(),
        key: parsed.data.key,
        value: parsed.data.value,
        category: parsed.data.category,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        isPublic: parsed.data.isPublic,
        updatedAt: now,
      });
    }

    const [setting] = await db
      .select()
      .from(Setting)
      .where(eq(Setting.key, parsed.data.key))
      .limit(1);
    if (!setting) return failure(c, "Setting not found", 404);
    const response = serializeSetting(setting);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/settings/:key", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const key = c.req.param("key");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Setting).where(eq(Setting.key, key)).limit(1);
    if (!existing) return failure(c, "Setting not found", 404);

    await db.delete(Setting).where(eq(Setting.key, key));
    await logAudit(c, {
      actorId: admin.id,
      action: "DELETE",
      entity: "Setting",
      entityId: key,
      oldValue: serializeSetting(existing),
    });

    return c.json<ApiSuccess<{ success: true }>>({
      success: true,
      data: { success: true },
      requestId: c.get("requestId"),
    });
  });
}
