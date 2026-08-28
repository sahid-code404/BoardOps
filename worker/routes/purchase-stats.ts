import type { Context, Hono } from "hono";

import { getAuthUser } from "../auth/session";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type PurchaseStatsErrorStatus = 400 | 401 | 403;

function failure(
  c: Context<BoardOpsEnv>,
  error: string,
  status: PurchaseStatsErrorStatus,
) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

async function requirePurchaseAdmin(c: Context<BoardOpsEnv>) {
  const user = await getAuthUser(c);
  if (!user || user.status !== "ACTIVE") {
    return { user: null, response: failure(c, "Not authenticated", 401) } as const;
  }
  if (user.role !== "ADMIN") {
    return { user: null, response: failure(c, "Forbidden", 403) } as const;
  }
  return { user, response: null } as const;
}

function parsePeriod(monthValue: string | undefined, yearValue: string | undefined, now: Date) {
  const month = Number(monthValue ?? now.getUTCMonth() + 1);
  const year = Number(yearValue ?? now.getUTCFullYear());
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  return { month, year };
}

export function registerPurchaseStatsRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/purchases/stats", async (c) => {
    const access = await requirePurchaseAdmin(c);
    if (access.response) return access.response;

    const now = new Date();
    const period = parsePeriod(c.req.query("month"), c.req.query("year"), now);
    if (!period) return failure(c, "Invalid month or year", 400);

    const monthStart = new Date(Date.UTC(period.year, period.month - 1, 1)).toISOString();
    const monthEnd = new Date(Date.UTC(period.year, period.month, 1)).toISOString();
    const todayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )).toISOString();
    const todayEnd = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    )).toISOString();

    const [today, month, topProductsResult, topCategoriesResult] = await Promise.all([
      c.env.DB.prepare(`
        SELECT COALESCE(SUM("totalAmount"), 0) AS total
        FROM "Purchase"
        WHERE "deletedAt" IS NULL
          AND "purchaseDate" >= ?1
          AND "purchaseDate" < ?2
      `).bind(todayStart, todayEnd).first<{ total: number }>(),
      c.env.DB.prepare(`
        SELECT COALESCE(SUM("totalAmount"), 0) AS total, COUNT(*) AS count
        FROM "Purchase"
        WHERE "deletedAt" IS NULL
          AND "purchaseDate" >= ?1
          AND "purchaseDate" < ?2
      `).bind(monthStart, monthEnd).first<{ total: number; count: number }>(),
      c.env.DB.prepare(`
        SELECT
          pi."productName" AS name,
          COALESCE(SUM(pi."total"), 0) AS totalSpend,
          COALESCE(SUM(pi."quantity"), 0) AS totalQuantity
        FROM "PurchaseItem" pi
        INNER JOIN "Purchase" p ON p."id" = pi."purchaseId"
        WHERE p."deletedAt" IS NULL
          AND p."purchaseDate" >= ?1
          AND p."purchaseDate" < ?2
        GROUP BY pi."productName"
        ORDER BY totalSpend DESC
        LIMIT 5
      `).bind(monthStart, monthEnd).all<{
        name: string;
        totalSpend: number;
        totalQuantity: number;
      }>(),
      c.env.DB.prepare(`
        SELECT
          pi."category" AS category,
          COALESCE(SUM(pi."total"), 0) AS totalSpend
        FROM "PurchaseItem" pi
        INNER JOIN "Purchase" p ON p."id" = pi."purchaseId"
        WHERE p."deletedAt" IS NULL
          AND p."purchaseDate" >= ?1
          AND p."purchaseDate" < ?2
        GROUP BY pi."category"
        ORDER BY totalSpend DESC
        LIMIT 5
      `).bind(monthStart, monthEnd).all<{
        category: string;
        totalSpend: number;
      }>(),
    ]);

    const response = {
      todayTotal: Number(today?.total ?? 0),
      monthTotal: Number(month?.total ?? 0),
      monthCount: Number(month?.count ?? 0),
      topProducts: topProductsResult.results.map((row) => ({
        name: row.name,
        totalSpend: Number(row.totalSpend ?? 0),
        totalQuantity: Number(row.totalQuantity ?? 0),
      })),
      topCategories: topCategoriesResult.results.map((row) => ({
        category: row.category,
        totalSpend: Number(row.totalSpend ?? 0),
      })),
    };

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
