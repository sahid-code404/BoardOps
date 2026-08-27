import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getClientIp, getUserAgent } from "@/lib/session";
import { generateRefundNumber, generateBillNumber } from "@/lib/reference-numbers";
import { z } from "zod";

// GET /api/refunds — list refunds (admin sees all; user sees own)
export async function GET(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const userId = url.searchParams.get("userId");
    const limit = Number(url.searchParams.get("limit") || 100);

    const where: Record<string, unknown> = {};
    if (user.role === "USER") where.userId = user.id;
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const refunds = await db.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
        bill: { select: { id: true, billNumber: true, periodMonth: true, periodYear: true } },
        transactions: { orderBy: { createdAt: "desc" } },
      },
    });
    return ok(refunds);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  userId: z.string().min(1, "User is required"),
  billId: z.string().optional().nullable(),
  billingCycleId: z.string().optional().nullable(),
  amount: z.number().positive("Refund amount must be positive"),
  method: z.enum(["UPI", "CASH", "BANK_TRANSFER", "CHEQUE"]).optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// POST /api/refunds — create a new refund (admin only)
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const refundNumber = await generateRefundNumber();

    const refund = await db.refund.create({
      data: {
        refundNumber,
        userId: data.userId,
        billId: data.billId ?? null,
        billingCycleId: data.billingCycleId ?? null,
        amount: data.amount,
        paidAmount: 0,
        remainingAmount: data.amount,
        status: "PENDING",
        method: data.method ?? null,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        processedBy: admin.id,
        processedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await logAudit({
      actorId: admin.id,
      action: "REFUND_CREATE",
      entity: "Refund",
      entityId: refund.id,
      newValue: { refundNumber, amount: data.amount, userId: data.userId, billId: data.billId },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    await createNotification({
      userId: data.userId,
      title: "Refund initiated",
      description: `Your refund of ₹${Math.round(data.amount).toLocaleString("en-IN")} (${refundNumber}) has been initiated and is pending processing.`,
      type: "INFO",
      priority: "HIGH",
      route: "payments",
    });

    return ok(refund);
  } catch (e) {
    return handleApiError(e);
  }
}
