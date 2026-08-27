/**
 * Timezone helper for BoardOps.
 *
 * Supports dynamic timezones. The default is Asia/Calcutta (IST), but the
 * admin can set their own timezone from the profile panel. All billing
 * period calculations use the configured timezone.
 *
 * On the server side, the timezone is read from the user's profile (DB).
 * On the client side, the browser's timezone is auto-detected via
 * Intl.DateTimeFormat().resolvedOptions().timeZone.
 */

// Common timezone offsets in milliseconds (for fallback when Intl is unavailable)
const TZ_OFFSETS: Record<string, number> = {
  "Asia/Calcutta": 5.5 * 60 * 60 * 1000,
  "Asia/Kolkata": 5.5 * 60 * 60 * 1000,
  "Asia/Dubai": 4 * 60 * 60 * 1000,
  "Asia/Karachi": 5 * 60 * 60 * 1000,
  "Asia/Dhaka": 6 * 60 * 60 * 1000,
  "Asia/Bangkok": 7 * 60 * 60 * 1000,
  "Asia/Singapore": 8 * 60 * 60 * 1000,
  "Asia/Tokyo": 9 * 60 * 60 * 1000,
  "Europe/London": 0,
  "Europe/Paris": 1 * 60 * 60 * 1000,
  "America/New_York": -5 * 60 * 60 * 1000,
  "America/Chicago": -6 * 60 * 60 * 1000,
  "America/Los_Angeles": -8 * 60 * 60 * 1000,
  "Australia/Sydney": 10 * 60 * 60 * 1000,
  "UTC": 0,
};

/** Default timezone (used when no user timezone is set). */
export const DEFAULT_TIMEZONE = "Asia/Calcutta";

/** The timezone string used throughout the app. Can be overridden per-user. */
export const APP_TIMEZONE = DEFAULT_TIMEZONE;

/**
 * Get the UTC offset in milliseconds for a given timezone.
 * Uses Intl.DateTimeFormat for accuracy (handles DST), falls back to a static
 * lookup table for common timezones.
 */
export function getTimezoneOffset(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): number {
  try {
    // Use Intl to get the offset — this handles DST automatically
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const parts = dtf.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    if (offsetPart) {
      // Parse "GMT+5:30" or "GMT-5" etc.
      const match = offsetPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
      if (match) {
        const sign = match[1] === "+" ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = match[3] ? parseInt(match[3], 10) : 0;
        return sign * (hours * 60 + minutes) * 60 * 1000;
      }
    }
  } catch {
    // Intl not available or invalid timezone — fall back to static lookup
  }

  // Fallback: static offset table
  return TZ_OFFSETS[timezone] ?? TZ_OFFSETS[DEFAULT_TIMEZONE] ?? 0;
}

/**
 * Get a Date adjusted to the given timezone. Returns a Date object whose UTC
 * fields represent the local time in that timezone.
 */
export function nowInTimezone(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): Date {
  const offset = getTimezoneOffset(timezone, now);
  return new Date(now.getTime() + offset);
}

/**
 * Get the current billing period as { year, month } in the given timezone.
 * month is 0-indexed (0 = January).
 */
export function getCurrentPeriod(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): { year: number; month: number } {
  const local = nowInTimezone(timezone, now);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

/**
 * Compute a period key (year * 12 + month) for a given year/month.
 * Useful for comparing periods (e.g. is this period in the past?).
 */
export function periodKey(year: number, month: number): number {
  return year * 12 + month;
}

/**
 * Check if a billing period (year, month, 0-indexed) has ended in the given
 * timezone. A period has ended when the current period in that timezone is
 * strictly greater than the target period.
 */
export function hasPeriodEnded(year: number, month: number, timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): boolean {
  const current = getCurrentPeriod(timezone, now);
  return periodKey(year, month) < periodKey(current.year, current.month);
}

/**
 * Get the current timezone label for display.
 */
export function getTimezoneLabel(timezone: string): string {
  const labels: Record<string, string> = {
    "Asia/Calcutta": "India (IST, UTC+5:30)",
    "Asia/Kolkata": "India (IST, UTC+5:30)",
    "Asia/Dubai": "Dubai (GST, UTC+4)",
    "Asia/Karachi": "Pakistan (PKT, UTC+5)",
    "Asia/Dhaka": "Bangladesh (BST, UTC+6)",
    "Asia/Bangkok": "Thailand (ICT, UTC+7)",
    "Asia/Singapore": "Singapore (SGT, UTC+8)",
    "Asia/Tokyo": "Japan (JST, UTC+9)",
    "Europe/London": "UK (GMT, UTC+0)",
    "Europe/Paris": "France (CET, UTC+1)",
    "America/New_York": "US Eastern (EST, UTC-5)",
    "America/Chicago": "US Central (CST, UTC-6)",
    "America/Los_Angeles": "US Pacific (PST, UTC-8)",
    "Australia/Sydney": "Sydney (AEDT, UTC+11)",
    "UTC": "UTC",
  };
  return labels[timezone] || timezone;
}

/**
 * Get a list of common timezones for the picker UI.
 */
export const COMMON_TIMEZONES = [
  "Asia/Calcutta",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

// ── Backward-compatible IST aliases (deprecated — use timezone-aware versions) ──
/** @deprecated Use nowInTimezone() instead */
export function nowInIST(now: Date = new Date()): Date {
  return nowInTimezone(DEFAULT_TIMEZONE, now);
}
/** @deprecated Use getCurrentPeriod() instead */
export function getCurrentPeriodIST(now: Date = new Date()): { year: number; month: number } {
  return getCurrentPeriod(DEFAULT_TIMEZONE, now);
}
