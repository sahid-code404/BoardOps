import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { computeEditableUntil, isLocked, isOverridden } from "@/lib/meal-engine";
import { toLocalDateKey } from "@/lib/utils";
import { runBackgroundTasks } from "@/lib/task-runner";

// ── Counting helpers (same logic as kitchen route) ──
// Only count meals that are CONFIRMED:
//   - Locked (past cutoff — the user can no longer change it), OR
//   - Admin-overridden (the admin explicitly set the Current State)
// Unlocked meals that the user can still toggle are NOT counted.

/** Counts toward "on": status is ON/LOCKED AND (locked OR overridden) */
function countsAsOn(e: { status: string; originalState: string; locked: boolean; editableUntil: Date }): boolean {
  if (e.status !== "ON" && e.status !== "LOCKED") return false;
  const entryLocked = isLocked(e.editableUntil) || e.locked || e.status === "LOCKED";
  return entryLocked || isOverridden(e);
}

/** Counts toward "off": status is OFF AND locked AND NOT overridden */
function countsAsOff(e: { status: string; originalState: string; locked: boolean; editableUntil: Date }): boolean {
  if (e.status !== "OFF") return false;
  const entryLocked = isLocked(e.editableUntil) || e.locked;
  return entryLocked && !isOverridden(e);
}

export async function GET() {
  try {
    // MF-5: lightweight self-healing tasks on every dashboard load — flips
    // overdue bills, lifts expired restrictions, purges expired sessions.
    // Awaiting is fine (3 updateMany queries); errors are swallowed inside.
    await runBackgroundTasks();

    const user = await requireAuth();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const isAdmin = user.role === "ADMIN";

    // ── Today's meals for current user ──
    const meals = await db.mealConfiguration.findMany({
      where: { status: "ACTIVE" },
      orderBy: { displayOrder: "asc" },
    });
    const todaysEntries = await db.mealEntry.findMany({
      where: { userId: user.id, serviceDate: today },
    });
    const todayMeals = meals.map((m) => {
      const entry = todaysEntries.find((e) => e.mealId === m.id);
      return {
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        icon: m.icon,
        color: m.color,
        startTime: m.startTime,
        endTime: m.endTime,
        status: entry?.status ?? m.defaultState,
        locked: entry ? isLocked(entry.editableUntil) : isLocked(computeEditableUntil(m, today)),
        editableUntil: entry?.editableUntil.toISOString() ?? computeEditableUntil(m, today).toISOString(),
      };
    });

    // ── KPI counts ──
    // Total active users = residents + admins (both count as users of the system)
    const totalUsers = await db.user.count({ where: { status: "ACTIVE", deletedAt: null } });
    const pendingUsers = await db.user.count({ where: { status: "PENDING", deletedAt: null } });
    // Meal counts — only count CONFIRMED meals (locked or admin-overridden).
    // Exclude admin users (admins don't count as residents for meals).
    const todayEntries = await db.mealEntry.findMany({
      where: { serviceDate: today, user: { role: "USER" } },
      select: { status: true, originalState: true, locked: true, editableUntil: true },
    });
    const todayOnCount = todayEntries.filter(countsAsOn).length;
    const todayOffCount = todayEntries.filter(countsAsOff).length;

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const totalRevenue = await db.payment.aggregate({
      where: { status: "APPROVED", createdAt: { gte: startOfMonth, lte: endOfMonth }, user: { role: "USER" } },
      _sum: { amount: true },
    });
    const totalExpenses = await db.expense.aggregate({
      where: { status: "APPROVED", expenseDate: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    });
    const pendingBills = await db.bill.count({
      where: { status: { in: ["GENERATED", "PARTIALLY_PAID", "OVERDUE"] }, user: { role: "USER" } },
    });

    // PRD: Calculate current meal charge = (total expenses - guest revenue) / total resident meals
    // Only count CONFIRMED meals (locked or admin-overridden) — same as kitchen counting.
    // Fetch all entries for the month and filter in code (override is dynamic).
    const monthMealEntries = await db.mealEntry.findMany({
      where: {
        serviceDate: { gte: startOfMonth, lte: endOfMonth },
        user: { role: "USER" },
      },
      select: { status: true, originalState: true, locked: true, editableUntil: true },
    });
    const totalResidentMeals = monthMealEntries.filter(countsAsOn).length;
    const guestMeals = await db.guestMeal.findMany({
      where: { serviceDate: { gte: startOfMonth, lte: endOfMonth } },
      select: { guestCount: true },
    });
    const totalGuestMeals = guestMeals.reduce((s, g) => s + (g.guestCount || 1), 0);
    const guestChargeVar = await db.variable.findUnique({ where: { key: "guest_meal_rate" } });
    const guestRate = guestChargeVar ? parseFloat(guestChargeVar.value) || 0 : 0;
    const guestRevenue = totalGuestMeals * guestRate;
    const totalExpensesAmount = totalExpenses._sum.amount ?? 0;
    const currentMealCharge = totalResidentMeals > 0
      ? Math.max(0, (totalExpensesAmount - guestRevenue) / totalResidentMeals)
      : 0;

    // ── 7-day meal trend ── (only count confirmed/locked meals)
    const trend: { date: string; on: number; off: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayEntries = await db.mealEntry.findMany({
        where: { serviceDate: d, user: { role: "USER" } },
        select: { status: true, originalState: true, locked: true, editableUntil: true },
      });
      trend.push({
        date: toLocalDateKey(d),
        on: dayEntries.filter(countsAsOn).length,
        off: dayEntries.filter(countsAsOff).length,
      });
    }

    // ── Expense breakdown by category ──
    const expensesRaw = await db.expense.findMany({
      where: { status: "APPROVED", expenseDate: { gte: startOfMonth, lte: endOfMonth } },
      select: { category: true, amount: true },
    });
    const byCategory: Record<string, number> = {};
    expensesRaw.forEach((e) => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });

    // ── Unread notification count (for badge) ──
    const unreadNotifications = await db.notification.count({
      where: { userId: user.id, readAt: null },
    });

    // ── Recent audit log (admin only) ──
    let recentActivity: Awaited<ReturnType<typeof db.auditLog.findMany>> = [];
    if (isAdmin) {
      recentActivity = await db.auditLog.findMany({
        take: 6,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true, email: true } } },
      });
    }

    return ok({
      todayMeals,
      kpis: {
        totalUsers,
        pendingUsers,
        todayOnCount,
        todayOffCount,
        totalExpenses: totalExpensesAmount,
        pendingBills,
        currentMealCharge,
        totalResidentMeals,
      },
      trend,
      expenseBreakdown: Object.entries(byCategory).map(([category, amount]) => ({ category, amount })),
      unreadNotifications,
      recentActivity,
      isAdmin,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
