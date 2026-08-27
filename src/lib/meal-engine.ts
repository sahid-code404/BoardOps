import type { MealConfiguration } from "@prisma/client";

/**
 * Compute editable-until timestamp for a meal entry based on its configuration.
 * The frontend NEVER computes this — it always reads from backend.
 */
export function computeEditableUntil(
  meal: Pick<
    MealConfiguration,
    "cutoffStrategy" | "cutoffTime" | "cutoffOffsetMinutes"
  >,
  serviceDate: Date
): Date {
  const [hh, mm] = (meal.cutoffTime || "16:00").split(":").map(Number);
  const d = new Date(serviceDate);
  d.setHours(hh || 0, mm || 0, 0, 0);

  switch (meal.cutoffStrategy) {
    case "PREVIOUS_DAY":
      d.setDate(d.getDate() - 1);
      return d;
    case "CUSTOM_OFFSET":
      return new Date(d.getTime() - (meal.cutoffOffsetMinutes || 0) * 60 * 1000);
    case "SAME_DAY":
    default:
      return d;
  }
}

export function isLocked(editableUntil: Date, now = new Date()): boolean {
  return now.getTime() > editableUntil.getTime();
}

/**
 * Returns the registration date of a user, normalized to the START of that day
 * (00:00:00.000). Meal entries whose `serviceDate` falls BEFORE this date are
 * considered "pre-registration" — the user was not yet a resident.
 *
 * Uses date-only comparison (ignores time-of-day) so a user who registers at
 * 3 PM on June 15 is still eligible for meals on June 15 itself.
 */
export function getRegistrationDate(userCreatedAt: Date): Date {
  const d = new Date(userCreatedAt);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns TRUE if `serviceDate` is BEFORE the user's registration date.
 * Pre-registration meals:
 *   - are NOT auto-created (so they don't count in totals)
 *   - are NOT editable by the user (locked)
 *   - CAN be overridden by an admin (admin override creates them explicitly)
 *
 * Date-only comparison — time-of-day is ignored on both sides.
 * Use `isMealBeforeEnrollment` for the precise check that also considers the
 * meal's cutoff time on the registration day itself.
 */
export function isPreRegistration(serviceDate: Date, userCreatedAt: Date): boolean {
  const reg = getRegistrationDate(userCreatedAt);
  const svc = new Date(serviceDate);
  svc.setHours(0, 0, 0, 0);
  return svc.getTime() < reg.getTime();
}

/**
 * PRECISE before-enrollment check — considers the meal's cutoff time.
 *
 * Logic:
 *  1. If serviceDate is BEFORE the registration date → before enrollment (true)
 *  2. If serviceDate is AFTER the registration date → not before enrollment (false)
 *  3. If serviceDate is THE SAME as the registration date:
 *     - Compute the meal's cutoff datetime (e.g. morning meal cutoff = 7 AM)
 *     - If the user registered AFTER the cutoff → before enrollment (true)
 *       (the user missed the cutoff — the meal is already locked)
 *     - If the user registered BEFORE the cutoff → not before enrollment (false)
 *       (the user can still toggle this meal)
 *
 * Example:
 *   Morning meal cutoff = 7 AM on July 8
 *   User registers at 8 AM on July 8
 *   → userCreatedAt (8 AM) > cutoff (7 AM) → before enrollment = true
 *   (the user missed the morning meal cutoff)
 *
 *   Dinner cutoff = 4 PM on July 8
 *   User registers at 8 AM on July 8
 *   → userCreatedAt (8 AM) < cutoff (4 PM) → before enrollment = false
 *   (the user can still toggle dinner)
 */
export function isMealBeforeEnrollment(
  serviceDate: Date,
  userCreatedAt: Date,
  meal: Pick<MealConfiguration, "cutoffStrategy" | "cutoffTime" | "cutoffOffsetMinutes">
): boolean {
  const reg = getRegistrationDate(userCreatedAt);
  const svc = new Date(serviceDate);
  svc.setHours(0, 0, 0, 0);

  // Date is strictly before registration date → before enrollment
  if (svc.getTime() < reg.getTime()) return true;
  // Date is strictly after registration date → not before enrollment
  if (svc.getTime() > reg.getTime()) return false;

  // Same day as registration — check if the meal's cutoff has passed
  const cutoff = computeEditableUntil(meal, serviceDate);
  return userCreatedAt.getTime() > cutoff.getTime();
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatServiceDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Dynamic override check — `true` when the meal's Current State (status)
 * diverges from the user's Original State (originalState).
 *
 * Override status is NEVER stored in the database; it is always derived on
 * read using this formula. LOCKED is treated as ON because LOCKED is the
 * immutable variant of ON (a meal the user confirmed AND that has now
 * passed its cutoff — semantically still "on").
 *
 * Used by the dashboard + kitchen routes to decide whether to count a meal
 * toward "on"/"off" — admin-overridden meals are always counted (the admin
 * made an explicit choice), while unlocked meals the user can still toggle
 * are not.
 */
export function isOverridden(entry: {
  status: string;
  originalState: string;
}): boolean {
  const effective = entry.status === "LOCKED" ? "ON" : entry.status;
  return effective !== entry.originalState;
}
