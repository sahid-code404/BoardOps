import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { generateAdjustmentNumber } from "@/lib/reference-numbers";
import { z } from "zod";

const createSchema = z.object({
  userId: z.string().optional().nullable(),
  entityType: z.enum(["Payment", "Refund", "Bill", "Expense"]),
  entityId: z.string().min(1),
  amount: z.number(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
  notes: z.string().optional().nullable(),
});

// GET /api/adjustments — list adjustments (admin only)
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const limit = Number(url.searchParams.get("limit") || 50);

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    const adjustments = await db.adjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });
    return ok(adjustments);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/adjustments — create an adjustment entry (PRD DEC-033, AP-007)
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    // Generate the adjustment number
    const adjustmentNumber = await generateAdjustmentNumber();

    const adjustment = await db.adjustment.create({
      data: {
        adjustmentNumber,
        userId: data.userId ?? null,
        entityType: data.entityType,
        entityId: data.entityId,
        amount: data.amount,
        reason: data.reason,
        notes: data.notes ?? null,
        createdBy: admin.id,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    await logAudit({
      actorId: admin.id,
      action: "ADJUSTMENT_CREATE",
      entity: "Adjustment",
      entityId: adjustment.id,
      newValue: { adjustmentNumber, entityType: data.entityType, entityId: data.entityId, amount: data.amount, reason: data.reason },
      reason: data.reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(adjustment);
  } catch (e) {
    return handleApiError(e);
  }
}
