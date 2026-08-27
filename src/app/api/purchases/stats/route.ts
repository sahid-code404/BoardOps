import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    // Today's range
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [
      todayTotal,
      monthTotal,
      monthPurchases,
      topProductsRaw,
      topCategoriesRaw,
    ] = await Promise.all([
      // Today's purchases total
      db.purchase.aggregate({
        where: {
          deletedAt: null,
          purchaseDate: { gte: todayStart, lt: todayEnd },
        },
        _sum: { totalAmount: true },
      }),
      // This month's purchases total
      db.purchase.aggregate({
        where: {
          deletedAt: null,
          purchaseDate: { gte: start, lt: end },
        },
        _sum: { totalAmount: true },
      }),
      // This month's purchase count
      db.purchase.count({
        where: {
          deletedAt: null,
          purchaseDate: { gte: start, lt: end },
        },
      }),
      // Top products by spend this month
      db.purchaseItem.groupBy({
        by: ["productName"],
        where: {
          purchase: {
            deletedAt: null,
            purchaseDate: { gte: start, lt: end },
          },
        },
        _sum: { total: true, quantity: true },
        orderBy: { _sum: { total: "desc" } },
        take: 5,
      }),
      // Top categories by spend this month
      db.purchaseItem.groupBy({
        by: ["category"],
        where: {
          purchase: {
            deletedAt: null,
            purchaseDate: { gte: start, lt: end },
          },
        },
        _sum: { total: true },
        orderBy: { _sum: { total: "desc" } },
        take: 5,
      }),
    ]);

    return ok({
      todayTotal: todayTotal._sum.totalAmount ?? 0,
      monthTotal: monthTotal._sum.totalAmount ?? 0,
      monthCount: monthPurchases,
      topProducts: topProductsRaw.map((p) => ({
        name: p.productName,
        totalSpend: p._sum.total ?? 0,
        totalQuantity: p._sum.quantity ?? 0,
      })),
      topCategories: topCategoriesRaw.map((c) => ({
        category: c.category,
        totalSpend: c._sum.total ?? 0,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
