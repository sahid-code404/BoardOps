const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ProrationResult = {
  factor: number;
  daysEnrolled: number;
  daysInMonth: number;
};

/**
 * Cloudflare-native equivalent of the legacy BLG-1 proration calculation.
 * Uses UTC calendar boundaries deliberately so Worker deployment geography
 * cannot change a resident's billed fraction of the month.
 */
export function computeProrationFactor(
  userCreatedAt: Date,
  month: number,
  year: number,
): ProrationResult {
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEndDay = new Date(Date.UTC(year, month + 1, 0));
  const daysInMonth = periodEndDay.getUTCDate();
  const userRegDate = new Date(Date.UTC(
    userCreatedAt.getUTCFullYear(),
    userCreatedAt.getUTCMonth(),
    userCreatedAt.getUTCDate(),
  ));
  const enrollmentStart = periodStart > userRegDate ? periodStart : userRegDate;
  const rawDays = Math.floor((periodEndDay.getTime() - enrollmentStart.getTime()) / MS_PER_DAY) + 1;
  const daysEnrolled = Math.max(0, rawDays);
  const factor = daysInMonth > 0 ? daysEnrolled / daysInMonth : 1;
  return { factor, daysEnrolled, daysInMonth };
}
