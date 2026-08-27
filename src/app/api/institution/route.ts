import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

/**
 * GET /api/institution — returns the institution profile (first record).
 * Available to all authenticated users (public info like name, logo, timezone).
 */
export async function GET() {
  try {
    let institution = await db.institution.findFirst();
    if (!institution) {
      // Auto-create a default institution if none exists
      institution = await db.institution.create({
        data: { name: "BoardOps Institute", type: "HOSTEL" },
      });
    }
    return ok(institution);
  } catch (e) {
    return handleApiError(e);
  }
}

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  type: z.enum(["HOSTEL", "PG", "COLLEGE", "COMPANY_ACCOMMODATION", "NGO", "TRAINING_INSTITUTE", "RESIDENTIAL_SCHOOL", "BOARDING_HOUSE", "UNIVERSITY"]).optional(),
  address: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  currency: z.string().default("INR"),
  timezone: z.string().default("UTC"),
  logoUrl: z.string().optional().nullable(),
});

/**
 * PUT /api/institution — update the institution profile (admin only).
 */
export async function PUT(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = updateSchema.parse(body);

    let institution = await db.institution.findFirst();
    if (!institution) {
      institution = await db.institution.create({ data: { name: "BoardOps Institute" } });
    }

    const updated = await db.institution.update({
      where: { id: institution.id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.timezone ? { timezone: data.timezone } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      },
    });

    await logAudit({
      actorId: admin.id,
      action: "INSTITUTION_UPDATE",
      entity: "Institution",
      entityId: updated.id,
      oldValue: institution,
      newValue: updated,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
