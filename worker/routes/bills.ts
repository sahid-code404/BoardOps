import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type { Context, Hono } from "hono";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { generateBillsForPeriod } from "../bill-generation";
import { getBillingReadiness, normalizeBillingPeriod, periodLabel } from "../billing-cycle-engine";
import { createDatabase } from "../db/client";
import { Bill, User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type BillErrorStatus = 400 | 401 | 403 | 404 | 422;

const DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function failure(c: Context<BoardOpsEnv>, error: string, status: BillErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requireBillAdmin(c: Context<BoardOpsEnv>) {
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

async function purgeExpiredBills(c: Context<BoardOpsEnv>): Promise<void> {
  try {
    const db = createDatabase(c.env.DB);
    await db
      .delete(Bill)
      .where(and(isNotNull(Bill.deletedAt), lt(Bill.deletedAt, new Date().toISOString())));
  } catch (error) {
    console.error("Failed to purge expired bills", error);
  }
}

async function transitionOverdueBills(c: Context<BoardOpsEnv>): Promise<void> {
  try {
    const now = new Date().toISOString();
    const db = createDatabase(c.env.DB);
    await db
      .update(Bill)
      .set({ status: "OVERDUE", updatedAt: now })
      .where(
        and(
          isNull(Bill.deletedAt),
          inArray(Bill.status, ["GENERATED", "PARTIALLY_PAID"]),
          lt(Bill.dueDate, now),
        ),
      );
  } catch (error) {
    console.error("Failed to transition overdue bills", error);
  }
}

function parsePeriod(monthValue: string, yearValue: string): { month: number; year: number } | null {
  const month = Number(monthValue);
  const year = Number(yearValue);
  return normalizeBillingPeriod(month, year);
}

function formatDueDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function registerBillRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/bills", async (c) => {
    await purgeExpiredBills(c);
    await transitionOverdueBills(c);

    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const requestedLimit = Number(c.req.query("limit") ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, Math.trunc(requestedLimit)))
      : 200;
    const includeDeleted = c.req.query("includeDeleted") === "true";
    const conditions: SQL[] = [
      includeDeleted ? isNotNull(Bill.deletedAt) : isNull(Bill.deletedAt),
      eq(User.role, "USER"),
    ];

    if (user.role === "USER") conditions.push(eq(Bill.userId, user.id));

    const month = c.req.query("month");
    const year = c.req.query("year");
    if (month !== undefined && year) {
      const period = parsePeriod(month, year);
      if (!period) return failure(c, "Invalid month or year", 400);
      conditions.push(eq(Bill.periodMonth, period.month), eq(Bill.periodYear, period.year));
    }

    if (c.req.query("future") === "false") {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth();
      conditions.push(
        or(
          lt(Bill.periodYear, currentYear),
          and(eq(Bill.periodYear, currentYear), lte(Bill.periodMonth, currentMonth)),
        )!,
      );
    }

    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({
        bill: Bill,
        userName: User.name,
        userEmail: User.email,
        userRoom: User.room,
        userAvatarUrl: User.avatarUrl,
      })
      .from(Bill)
      .innerJoin(User, eq(Bill.userId, User.id))
      .where(and(...conditions))
      .orderBy(desc(Bill.createdAt))
      .limit(limit);

    const response = rows.map((row) => ({
      ...serializeBill(row.bill),
      user: {
        name: row.userName,
        email: row.userEmail,
        room: row.userRoom,
        avatarUrl: row.userAvatarUrl,
      },
    }));

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/bills", async (c) => {
    const access = await requireBillAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const body = (await c.req.json().catch(() => ({}))) as {
      month?: number | string;
      year?: number | string;
      dueDate?: string;
    };
    const now = new Date();
    const month = Number(body.month ?? now.getUTCMonth());
    const year = Number(body.year ?? now.getUTCFullYear());
    const period = normalizeBillingPeriod(month, year);
    if (!period) return failure(c, "Invalid month or year", 400);

    const db = createDatabase(c.env.DB);
    const readiness = await getBillingReadiness(db, period.month, period.year, now);
    if (!readiness.canClose) {
      const issues = readiness.items
        .filter((item) => item.status !== "ready")
        .map((item) => `${item.label}: ${item.detail}`);
      return failure(
        c,
        `Cannot generate bills for ${periodLabel(period.month, period.year)}. Resolve all issues first:\n${issues.join("\n")}`,
        422,
      );
    }

    const parsedDueDate = body.dueDate ? new Date(body.dueDate) : null;
    const dueDate = parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
      ? parsedDueDate
      : undefined;
    const result = await generateBillsForPeriod(c.env.DB, period.month, period.year, {
      dueDate,
      adminId: admin.id,
      now,
    });

    for (const event of result.events) {
      if (event.kind === "created") {
        await createNotification(c, {
          userId: event.userId,
          title: "Bill generated",
          description: `Your ${periodLabel(period.month, period.year)} bill of ₹${Math.round(event.totalAmount)} is now available. Due ${formatDueDate(event.dueDate)}.`,
          type: "INFO",
          priority: "HIGH",
          route: "billing",
        });
      } else {
        await createNotification(c, {
          userId: event.userId,
          title: "Bill updated",
          description: `Your ${periodLabel(period.month, period.year)} bill increased by ₹${Math.round(event.delta)} — new total ₹${Math.round(event.totalAmount)}.`,
          type: "WARNING",
          priority: "HIGH",
          route: "billing",
        });
      }
    }

    const generated = result.created + result.updated;
    await logAudit(c, {
      actorId: admin.id,
      action: "BILLS_GENERATED",
      entity: "Bill",
      newValue: {
        generated,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        month: period.month,
        year: period.year,
      },
    });

    const response = {
      generated,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      month: period.month,
      year: period.year,
    };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.delete("/api/bills", async (c) => {
    const access = await requireBillAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const monthValue = c.req.query("month");
    const yearValue = c.req.query("year");
    let period: { month: number; year: number } | null = null;
    if (monthValue !== undefined && yearValue) {
      period = parsePeriod(monthValue, yearValue);
      if (!period) return failure(c, "Invalid month or year", 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || null;
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const deletionDate = new Date(nowDate.getTime() + DELETE_GRACE_MS).toISOString();

    const parameters: Array<string | number | null> = [
      deletionDate,
      admin.id,
      reason,
      now,
    ];
    let where = `"deletedAt" IS NULL`;
    if (period) {
      parameters.push(period.month, period.year);
      where += ` AND "periodMonth" = ?5 AND "periodYear" = ?6`;
    }

    const result = await c.env.DB.prepare(`
      UPDATE "Bill"
      SET "deletedAt" = ?1,
          "deletedBy" = ?2,
          "status" = 'DELETED',
          "deletionReason" = ?3,
          "updatedAt" = ?4
      WHERE ${where}
    `).bind(...parameters).run();
    const deleted = result.meta.changes ?? 0;

    await logAudit(c, {
      actorId: admin.id,
      action: "BILLS_SOFT_DELETED_ALL",
      entity: "Bill",
      newValue: {
        scheduled: deleted,
        permanentDeletion: deletionDate,
        month: period?.month ?? null,
        year: period?.year ?? null,
        reason,
      },
      reason,
    });

    const response = { deleted, permanentDeletion: deletionDate };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
