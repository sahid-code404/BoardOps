import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { isLocked, isPreRegistration, isMealBeforeEnrollment } from "@/lib/meal-engine";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { evaluateRestrictions } from "@/lib/restriction-engine";
import { z } from "zod";

const toggleSchema = z.object({
  entryId: z.string(),
  status: z.enum(["ON", "OFF"]),
});

/**
 * PATCH /api/meals/toggle
 * Toggle a meal entry's status. Backend validates cutoff.
 * PRD: Residents with an active financial restriction (not exempted) cannot
 * turn meals ON. They can still turn meals OFF.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { entryId, status } = toggleSchema.parse(body);

    const entry = await db.mealEntry.findUnique({
      where: { id: entryId },
      include: { meal: true },
    });
    if (!entry) return err("Meal entry not found", 404);
    if (entry.userId !== user.id) return err("This meal entry does not belong to you", 403);

    // PRD: meals before enrollment are not editable by the resident — only an
    // admin can override them via /api/meals/override.
    // Uses the PRECISE check: on the registration day, if the meal's cutoff
    // has already passed, the meal is also "before enrollment".
    if (isMealBeforeEnrollment(entry.serviceDate, user.createdAt, entry.meal)) {
      return err(
        "This meal is before your enrollment or its cutoff has passed. Contact an administrator if a change is needed.",
        422
      );
    }

    // PRD: check financial restrictions — residents can't turn meals ON when restricted
    if (status === "ON") {
      const restrictionEval = await evaluateRestrictions(user.id);
      if (!restrictionEval.canBookMeals) {
        return err(
          `Meal booking is restricted. ${restrictionEval.restrictionReason || "Please contact the administrator."}`,
          403
        );
      }
    }

    if (entry.locked || isLocked(entry.editableUntil)) {
      if (entry.status === "LOCKED") return err("This meal is locked and cannot be changed", 422);
      // lock it now
      await db.mealEntry.update({
        where: { id: entryId },
        data: { locked: true, status: entry.status === "ON" ? "LOCKED" : entry.status },
      });
      return err("This meal's cutoff has passed. It is now locked.", 422);
    }

    const oldStatus = entry.status;
    if (oldStatus === status) return ok(entry);

    // When a USER toggles their own meal, update originalState to match the new status.
    // This means the user's choice becomes the new "baseline" — no override badge shows.
    // Only ADMIN overrides (via /api/meals/override) change status WITHOUT updating originalState,
    // so the comparison (status !== originalState) correctly detects admin overrides only.
    const updated = await db.mealEntry.update({
      where: { id: entryId },
      data: { status, originalState: status, updatedBy: user.id },
    });

    await db.mealHistory.create({
      data: {
        mealEntryId: entry.id,
        mealId: entry.mealId,
        oldStatus,
        newStatus: status,
        changedBy: user.id,
        triggerSource: "MANUAL",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "MEAL_TOGGLE",
      entity: "MealEntry",
      entityId: entry.id,
      oldValue: { status: oldStatus },
      newValue: { status },
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

const bulkSchema = z.object({
  entryIds: z.array(z.string()),
  status: z.enum(["ON", "OFF"]),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { entryIds, status } = bulkSchema.parse(body);

    // LB-3: bulk meal ON — apply the same financial-restriction check as the
    // single PATCH. The check is user-scoped (not per-entry), so we evaluate
    // it once before the loop and reuse the result for every entry. Users
    // can still bulk-toggle meals OFF when restricted — only ON is blocked.
    let restricted = false;
    if (status === "ON") {
      const restrictionEval = await evaluateRestrictions(user.id);
      restricted = !restrictionEval.canBookMeals;
    }

    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of entryIds) {
      const entry = await db.mealEntry.findUnique({ where: { id }, include: { meal: true } });
      if (!entry || entry.userId !== user.id) {
        results.push({ id, success: false, error: "Not found" });
        continue;
      }
      if (entry.locked || isLocked(entry.editableUntil)) {
        results.push({ id, success: false, error: "Locked" });
        continue;
      }
      // Before-enrollment meals cannot be toggled by the user (precise check)
      if (isMealBeforeEnrollment(entry.serviceDate, user.createdAt, entry.meal)) {
        results.push({ id, success: false, error: "Before enrollment" });
        continue;
      }
      // LB-3: restricted users cannot turn meals ON. OFF is always allowed.
      if (restricted && status === "ON") {
        results.push({ id, success: false, error: "Restricted" });
        continue;
      }
      await db.mealEntry.update({
        where: { id },
        data: { status, originalState: status, updatedBy: user.id },
      });
      await db.mealHistory.create({
        data: {
          mealEntryId: entry.id,
          mealId: entry.mealId,
          oldStatus: entry.status,
          newStatus: status,
          changedBy: user.id,
          triggerSource: "PRESET",
        },
      });
      results.push({ id, success: true });
    }
    return ok({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
