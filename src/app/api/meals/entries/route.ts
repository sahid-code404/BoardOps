import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { computeEditableUntil, isLocked, isPreRegistration, isMealBeforeEnrollment, getRegistrationDate, isOverridden } from "@/lib/meal-engine";
import { toLocalDateKey } from "@/lib/utils";
import type { MealConfiguration } from "@prisma/client";

/**
 * GET /api/meals/entries?year=&month=&date=
 * Returns meal entries for the current user for the given month (or specific date).
 * Auto-generates missing entries based on active meal configs (Service Date Engine).
 *
 * Pre-registration handling:
 *  - Does NOT auto-create entries for dates before the user's registration date.
 *  - Self-heals OLD auto-created pre-reg entries (updatedBy=null) to OFF + locked.
 *  - Admin-created pre-reg entries (updatedBy set) are preserved.
 *  - Pre-reg entries with no active override (overridden=false) are hidden from the response.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    const month = Number(url.searchParams.get("month") || new Date().getMonth());
    const specificDate = url.searchParams.get("date");

    const meals = await db.mealConfiguration.findMany({
      where: { status: "ACTIVE" },
      orderBy: { displayOrder: "asc" },
    });

    // Parse "YYYY-MM-DD" as local time (not UTC) to avoid timezone shifts.
    // `new Date("2026-07-04")` parses as UTC midnight; in IST that's July 3 18:30.
    const start = specificDate
      ? (() => {
          const [y, m, d] = specificDate.split("-").map(Number);
          return new Date(y, (m || 1) - 1, d || 1);
        })()
      : new Date(year, month, 1);
    const end = specificDate
      ? new Date(start)
      : new Date(year, month + 1, 0);

    if (specificDate) {
      end.setHours(23, 59, 59, 999);
    } else {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    const entries = await db.mealEntry.findMany({
      where: {
        userId: user.id,
        serviceDate: { gte: start, lte: end },
      },
    });

    // MF-4: fetch active holidays that disable meals and overlap the requested
    // date range. Meal entries are NOT auto-created on these dates — the
    // kitchen is closed. Admin overrides can still create them explicitly via
    // /api/meals/override.
    const activeMealHolidays = await db.holiday.findMany({
      where: {
        status: "ACTIVE",
        mealsDisabled: true,
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { startDate: true, endDate: true },
    });
    // Normalize each holiday to [start-of-day, end-of-day] for date-only compares
    const holidayRanges = activeMealHolidays.map((h) => {
      const s = new Date(h.startDate); s.setHours(0, 0, 0, 0);
      const e = new Date(h.endDate); e.setHours(23, 59, 59, 999);
      return { start: s.getTime(), end: e.getTime() };
    });
    const isHolidayDisabled = (date: Date): boolean => {
      const t = date.getTime();
      return holidayRanges.some((r) => t >= r.start && t <= r.end);
    };

    const map = new Map<string, typeof entries[number]>();
    entries.forEach((e) => map.set(`${e.mealId}_${e.serviceDate.toDateString()}`, e));

    const registrationDate = getRegistrationDate(user.createdAt);

    // Build a meal lookup map for precise before-enrollment checks
    const mealMap = new Map(meals.map((m) => [m.id, m]));

    // ── Self-healing: normalize OLD auto-created pre-reg entries ──
    // These have updatedBy=null (created by the buggy auto-create loop before
    // the fix). Set BOTH status AND originalState to "OFF" so the dynamic
    // override calculation (overridden = status !== originalState) returns
    // false — no override badge. Admin-created entries (updatedBy set) are
    // preserved.
    //
    // Uses the PRECISE check: on the registration day itself, if the meal's
    // cutoff has already passed when the user registered, the meal is also
    // treated as "before enrollment" (the user missed the cutoff).
    for (const entry of entries) {
      const mealConfig = mealMap.get(entry.mealId);
      const isBeforeEnrollment = mealConfig
        ? isMealBeforeEnrollment(entry.serviceDate, user.createdAt, mealConfig)
        : isPreRegistration(entry.serviceDate, user.createdAt);
      if (isBeforeEnrollment && !entry.updatedBy) {
        if (entry.status === "ON" || entry.status === "LOCKED" || !entry.locked || entry.originalState !== "OFF") {
          const updated = await db.mealEntry.update({
            where: { id: entry.id },
            data: { status: "OFF", originalState: "OFF", locked: true },
          });
          map.set(`${entry.mealId}_${entry.serviceDate.toDateString()}`, updated);
        }
      }
    }

    // ── Sync lock status + ensure entries exist (only for dates ON/AFTER registration) ──
    for (const meal of meals) {
      const days = specificDate ? 1 : end.getDate();
      for (let day = 1; day <= days; day++) {
        const d = specificDate ? new Date(start) : new Date(year, month, day);
        d.setHours(0, 0, 0, 0);

        // Skip auto-creating entries for meals before enrollment.
        // Uses the PRECISE check: on the registration day, if the meal's cutoff
        // has already passed, don't create an entry (the user missed it).
        // Admin overrides can still create these explicitly via /api/meals/override.
        if (isMealBeforeEnrollment(d, user.createdAt, meal)) continue;

        // MF-4: skip auto-creating entries on holidays where meals are disabled.
        // The kitchen is closed — no meal is served. Admin overrides can still
        // create these explicitly via /api/meals/override.
        if (isHolidayDisabled(d)) continue;

        const key = `${meal.id}_${d.toDateString()}`;
        let entry = map.get(key);
        if (!entry) {
          const editableUntil = computeEditableUntil(meal, d);
          const locked = isLocked(editableUntil);
          try {
            entry = await db.mealEntry.create({
              data: {
                userId: user.id,
                mealId: meal.id,
                serviceDate: d,
                status: meal.defaultState,
                originalState: meal.defaultState,
                editableUntil,
                locked,
              },
            });
            map.set(key, entry);
          } catch {
            // race-safe: another concurrent create likely succeeded
            const found = await db.mealEntry.findFirst({
              where: { userId: user.id, mealId: meal.id, serviceDate: d },
            });
            if (found) {
              map.set(key, found);
              entry = found;
            }
          }
        } else {
          // refresh lock state in DB if needed
          const locked = isLocked(entry.editableUntil);
          if (entry.locked !== locked || (entry.status === "ON" && locked)) {
            const updated = await db.mealEntry.update({
              where: { id: entry.id },
              data: {
                locked,
                status: locked && entry.status === "ON" ? "LOCKED" : entry.status === "LOCKED" && !locked ? "ON" : entry.status,
              },
            });
            map.set(key, updated);
          }
        }
      }
    }

    // ── Shape the response grouped by date ──
    // Override is calculated DYNAMICALLY: overridden = (effectiveStatus !== originalState)
    // where effectiveStatus treats LOCKED as ON. No overrideFlag stored in DB.
    // Pre-reg entries with no active override (overridden=false) are hidden.
    const byDate: Record<string, Array<{
      id: string;
      mealId: string;
      mealName: string;
      mealDisplayName: string;
      mealIcon: string;
      mealColor: string;
      serviceDate: string;
      status: string;
      originalState: string;
      overridden: boolean;
      editableUntil: string;
      locked: boolean;
      preRegistration: boolean;
      startTime: string;
      endTime: string;
      mealType: string;
    }>> = {};

    for (const meal of meals) {
      const days = specificDate ? 1 : end.getDate();
      for (let day = 1; day <= days; day++) {
        const d = specificDate ? new Date(start) : new Date(year, month, day);
        d.setHours(0, 0, 0, 0);
        const key = `${meal.id}_${d.toDateString()}`;
        const entry = map.get(key);
        if (!entry) continue;
        // Dynamic override calculation: Current State vs Original State
        const overridden = isOverridden(entry);
        // Before-enrollment entries are only shown to the user if they have an
        // active admin override (overridden=true). If the admin set the meal
        // back to its default state (overridden=false), the entry is hidden —
        // the user wasn't enrolled, so there's nothing meaningful to show.
        // Uses the PRECISE check (considers meal cutoff on registration day).
        const isPreReg = isMealBeforeEnrollment(d, user.createdAt, meal);
        if (isPreReg && !overridden) continue;
        const dateKey = toLocalDateKey(d);
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push({
          id: entry.id,
          mealId: meal.id,
          mealName: meal.name,
          mealDisplayName: meal.displayName,
          mealIcon: meal.icon,
          mealColor: meal.color,
          serviceDate: entry.serviceDate.toISOString(),
          status: entry.status,
          originalState: entry.originalState,
          overridden,
          editableUntil: entry.editableUntil.toISOString(),
          locked: entry.locked,
          preRegistration: isPreReg,
          startTime: meal.startTime,
          endTime: meal.endTime,
          mealType: meal.mealType,
        });
      }
    }

    return ok({ meals, byDate, registrationDate: registrationDate.toISOString() });
  } catch (e) {
    return handleApiError(e);
  }
}
