import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
  type SessionUser,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Announcement, Notification, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type AnnouncementErrorStatus = 400 | 401 | 403 | 404 | 422;

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  body: z.string().min(5, "Body must be at least 5 characters").max(5000),
  type: z.enum(["INFO", "WARNING", "MAINTENANCE", "EVENT"]).default("INFO"),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  targetAudience: z.enum(["ALL", "RESIDENTS", "ADMINS"]).default("ALL"),
  isPinned: z.boolean().default(true),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).default("PUBLISHED"),
  expiresAt: z.string().optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(5).max(5000).optional(),
  type: z.enum(["INFO", "WARNING", "MAINTENANCE", "EVENT"]).optional(),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).optional(),
  targetAudience: z.enum(["ALL", "RESIDENTS", "ADMINS"]).optional(),
  isPinned: z.boolean().optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  expiresAt: z.string().optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: AnnouncementErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function activeUser(c: Context<BoardOpsEnv>): Promise<SessionUser | null> {
  const user = await getAuthUser(c);
  return user?.status === "ACTIVE" ? user : null;
}

function parseOptionalDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function serializeAnnouncement(
  record: typeof Announcement.$inferSelect,
  creator: { id: string; name: string; email: string } | null,
) {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    type: record.type,
    priority: record.priority,
    targetAudience: record.targetAudience,
    isPinned: record.isPinned,
    status: record.status,
    publishedAt: databaseDateToIso(record.publishedAt),
    expiresAt: databaseDateToIso(record.expiresAt),
    createdBy: record.createdBy,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
    user: creator,
  };
}

async function loadAnnouncement(c: Context<BoardOpsEnv>, id: string) {
  const db = createDatabase(c.env.DB);
  const [row] = await db
    .select({ announcement: Announcement, creatorId: User.id, creatorName: User.name, creatorEmail: User.email })
    .from(Announcement)
    .leftJoin(User, eq(Announcement.createdBy, User.id))
    .where(eq(Announcement.id, id))
    .limit(1);

  if (!row) return null;
  const creator = row.creatorId && row.creatorName && row.creatorEmail
    ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
    : null;
  return { raw: row.announcement, serialized: serializeAnnouncement(row.announcement, creator) };
}

