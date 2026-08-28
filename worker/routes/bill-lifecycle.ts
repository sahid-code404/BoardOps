import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { createDatabase } from "../db/client";
import { Bill, Payment, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type BillLifecycleErrorStatus = 401 | 403 | 404 | 422;

const DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function failure(c: Context<BoardOpsEnv>, error: string, status: BillLifecycleErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function serializeBill(record: typeof Bill.$inferSelect) {
  return {
    id: record.id,
    billNumber: record.billNumber,
    userId: record.userId,
    periodMonth: record.periodMonth,
    periodYear: record.periodYear,
    mealCharges: record.mealCharges,
    otherCharges: record.otherCharges,
    adjustments: record.adjustments,
    totalAmount: record.totalAmount,
    paidAmount: record.paidAmount,
    dueAmount: record.dueAmount,
    previousDue: record.previousDue,
    status: record.status,
    generatedAt: databaseDateToIso(record.generatedAt),
    dueDate: databaseDateToIso(record.dueDate),
    snapshot: record.snapshot,
    billingCycleId: record.billingCycleId,
    formulaKey: record.formulaKey,
    formulaVersion: record.formulaVersion,
    formulaExpression: record.formulaExpression,
    deletedAt: databaseDateToIso(record.deletedAt),
    deletedBy: record.deletedBy,
    deletionReason: record.deletionReason,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializePayment(record: typeof Payment.$inferSelect) {
  return {
    id: record.id,
    userId: record.userId,
    billId: record.billId,
    amount: record.amount,
    method: record.method,
    status: record.status,
    reference: record.reference,
    notes: record.notes,
    approvedBy: record.approvedBy,
    effectiveMonth: record.effectiveMonth,
    effectiveYear: record.effectiveYear,
    deletedAt: databaseDateToIso(record.deletedAt),
    deletedBy: record.deletedBy,
    deletionReason: record.deletionReason,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

export function registerBillLifecycleRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/bills/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [row] = await db
      .select({
        bill: Bill,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
      })
      .from(Bill)
      .innerJoin(User, eq(Bill.userId, User.id))
      .where(eq(Bill.id, id))
      .limit(1);
    if (!row) return failure(c, "Bill not found", 404);

    const payments = await db
      .select()
      .from(Payment)
      .where(eq(Payment.billId, id));
    const response = {
      ...serializeBill(row.bill),
      user: {
        name: row.userName,
        email: row.userEmail,
        room: row.userRoom,
      },
      payments: payments.map(serializePayment),
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/bills/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Bill).where(eq(Bill.id, id)).limit(1);
    if (!existing) return failure(c, "Bill not found", 404);
    if (existing.deletedAt) return failure(c, "Bill is already scheduled for deletion", 422);

    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || null;
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const deletionDate = new Date(nowDate.getTime() + DELETE_GRACE_MS).toISOString();

    await db
      .update(Bill)
      .set({
        deletedAt: deletionDate,
        deletedBy: admin.id,
        status: "DELETED",
        deletionReason: reason,
        updatedAt: now,
      })
      .where(eq(Bill.id, id));

    await logAudit(c, {
      actorId: admin.id,
      action: "BILL_SOFT_DELETE",
      entity: "Bill",
      entityId: id,
      oldValue: serializeBill(existing),
      newValue: { deletedAt: deletionDate, status: "DELETED", reason },
      reason,
    });

    const response = { success: true, permanentDeletion: deletionDate };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/bills/:id/restore", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [existing] = await db.select().from(Bill).where(eq(Bill.id, id)).limit(1);
    if (!existing) return failure(c, "Bill not found", 404);
    if (!existing.deletedAt) return failure(c, "This bill is not in the deletion queue", 422);

    const now = new Date().toISOString();
    await db
      .update(Bill)
      .set({
        deletedAt: null,
        deletedBy: null,
        status: "GENERATED",
        updatedAt: now,
      })
      .where(eq(Bill.id, id));

    const [row] = await db
      .select({
        bill: Bill,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
        userAvatarUrl: User.avatarUrl,
      })
      .from(Bill)
      .innerJoin(User, eq(Bill.userId, User.id))
      .where(eq(Bill.id, id))
      .limit(1);
    if (!row) throw new Error("Restored bill could not be reloaded");

    await logAudit(c, {
      actorId: admin.id,
      action: "BILL_RESTORE",
      entity: "Bill",
      entityId: id,
      oldValue: { status: "DELETED", deletedAt: databaseDateToIso(existing.deletedAt) },
      newValue: { status: "GENERATED" },
    });

    const response = {
      ...serializeBill(row.bill),
      user: {
        name: row.userName,
        email: row.userEmail,
        room: row.userRoom,
        avatarUrl: row.userAvatarUrl,
      },
    };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
