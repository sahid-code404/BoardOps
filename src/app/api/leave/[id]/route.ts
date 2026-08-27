import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { createNotification } from "@/lib/notify";
import { z } from "zod";
import { computeEditableUntil } from "@/lib/meal-engine";

/**
 * PATCH /api/leave/[id]
 *   Admin approves or rejects a leave application.
 *
 * Body: { status: "APPROVED" | "REJECTED", adminNotes?: string }
 *
 * When APPROVED:
 *   - Auto-set meal entries to OFF for the leave period
 *   - For ALL: every active meal is set OFF for each day in [startDate, endDate]
 *   - For SPECIFIC: only the meals in mealIds are set OFF for each day
 *   - Notify the user
 */

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNotes: z.string().max(500).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole("ADMIN", "SUPER_ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = patchSchema.parse(body);

    const application = await db.leaveApplication.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!application) return err("Leave application not found", 404);
    if (application.status !== "PENDING") {
      return err(`Application already ${application.status.toLowerCase()}`, 409);
    }

    // Update the application
    const updated = await db.leaveApplication.update({
      where: { id },
      data: {
        status: data.status,
        approvedBy: admin.id,
        adminNotes: data.adminNotes,
      },
      include: {
        user: { select: { id: true, name: true, email: true, room: true, avatarUrl: true } },
      },
    });

    // If approved, auto-set meal entries to OFF for the leave period
    if (data.status === "APPROVED") {
      const targetMealIds: string[] =
        application.mealType === "SPECIFIC"
          ? (() => {
              try {
                const parsed = JSON.parse(application.mealIds || "[]");
                return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
              } catch {
                return [];
              }
            })()
          : [];

      const meals = await db.mealConfiguration.findMany({
        where: {
          status: "ACTIVE",
          ...(application.mealType === "SPECIFIC" ? { id: { in: targetMealIds } } : {}),
        },
      });

      // Build the list of dates in [startDate, endDate]
      const start = new Date(application.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(application.endDate);
      end.setHours(0, 0, 0, 0);

      const dates: Date[] = [];
      const cursor = new Date(start);
      while (cursor.getTime() <= end.getTime()) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      // For each (meal, date), upsert a meal entry with status=OFF, originalState=OFF, locked=true
      for (const meal of meals) {
        for (const d of dates) {
          const editableUntil = computeEditableUntil(meal, d);
          // Follow the existing pattern (see /api/meals/override) — use findFirst
          // then update/create. The compound unique key on (userId, mealId,
          // serviceDate) makes this race-safe enough for the leave workflow.
          const existing = await db.mealEntry.findFirst({
            where: {
              userId: application.userId,
              mealId: meal.id,
              serviceDate: d,
            },
          });
          try {
            if (existing) {
              await db.mealEntry.update({
                where: { id: existing.id },
                data: {
                  status: "OFF",
                  originalState: "OFF",
                  locked: true,
                  updatedBy: admin.id,
                  notes: `Leave application ${application.id} approved`,
                },
              });
            } else {
              await db.mealEntry.create({
                data: {
                  userId: application.userId,
                  mealId: meal.id,
                  serviceDate: d,
                  status: "OFF",
                  originalState: "OFF",
                  editableUntil,
                  locked: true,
                  updatedBy: admin.id,
                  notes: `Leave application ${application.id} approved`,
                },
              });
            }
          } catch {
            // ignore individual upsert failures (e.g. race conditions)
          }
        }
      }
    }

    // Notify the user
    await createNotification({
      userId: application.userId,
      title: `Leave ${data.status.toLowerCase()}`,
      description:
        data.status === "APPROVED"
          ? `Your leave application from ${application.startDate.toISOString().slice(0, 10)} to ${application.endDate.toISOString().slice(0, 10)} has been approved.`
          : `Your leave application has been rejected.`,
      type: data.status === "APPROVED" ? "SUCCESS" : "WARNING",
      priority: "NORMAL",
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
