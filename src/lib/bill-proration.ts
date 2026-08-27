/**
 * Pure bill-proration calculation — extracted from `bill-calculation.ts`
 * (BLG-1) so it can be unit-tested without a database.
 *
 * Proration model:
 *   - `periodStart`  = first day of the billing month (e.g. July 1)
 *   - `periodEndDay` = last calendar day of the billing month (e.g. July 31)
 *   - `enrollmentStart` = max(periodStart, userRegDate)
 *       (a user who registered BEFORE the period started pays for the full
 *        month; a user who registered mid-period pays only for the days
 *        from their registration date through end-of-month)
 *   - `daysEnrolled` = (periodEndDay - enrollmentStart) / MS_PER_DAY + 1
 *       (the +1 makes both endpoints inclusive — registering on July 31
 *        gives 1 day, not 0)
 *   - `prorationFactor` = daysEnrolled / daysInMonth  (0..1)
 *
 * Meal charges are NOT prorated — they're based on actual meal entries,
 * which only exist for post-registration dates anyway. This factor only
 * applies to the fixed `roomRent + cleaning` charges.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ProrationResult = {
  /** 0..1 — fraction of the month the user was enrolled. */
  factor: number;
  /** Inclusive count of enrolled days (1..daysInMonth). */
  daysEnrolled: number;
  /** Total calendar days in the billing month (28..31). */
  daysInMonth: number;
};

/**
 * Compute the proration factor for a single resident in a billing month.
 *
 * @param userCreatedAt the resident's `User.createdAt` timestamp
 * @param month         0-indexed JS month (0 = January, 11 = December)
 * @param year          full year (e.g. 2026)
 */
export function computeProrationFactor(
  userCreatedAt: Date,
  month: number,
  year: number
): ProrationResult {
  const periodStart = new Date(year, month, 1);
  // `new Date(year, month + 1, 0)` is the LAST calendar day of `month`
  // (day 0 of next month = last day of this month) at local midnight.
  const periodEndDay = new Date(year, month + 1, 0);
  const daysInMonth = periodEndDay.getDate();

  // Normalize the user's registration date to local midnight so the
  // day-difference math is exact (time-of-day is irrelevant for proration).
  const userRegDate = new Date(
    userCreatedAt.getFullYear(),
    userCreatedAt.getMonth(),
    userCreatedAt.getDate()
  );

  const enrollmentStart = periodStart > userRegDate ? periodStart : userRegDate;
  const rawDays =
    Math.floor((periodEndDay.getTime() - enrollmentStart.getTime()) / MS_PER_DAY) + 1;
  const daysEnrolled = Math.max(0, rawDays);
  const factor = daysInMonth > 0 ? daysEnrolled / daysInMonth : 1;

  return { factor, daysEnrolled, daysInMonth };
}
