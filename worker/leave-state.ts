import { computeEditableUntil, type MealCutoffConfig } from "./meal-engine";

export type LeaveMealConfig = MealCutoffConfig & {
  id: string;
};

export type LeaveMealRow = {
  id: string;
  mealId: string;
  serviceDate: string;
  editableUntil: string;
};

export function parseLeaveMealIds(mealType: string, value: string | null): string[] {
  if (mealType !== "SPECIFIC" || !value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0)),
    );
  } catch {
    return [];
  }
}

export function buildInclusiveUtcDates(startValue: string, endValue: string): Date[] {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  if (end.getTime() < start.getTime()) return [];

  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function buildLeaveMealRows(
  meals: LeaveMealConfig[],
  dates: Date[],
): LeaveMealRow[] {
  const rows: LeaveMealRow[] = [];
  for (const meal of meals) {
    for (const serviceDate of dates) {
      rows.push({
        id: crypto.randomUUID(),
        mealId: meal.id,
        serviceDate: serviceDate.toISOString(),
        editableUntil: computeEditableUntil(meal, serviceDate).toISOString(),
      });
    }
  }
  return rows;
}
