/** Client-safe deletion countdown helpers. Keep this module free of server/database imports. */
export function getDeletionDate(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export function formatDeletionCountdown(deletedAt: Date): string {
  const now = new Date();
  const diff = deletedAt.getTime() - now.getTime();

  if (diff <= 0) return "Expiring soon";

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} left`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} left`;
  return "Less than 1 hour left";
}
