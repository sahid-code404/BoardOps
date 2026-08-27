import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a Date as a "YYYY-MM-DD" string using LOCAL time (browser/server local timezone).
 *
 * This is the correct way to generate date keys for grouping by day. Do NOT use
 * `d.toISOString().slice(0, 10)` — that converts to UTC first, which shifts the
 * date by the timezone offset (e.g. July 8 00:00 IST becomes July 7 18:30 UTC → "2026-07-07").
 *
 * Uses local getters (getFullYear, getMonth, getDate) so the date is always the
 * calendar date the user sees in their browser.
 */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
