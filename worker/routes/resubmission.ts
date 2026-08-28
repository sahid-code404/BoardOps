import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import { getClientIp, getUserAgent } from "../auth/session";
import { createDatabase } from "../db/client";
import { Notification, RegistrationRequest, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type ResubmitErrorStatus = 400 | 404 | 409 | 422;

const resubmitSchema = z.object({
  email: z.string().email("Enter a valid email"),
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  institutionUserId: z.string().min(1, "Institution User ID is required").optional(),
  phone: z.string().min(8, "Enter a valid phone number").optional(),
  room: z.string().min(1, "Room number is required").optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: ResubmitErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

export function registerResubmissionRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/resubmit", async (c) => {
    const parsed = resubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid resubmission request", 400);
    }

    const data = parsed.data;
    const email = data.email.trim().toLowerCase();
    const db = createDatabase(c.env.DB);
    const [user] = await db.select().from(User).where(eq(User.email, email)).limit(1);

    if (!user) return failure(c, "User not found", 404);
    if (!user.changesRequested) {
      return failure(c, "No changes were requested for this account", 422);
    }

    if (data.institutionUserId && data.institutionUserId !== user.institutionUserId) {
      const [taken] = await db
        .select({ id: User.id })
        .from(User)
        .where(and(eq(User.institutionUserId, data.institutionUserId), ne(User.id, user.id)))
        .limit(1);
      if (taken) return failure(c, "This Institution User ID is already taken", 409);
    }

    if (data.phone && data.phone !== user.phone) {
      const [taken] = await db
        .select({ id: User.id })
        .from(User)
        .where(and(eq(User.phone, data.phone), ne(User.id, user.id)))
        .limit(1);
      if (taken) return failure(c, "This phone number is already registered", 409);
    }

    const now = new Date().toISOString();
    const updates: {
      name?: string;
      institutionUserId?: string;
      phone?: string;
      room?: string;
      gender?: string | null;
      changesRequested: null;
      changesRequestReason: null;
      changesRequestedAt: null;
      changesRequestedBy: null;
      status: string;
      updatedAt: string;
      rejectionReason?: null;
      deletedAt?: null;
      deletedBy?: null;
      deletionReason?: null;
    } = {
      changesRequested: null,
      changesRequestReason: null,
      changesRequestedAt: null,
      changesRequestedBy: null,
      status: "PENDING",
      updatedAt: now,
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.institutionUserId !== undefined) updates.institutionUserId = data.institutionUserId;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.room !== undefined) updates.room = data.room;
    if (data.gender !== undefined) updates.gender = data.gender;

    if (user.rejectionReason && user.status === "ARCHIVED") {
      updates.rejectionReason = null;
      updates.deletedAt = null;
      updates.deletedBy = null;
      updates.deletionReason = null;
    }

    await db.update(User).set(updates).where(eq(User.id, user.id));
    const [updated] = await db.select().from(User).where(eq(User.id, user.id)).limit(1);
    if (!updated) return failure(c, "User not found", 404);

    const [previous] = await db
      .select({ cycle: RegistrationRequest.cycle })
      .from(RegistrationRequest)
      .where(eq(RegistrationRequest.userId, user.id))
      .orderBy(desc(RegistrationRequest.cycle))
      .limit(1);
    const nextCycle = (previous?.cycle ?? 0) + 1;

    if (previous) {
      await db
        .update(RegistrationRequest)
        .set({ status: "RESUBMITTED" })
        .where(
          and(
            eq(RegistrationRequest.userId, user.id),
            eq(RegistrationRequest.cycle, previous.cycle),
          ),
        );
    }

    await db.insert(RegistrationRequest).values({
      id: crypto.randomUUID(),
      userId: user.id,
      cycle: nextCycle,
      status: "PENDING_REVIEW",
      fields: JSON.stringify({
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        room: updated.room,
        gender: updated.gender,
        institutionName: updated.institutionName,
        institutionUserId: updated.institutionUserId,
      }),
    });

    const admins = await db
      .select({ id: User.id })
      .from(User)
      .where(
        and(
          inArray(User.role, ["ADMIN", "SUPER_ADMIN"]),
          eq(User.status, "ACTIVE"),
          isNull(User.deletedAt),
        ),
      );

    await Promise.all(
      admins.map((admin) =>
        createNotification(c, {
          userId: admin.id,
          title: "New registration resubmitted",
          description: `${updated.name} resubmitted their registration for review.`,
          type: "INFO",
          priority: "HIGH",
          route: "users",
        }),
      ),
    );

    const changedFields = Object.keys(updates).filter(
      (key) =>
        ![
          "changesRequested",
          "changesRequestReason",
          "changesRequestedAt",
          "changesRequestedBy",
          "updatedAt",
        ].includes(key),
    );

    await logAudit(c, {
      actorId: user.id,
      action: "USER_RESUBMITTED",
      entity: "User",
      entityId: user.id,
      newValue: { cycle: nextCycle, changedFields },
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    const response = { userId: updated.id, status: "PENDING" as const, cycle: nextCycle };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
