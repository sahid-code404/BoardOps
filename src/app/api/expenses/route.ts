import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { purgeExpiredExpenses } from "@/lib/user-cleanup";
import { z } from "zod";

/** GET /api/expenses — list expenses (admins see all; USER sees their own APPROVED ones).
 *  Optional `category`, `month`/`year` query params filter the list.
 *  Optional `includeDeleted=true` shows soft-deleted expenses (deletion queue).
 *  Soft-deleted expenses (in 7-day queue) are excluded by default. */
export async function GET(req: Request) {
  try {
    // Purge expenses whose 7-day grace period has expired
    await purgeExpiredExpenses();

    const user = await requireAuth();
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 200);
    const category = url.searchParams.get("category");
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";

    const where: Record<string, unknown> = {};
    if (!includeDeleted) {
      where.deletedAt = null;
    } else {
      where.deletedAt = { not: null };
    }
    if (category) where.category = category;
    if (user.role === "USER") where.status = "APPROVED";
    if (month !== null && month !== undefined && year) {
      const m = Number(month);
      const y = Number(year);
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      where.expenseDate = { gte: start, lte: end };
    }

    const expenses = await db.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      take: limit,
      include: { user: { select: { name: true } } },
    });
    return ok(expenses);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  title: z.string().min(2, "Item name is required"),
  category: z.string().min(2, "Category is required").default("GENERAL"),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1, "Unit is required").default("piece"),
  amount: z.number().positive("Cost must be positive"),
  description: z.string().optional(),
  expenseDate: z.string().transform((s) => new Date(s)),
  paidTo: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    // Check if the expense month is locked (bills generated)
    const expDate = data.expenseDate;
    const now = new Date();
    const isCurrentOrFutureMonth =
      expDate.getMonth() >= now.getMonth() && expDate.getFullYear() >= now.getFullYear();

    const expense = await db.expense.create({
      data: {
        title: data.title,
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        amount: data.amount,
        description: data.description || null,
        expenseDate: data.expenseDate,
        paidTo: data.paidTo || null,
        status: "APPROVED",
        createdBy: user.id,
        currency: (await db.institution.findFirst())?.currency || "INR",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "CREATE",
      entity: "Expense",
      entityId: expense.id,
      newValue: expense,
    });
    return ok(expense, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
