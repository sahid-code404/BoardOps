import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { isOverridden } from "@/lib/meal-engine";

/**
 * GET /api/reports/meals?month=X&year=Y
 * Meal report: per-meal booked/cancelled/guest/override counts, participation %,
 * holiday count, daily breakdown.
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const [meals, entries, guestMeals, overrides, holidays] = await Promise.all([
      db.mealConfiguration.findMany({ where: { status: "ACTIVE" } }),
      db.mealEntry.findMany({
        where: { serviceDate: { gte: start, lte: end }, user: { role: "USER" } },
        select: { status: true, mealId: true, originalState: true },
      }),
      db.guestMeal.findMany({
        where: { serviceDate: { gte: start, lte: end } },
        select: { mealId: true, guestCount: true },
      }),
      db.mealOverride.count({
        where: { createdAt: { gte: start, lte: end } },
      }),
      db.holiday.count({
        where: {
          status: "ACTIVE",
          mealsDisabled: true,
          startDate: { lte: end },
          endDate: { gte: start },
        },
      }),
    ]);

    const mealStats = meals.map((m) => {
      const mealEntries = entries.filter((e) => e.mealId === m.id);
      const on = mealEntries.filter((e) => e.status === "ON" || e.status === "LOCKED").length;
      const off = mealEntries.filter((e) => e.status === "OFF").length;
      const overridden = mealEntries.filter((e) => isOverridden(e)).length;
      const guests = guestMeals
        .filter((g) => g.mealId === m.id)
        .reduce((s, g) => s + g.guestCount, 0);
      const total = on + off;
      const participation = total > 0 ? Math.round((on / total) * 100) : 0;
      return {
        mealId: m.id,
        mealName: m.name,
        displayName: m.displayName,
        on, off, overridden, guests, total,
        participation,
      };
    });

    const totalMeals = entries.filter((e) => e.status === "ON" || e.status === "LOCKED").length;
    const totalGuests = guestMeals.reduce((s, g) => s + g.guestCount, 0);

    return ok({
      period: { month, year },
      summary: {
        totalMeals,
        totalGuests,
        totalOverrides: overrides,
        holidayCount: holidays,
        activeMealCount: meals.length,
      },
      perMeal: mealStats,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
