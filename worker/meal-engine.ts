export type MealCutoffConfig = {
  cutoffStrategy: string;
  cutoffTime: string;
  cutoffOffsetMinutes: number;
};

function parseCutoffTime(value: string): { hour: number; minute: number } {
  const [hourValue, minuteValue] = (value || "16:00").split(":").map(Number);
  return {
    hour: Number.isFinite(hourValue) ? hourValue : 0,
    minute: Number.isFinite(minuteValue) ? minuteValue : 0,
  };
}

export function computeEditableUntil(
  meal: MealCutoffConfig,
  serviceDate: Date,
): Date {
  const { hour, minute } = parseCutoffTime(meal.cutoffTime || "16:00");
  const cutoff = new Date(serviceDate);
  cutoff.setUTCHours(hour, minute, 0, 0);

  switch (meal.cutoffStrategy) {
    case "PREVIOUS_DAY":
      cutoff.setUTCDate(cutoff.getUTCDate() - 1);
      return cutoff;
    case "CUSTOM_OFFSET":
      return new Date(cutoff.getTime() - (meal.cutoffOffsetMinutes || 0) * 60_000);
    case "SAME_DAY":
    default:
      return cutoff;
  }
}

export function isLocked(editableUntil: Date, now = new Date()): boolean {
  return now.getTime() > editableUntil.getTime();
}

export function getRegistrationDate(userCreatedAt: Date): Date {
  const date = new Date(userCreatedAt);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function isPreRegistration(serviceDate: Date, userCreatedAt: Date): boolean {
  const registrationDate = getRegistrationDate(userCreatedAt);
  const service = new Date(serviceDate);
  service.setUTCHours(0, 0, 0, 0);
  return service.getTime() < registrationDate.getTime();
}

export function isMealBeforeEnrollment(
  serviceDate: Date,
  userCreatedAt: Date,
  meal: MealCutoffConfig,
): boolean {
  const registrationDate = getRegistrationDate(userCreatedAt);
  const service = new Date(serviceDate);
  service.setUTCHours(0, 0, 0, 0);

  if (service.getTime() < registrationDate.getTime()) return true;
  if (service.getTime() > registrationDate.getTime()) return false;
  return userCreatedAt.getTime() > computeEditableUntil(meal, serviceDate).getTime();
}

export function isOverridden(entry: { status: string; originalState: string }): boolean {
  const effectiveStatus = entry.status === "LOCKED" ? "ON" : entry.status;
  return effectiveStatus !== entry.originalState;
}
