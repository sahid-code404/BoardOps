import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().min(8, "Invalid phone number").optional(),
  room: z.string().max(20).optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  emergencyContact: z.string().max(30).optional().nullable(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
});

export async function PUT(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const data = updateSchema.parse(body);

    // Check email/phone uniqueness if being updated
    if (data.phone) {
      const existing = await db.user.findFirst({
        where: { phone: data.phone, NOT: { id: user.id } },
      });
      if (existing) return err("This phone number is already in use", 409);
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone && { phone: data.phone }),
        ...(data.room !== undefined && { room: data.room }),
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.emergencyContact !== undefined && { emergencyContact: data.emergencyContact }),
        ...(data.theme && { theme: data.theme }),
        ...(data.language && { language: data.language }),
        ...(data.timezone && { timezone: data.timezone }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatarUrl: true,
        room: true,
        gender: true,
        emergencyContact: true,
        theme: true,
        language: true,
        timezone: true,
        twoFactorEnabled: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "PROFILE_UPDATE",
      entity: "User",
      entityId: user.id,
      oldValue: { name: user.name, phone: user.phone, room: user.room },
      newValue: data,
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
