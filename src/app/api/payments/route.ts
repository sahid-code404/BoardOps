import { db } from "@/lib/db";
import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { purgeExpiredPayments } from "@/lib/user-cleanup";
import { z } from "zod";

export async function GET(req: Request) {
  try {
    // Purge payments whose 7-day grace period has expired
    await purgeExpiredPayments();

    const user = await requireAuth();
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";

    const where: Record<string, unknown> = {};
    if (!includeDeleted) {
      where.deletedAt = null;
    } else {
      where.deletedAt = { not: null };
    }
    if (user.role === "USER") {
      where.userId = user.id;
    }

    // Optional date filter (YYYY-MM-DD). Filters payments where createdAt falls
    // within that calendar day. When omitted, all payments are returned (back-compat).
    // Parse as local time (not UTC) to avoid timezone shifts.
    const date = url.searchParams.get("date");
    if (date) {
      const [y, m, d] = date.split("-").map(Number);
      const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
      const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    // Optional month/year filter — filters payments where createdAt falls within
    // that calendar month. Takes precedence over the single-day `date` filter.
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    if (month !== null && year) {
      const m = Number(month);
      const y = Number(year);
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    // Exclude payments made by admin users — admins are not residents
    where.user = { role: "USER" };

    const payments = await db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true, room: true, avatarUrl: true } } },
    });
    return ok(payments);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).default("CASH"),
  billId: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const data = createSchema.parse(body);

    const payment = await db.payment.create({
      data: {
        userId: user.id,
        billId: data.billId,
        amount: data.amount,
        method: data.method,
        reference: data.reference,
        notes: data.notes,
        status: "PENDING",
      },
    });

    // notify admins
    const admins = await db.user.findMany({
      where: { role: { in: ["ADMIN"] }, status: "ACTIVE" },
    });
    for (const a of admins) {
      await createNotification({
        userId: a.id,
        title: "New payment submitted",
        description: `${user.name} submitted a payment of ₹${data.amount} via ${data.method}.`,
        type: "INFO",
        priority: "NORMAL",
        route: "payments",
      });
    }

    await logAudit({
      actorId: user.id,
      action: "PAYMENT_SUBMITTED",
      entity: "Payment",
      entityId: payment.id,
      newValue: payment,
    });
    return ok(payment, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
