import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { applyAdminRestriction, applyFinancialExemption } from "@/lib/restriction-engine";
import { z } from "zod";

// GET /api/restrictions — list all active restrictions (admin only)
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "ACTIVE";
    const type = url.searchParams.get("type");
    const limit = Number(url.searchParams.get("limit") || 100);

    const where: Record<string, unknown> = { status };
    if (type) where.type = type;

    const restrictions = await db.restriction.findMany({
      where,
      orderBy: { appliedAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
      },
    });
    return ok(restrictions);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(["FINANCIAL", "ADMINISTRATIVE"]),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
  isExemption: z.boolean().default(false), // if true + type=FINANCIAL, creates an exemption
  expiresAt: z.string().optional().nullable(), // ISO date string
});

// POST /api/restrictions — apply a restriction or exemption (admin only)
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;

    let restriction;
    if (data.isExemption && data.type === "FINANCIAL") {
      restriction = await applyFinancialExemption(data.userId, admin.id, data.reason, expiresAt);
    } else {
      restriction = await applyAdminRestriction(data.userId, admin.id, data.reason, expiresAt);
    }

    const populated = await db.restriction.findUnique({
      where: { id: restriction.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await logAudit({
      actorId: admin.id,
      action: data.isExemption ? "RESTRICTION_EXEMPTION" : "RESTRICTION_APPLY",
      entity: "Restriction",
      entityId: restriction.id,
      newValue: { type: data.type, reason: data.reason, userId: data.userId, isExemption: data.isExemption },
      reason: data.reason,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(populated, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