async function requireAnnouncementAdmin(c: Context<BoardOpsEnv>) {
  const user = await activeUser(c);
  if (!user) return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

async function createAudienceNotifications(
  c: Context<BoardOpsEnv>,
  input: {
    title: string;
    body: string;
    type: string;
    priority: string;
    targetAudience: string;
  },
): Promise<void> {
  const db = createDatabase(c.env.DB);
  const baseCondition = and(eq(User.status, "ACTIVE"), isNull(User.deletedAt));
  const targetUsers = input.targetAudience === "RESIDENTS"
    ? await db.select({ id: User.id }).from(User).where(and(baseCondition, eq(User.role, "USER")))
    : input.targetAudience === "ADMINS"
      ? await db
          .select({ id: User.id })
          .from(User)
          .where(and(baseCondition, inArray(User.role, ["ADMIN", "SUPER_ADMIN"])))
      : await db.select({ id: User.id }).from(User).where(baseCondition);

  if (targetUsers.length === 0) return;

  const notificationType = input.type === "WARNING" || input.type === "MAINTENANCE"
    ? "WARNING"
    : "INFO";
  const values = targetUsers.map((target) => ({
    id: crypto.randomUUID(),
    userId: target.id,
    title: `📢 ${input.title}`,
    description: input.body.slice(0, 200),
    type: notificationType,
    priority: input.priority,
    route: "announcements",
  }));

  for (let index = 0; index < values.length; index += 100) {
    await db.insert(Notification).values(values.slice(index, index + 100));
  }
}

export function registerAnnouncementRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/announcements", async (c) => {
    const user = await activeUser(c);
    if (!user) return failure(c, "Not authenticated", 401);

    const status = c.req.query("status")?.trim() || null;
    const requestedLimit = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 50;
    const db = createDatabase(c.env.DB);
    const now = new Date().toISOString();

    const rows = user.role === "USER"
      ? await db
          .select({ announcement: Announcement, creatorId: User.id, creatorName: User.name, creatorEmail: User.email })
          .from(Announcement)
          .leftJoin(User, eq(Announcement.createdBy, User.id))
          .where(
            and(
              eq(Announcement.status, "PUBLISHED"),
              inArray(Announcement.targetAudience, ["ALL", "RESIDENTS"]),
              or(isNull(Announcement.expiresAt), gt(Announcement.expiresAt, now)),
            ),
          )
          .orderBy(desc(Announcement.publishedAt))
          .limit(limit)
      : status
        ? await db
            .select({ announcement: Announcement, creatorId: User.id, creatorName: User.name, creatorEmail: User.email })
            .from(Announcement)
            .leftJoin(User, eq(Announcement.createdBy, User.id))
            .where(eq(Announcement.status, status))
            .orderBy(desc(Announcement.publishedAt))
            .limit(limit)
        : await db
            .select({ announcement: Announcement, creatorId: User.id, creatorName: User.name, creatorEmail: User.email })
            .from(Announcement)
            .leftJoin(User, eq(Announcement.createdBy, User.id))
            .orderBy(desc(Announcement.publishedAt))
            .limit(limit);

    const response = rows.map((row) => {
      const creator = row.creatorId && row.creatorName && row.creatorEmail
        ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
        : null;
      return serializeAnnouncement(row.announcement, creator);
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/announcements", async (c) => {
    const access = await requireAnnouncementAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid announcement", 400);
    }

    const expiresAt = parseOptionalDate(parsed.data.expiresAt);
    if (parsed.data.expiresAt && expiresAt === undefined) {
      return failure(c, "Invalid expiration date", 400);
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const db = createDatabase(c.env.DB);
    await db.insert(Announcement).values({
      id,
      title: parsed.data.title,
      body: parsed.data.body,
      type: parsed.data.type,
      priority: parsed.data.priority,
      targetAudience: parsed.data.targetAudience,
      isPinned: parsed.data.isPinned,
      status: parsed.data.status,
      publishedAt: parsed.data.status === "PUBLISHED" ? now : null,
      expiresAt: expiresAt ?? null,
      createdBy: admin.id,
      updatedAt: now,
    });

    const announcement = await loadAnnouncement(c, id);
    if (!announcement) return failure(c, "Announcement not found", 404);

    if (parsed.data.status === "PUBLISHED") {
      await createAudienceNotifications(c, parsed.data);
    }

    await logAudit(c, {
      actorId: admin.id,
      action: "ANNOUNCEMENT_CREATE",
      entity: "Announcement",
      entityId: id,
      newValue: {
        title: parsed.data.title,
        status: parsed.data.status,
        targetAudience: parsed.data.targetAudience,
      },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof announcement.serialized>>(
      {
        success: true,
        data: announcement.serialized,
        requestId: c.get("requestId"),
      },
      201,
    );
  });

  app.patch("/api/announcements/:id", async (c) => {
    const access = await requireAnnouncementAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid announcement update", 400);
    }

    const id = c.req.param("id");
    const existing = await loadAnnouncement(c, id);
    if (!existing) return failure(c, "Announcement not found", 404);

    if (existing.raw.status === "PUBLISHED" && (parsed.data.title || parsed.data.body)) {
      return failure(
        c,
        "Published announcements cannot be edited. Archive this one and create a new announcement to issue a correction.",
        422,
      );
    }

    const expiresAt = parseOptionalDate(parsed.data.expiresAt);
    if (parsed.data.expiresAt && expiresAt === undefined) {
      return failure(c, "Invalid expiration date", 400);
    }

    const updates: Partial<typeof Announcement.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.body !== undefined) updates.body = parsed.data.body;
    if (parsed.data.type !== undefined) updates.type = parsed.data.type;
    if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
    if (parsed.data.targetAudience !== undefined) updates.targetAudience = parsed.data.targetAudience;
    if (parsed.data.isPinned !== undefined) updates.isPinned = parsed.data.isPinned;
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
      if (parsed.data.status === "PUBLISHED" && !existing.raw.publishedAt) {
        updates.publishedAt = new Date().toISOString();
      }
      if (parsed.data.status === "ARCHIVED") updates.isPinned = false;
    }
    if (parsed.data.expiresAt !== undefined) updates.expiresAt = expiresAt ?? null;

    const db = createDatabase(c.env.DB);
    await db.update(Announcement).set(updates).where(eq(Announcement.id, id));
    const updated = await loadAnnouncement(c, id);
    if (!updated) return failure(c, "Announcement not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: "ANNOUNCEMENT_UPDATE",
      entity: "Announcement",
      entityId: id,
      oldValue: existing.serialized,
      newValue: updated.serialized,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof updated.serialized>>({
      success: true,
      data: updated.serialized,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/announcements/:id", async (c) => {
    const access = await requireAnnouncementAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const existing = await loadAnnouncement(c, id);
    if (!existing) return failure(c, "Announcement not found", 404);

    const db = createDatabase(c.env.DB);
    await db
      .update(Announcement)
      .set({ status: "ARCHIVED", isPinned: false, updatedAt: new Date().toISOString() })
      .where(eq(Announcement.id, id));
    const updated = await loadAnnouncement(c, id);
    if (!updated) return failure(c, "Announcement not found", 404);

    await logAudit(c, {
      actorId: admin.id,
      action: "ANNOUNCEMENT_ARCHIVE",
      entity: "Announcement",
      entityId: id,
      oldValue: existing.serialized,
      newValue: updated.serialized,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ archived: true }>>({
      success: true,
      data: { archived: true },
      requestId: c.get("requestId"),
    });
  });
}
