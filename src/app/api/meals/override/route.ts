import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { computeEditableUntil, isPreRegistration, isMealBeforeEnrollment, isLocked } from "@/lib/meal-engine";
import { z } from "zod";

/**
 * Parse a "YYYY-MM-DD" date string as LOCAL time (not UTC).
 *
 * `new Date("2026-07-04")` parses as UTC midnight, which shifts the date in
 * timezones east of UTC (e.g. IST: July 4 00:00 UTC = July 4 05:30 IST —
 * technically still July 4, but `setHours()` on a UTC date produces wrong
 * results). This helper parses the string into a local-midnight Date so all
 * subsequent `setHours()`/`getHours()` calls use the browser/server timezone.
 */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const overrideSchema = z.object({
  mealId: z.string(),
  userId: z.string(),
  serviceDate: z.string().transform((s) => parseLocalDate(s)),
  action: z.enum(["TURN_ON", "TURN_OFF", "LOCK", "UNLOCK"]),
  reason: z.string().min(3, "Reason is required"),
});

/**
 * POST /api/meals/override
 *
 * Admin override — modifies ONLY the Current State (status) of a meal entry.
 * The Original State (originalState) is NEVER modified by admins; it always
 * reflects the user's own final selection.
 *
 * Override status is calculated dynamically (status !== originalState) — it is
 * NEVER stored in the database.
 *
 * Admins can ONLY override LOCKED meals (past cutoff). Unlocked meals can
 * still be changed by the user themselves.
 * Exception: if no entry exists yet (e.g. pre-reg date), admin can create one.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = overrideSchema.parse(body);

    const meal = await db.mealConfiguration.findUnique({ where: { id: data.mealId } });
    if (!meal) return err("Meal not found", 404);

    // Fetch the target user to determine if this is a pre-registration override.
    // Pre-reg meals ALWAYS default to OFF, regardless of the meal config's
    // defaultState. The user wasn't enrolled yet, so their "original selection"
    // is OFF (not enrolled = no meal).
    // LB-9: also verify the user is ACTIVE — overrides for INACTIVE/PENDING/
    // SUSPENDED/DELETED users are rejected. Selecting `status` lets us check
    // without an extra round-trip.
    const targetUser = await db.user.findUnique({
      where: { id: data.userId },
      select: { createdAt: true, status: true },
    });
    if (!targetUser || targetUser.status !== "ACTIVE") {
      return err("User not found or not active", 404);
    }
    const isPreReg = targetUser
      ? isMealBeforeEnrollment(data.serviceDate, targetUser.createdAt, meal)
      : false;

    const entry = await db.mealEntry.findFirst({
      where: { userId: data.userId, mealId: data.mealId, serviceDate: data.serviceDate },
    });

    // PERMISSION: Admins can ONLY override LOCKED meals (past cutoff).
    // Unlocked meals can still be changed by the user themselves before the
    // cutoff — the admin must wait until the meal is locked.
    // Exception: if no entry exists yet (e.g. pre-reg date), admin can create one.
    if (entry) {
      const mealLocked = entry.locked || entry.status === "LOCKED" || isLocked(entry.editableUntil);
      if (!mealLocked) {
        return err(
          "This meal is not locked yet. The user can still change it before the cutoff. Admin override is only available after the meal is locked.",
          422
        );
      }
    }

    // Determine the new Current State based on the action
    const newStatus =
      data.action === "TURN_ON"
        ? "ON"
        : data.action === "TURN_OFF"
          ? "OFF"
          : data.action === "LOCK"
            ? "LOCKED"
            : data.action === "UNLOCK"
              ? entry?.status === "LOCKED" ? "ON" : (entry?.status || "ON")
              : "ON";

    if (!entry) {
      // No existing entry — create one. The Original State is:
      //   - "OFF" for pre-registration dates (user wasn't enrolled — no meal)
      //   - meal.defaultState for normal dates (the user never made a selection)
      const editableUntil = computeEditableUntil(meal, data.serviceDate);
      const originalState = isPreReg ? "OFF" : (meal.defaultState === "ON" ? "ON" : "OFF");
      const newEntry = await db.mealEntry.create({
        data: {
          userId: data.userId,
          mealId: data.mealId,
          serviceDate: data.serviceDate,
          status: newStatus,
          originalState, // preserve original state (never modified by admin)
          editableUntil,
          locked: data.action === "LOCK",
          updatedBy: admin.id,
        },
      });
      await db.mealOverride.create({
        data: {
          mealId: data.mealId,
          userId: data.userId,
          serviceDate: data.serviceDate,
          action: data.action,
          reason: data.reason,
          adminId: admin.id,
        },
      });
      await createNotification({
        userId: data.userId,
        title: "Meal modified by Administrator",
        description: `${meal.displayName} on ${data.serviceDate.toDateString()} was changed (${data.action}). Reason: ${data.reason}`,
        type: "WARNING",
        priority: "HIGH",
        route: "meals",
      });
      await logAudit({
        actorId: admin.id,
        action: "MEAL_OVERRIDE",
        entity: "MealEntry",
        entityId: newEntry.id,
        newValue: { ...data, originalState, newStatus },
      });
      return ok(newEntry);
    }

    // Existing entry — update ONLY the Current State. Original State is preserved.
    const oldStatus = entry.status;
    const originalState = entry.originalState || (meal.defaultState === "ON" ? "ON" : "OFF");

    const updated = await db.mealEntry.update({
      where: { id: entry.id },
      data: {
        status: newStatus,
        originalState, // NEVER change — admin only modifies Current State
        locked: data.action === "LOCK" ? true : data.action === "UNLOCK" ? false : entry.locked,
        updatedBy: admin.id,
      },
    });

    await db.mealOverride.create({
      data: {
        mealId: data.mealId,
        userId: data.userId,
        serviceDate: data.serviceDate,
        action: data.action,
        reason: data.reason,
        adminId: admin.id,
      },
    });
    await db.mealHistory.create({
      data: {
        mealEntryId: entry.id,
        mealId: data.mealId,
        oldStatus,
        newStatus: updated.status,
        changedBy: admin.id,
        triggerSource: "OVERRIDE",
        reason: data.reason,
      },
    });
    await createNotification({
      userId: data.userId,
      title: "Meal modified by Administrator",
      description: `${meal.displayName} on ${data.serviceDate.toDateString()} was changed (${data.action}). Reason: ${data.reason}`,
      type: "WARNING",
      priority: "HIGH",
      route: "meals",
    });
    await logAudit({
      actorId: admin.id,
      action: "MEAL_OVERRIDE",
      entity: "MealEntry",
      entityId: entry.id,
      oldValue: { status: oldStatus, originalState },
      newValue: { status: updated.status, action: data.action, reason: data.reason },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
