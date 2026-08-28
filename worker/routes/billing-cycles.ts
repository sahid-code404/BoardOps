import { desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { logAudit } from "../auth/audit";
import { databaseDateToIso, getAuthUser } from "../auth/session";
import { rollbackBillingCycle } from "../billing-cycle-rollback";
import { getBillingReadiness, normalizeBillingPeriod, periodLabel } from "../billing-cycle-engine";
import { createDatabase } from "../db/client";
import { BillingCycle, MonthlySnapshot } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import { executeClosing } from "../monthly-closing";
import { createNotification } from "../notifications";
import type { BoardOpsEnv } from "../types";

type BillingErrorStatus = 400 | 401 | 403 | 404;

function failure(c: Context<BoardOpsEnv>, error: string, status: BillingErrorStatus) {
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

function serializeCycle(record: typeof BillingCycle.$inferSelect) {
  return {
    ...record,
    startedAt: databaseDateToIso(record.startedAt),
    closedAt: databaseDateToIso(record.closedAt),
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

function serializeSnapshot(record: typeof MonthlySnapshot.$inferSelect) {
  return {
    ...record,
    createdAt: databaseDateToIso(record.createdAt),
  };
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

export function registerBillingCycleRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/billing-cycles", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const db = createDatabase(c.env.DB);
    const cycles = await db
      .select()
      .from(BillingCycle)
      .orderBy(desc(BillingCycle.periodYear), desc(BillingCycle.periodMonth))
      .limit(50);
    const response = cycles.map(serializeCycle);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.post("/api/billing-cycles", async (c) => {
    const access = await requireAdmin(c);
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
    const dueDate = body.dueDate ? new Date(body.dueDate) : undefined;
    const result = await executeClosing(c.env.DB, month, year, admin.id, dueDate, now);

    if (result.success) {
      for (const event of result.billEvents) {
        if (event.kind === "created") {
          await createNotification(c, {
            userId: event.userId,
            title: "Bill generated",
            description: `Your ${periodLabel(month, year)} bill of ₹${Math.round(event.totalAmount)} is now available. Due ${formatDueDate(event.dueDate)}.`,
            type: "INFO",
            priority: "HIGH",
            route: "billing",
          });
        } else {
          await createNotification(c, {
            userId: event.userId,
            title: "Bill updated",
            description: `Your ${periodLabel(month, year)} bill increased by ₹${Math.round(event.delta)} — new total ₹${Math.round(event.totalAmount)}.`,
            type: "WARNING",
            priority: "HIGH",
            route: "billing",
          });
        }
      }

      await logAudit(c, {
        actorId: admin.id,
        action: "MONTHLY_SETTLEMENT",
        entity: "BillingCycle",
        entityId: result.cycleId,
        newValue: {
          month,
          year,
          periodLabel: periodLabel(month, year),
          billsGenerated: result.summary.billsGenerated,
          refundsQueued: result.refundsQueued,
          refundQueueTotal: result.summary.refundQueueTotal,
          outstandingDue: result.summary.outstandingDue,
        },
      });
      await logAudit(c, {
        actorId: admin.id,
        action: "MONTHLY_CLOSING_COMPLETED",
        entity: "BillingCycle",
        entityId: result.cycleId,
        newValue: result,
      });

      return c.json<ApiSuccess<typeof result>>({
        success: true,
        data: result,
        requestId: c.get("requestId"),
      });
    }

    await logAudit(c, {
      actorId: admin.id,
      action: "MONTHLY_CLOSING_FAILED",
      entity: "BillingCycle",
      entityId: result.cycleId || null,
      newValue: { month, year, status: result.status, error: result.error },
      reason: result.error ?? null,
    });
    return c.json<ApiSuccess<typeof result>>(
      { success: true, data: result, requestId: c.get("requestId") },
      422,
    );
  });

  app.post("/api/billing-cycles/:id/rollback", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;
    const admin = access.user!;

    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim();
    if (!reason) return failure(c, "A reason is required for rollback", 400);

    const db = createDatabase(c.env.DB);
    const [existing] = await db
      .select()
      .from(BillingCycle)
      .where(eq(BillingCycle.id, id))
      .limit(1);
    if (!existing) return failure(c, "Billing cycle not found", 404);

    const result = await rollbackBillingCycle(c.env.DB, id);
    await logAudit(c, {
      actorId: admin.id,
      action: result.success ? "MONTHLY_CLOSING_ROLLBACK" : "MONTHLY_CLOSING_ROLLBACK_FAILED",
      entity: "BillingCycle",
      entityId: id,
      oldValue: serializeCycle(existing),
      newValue: result.success ? { status: "OPEN" } : { error: result.error },
      reason,
    });

    if (!result.success) return failure(c, result.error || "Rollback failed", 400);
    const response = { rolledBack: true };
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/billing-cycles/readiness", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const now = new Date();
    const month = Number(c.req.query("month") ?? now.getUTCMonth());
    const year = Number(c.req.query("year") ?? now.getUTCFullYear());
    if (!normalizeBillingPeriod(month, year)) {
      return failure(c, "Invalid month or year", 400);
    }

    const db = createDatabase(c.env.DB);
    const response = await getBillingReadiness(db, month, year, now);
    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.get("/api/billing-cycles/:id", async (c) => {
    const access = await requireAdmin(c);
    if (access.response) return access.response;

    const id = c.req.param("id");
    const db = createDatabase(c.env.DB);
    const [cycle] = await db
      .select()
      .from(BillingCycle)
      .where(eq(BillingCycle.id, id))
      .limit(1);
    if (!cycle) return failure(c, "Billing cycle not found", 404);

    const [snapshot] = await db
      .select()
      .from(MonthlySnapshot)
      .where(eq(MonthlySnapshot.billingCycleId, id))
      .limit(1);
    const response = {
      ...serializeCycle(cycle),
      snapshot: snapshot ? serializeSnapshot(snapshot) : null,
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
