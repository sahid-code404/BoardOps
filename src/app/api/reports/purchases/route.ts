import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

/**
 * GET /api/reports/purchases?month=X&year=Y
 * Purchase report: top products by spend, top categories, vendor breakdown,
 * daily purchase totals.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const purchases = await db.purchase.findMany({
      where: { purchaseDate: { gte: start, lte: end }, deletedAt: null },
      include: { items: true },
    });

    // Top products by spend
    const productMap: Record<string, { name: string; quantity: number; spend: number; unit: string }> = {};
    for (const p of purchases) {
      for (const item of p.items) {
        const key = item.productName;
        if (!productMap[key]) {
          productMap[key] = { name: item.productName, quantity: 0, spend: 0, unit: item.unit };
        }
        productMap[key].quantity += item.quantity;
        productMap[key].spend += item.total;
      }
    }

    // Top categories
    const categoryMap: Record<string, number> = {};
    for (const p of purchases) {
      for (const item of p.items) {
        categoryMap[item.category] = (categoryMap[item.category] || 0) + item.total;
      }
    }

    // Vendor breakdown
    const vendorMap: Record<string, { count: number; total: number }> = {};
    for (const p of purchases) {
      if (!vendorMap[p.vendor]) vendorMap[p.vendor] = { count: 0, total: 0 };
      vendorMap[p.vendor].count++;
      vendorMap[p.vendor].total += p.totalAmount;
    }

    const totalSpend = purchases.reduce((s, p) => s + p.totalAmount, 0);

    return ok({
      period: { month, year },
      summary: {
        totalSpend,
        purchaseCount: purchases.length,
        itemCount: purchases.reduce((s, p) => s + p.items.length, 0),
        avgPurchaseValue: purchases.length > 0 ? totalSpend / purchases.length : 0,
      },
      topProducts: Object.values(productMap)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10),
      topCategories: Object.entries(categoryMap)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      vendorBreakdown: Object.entries(vendorMap)
        .map(([vendor, stats]) => ({ vendor, ...stats }))
        .sort((a, b) => b.total - a.total),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
