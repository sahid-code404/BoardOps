import { desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { databaseDateToIso, getAuthUser } from "../auth/session";
import { getBillingReadiness, normalizeBillingPeriod } from "../billing-cycle-engine";
import { createDatabase } from "../db/client";
import { BillingCycle, MonthlySnapshot } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
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
