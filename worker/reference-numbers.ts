import { eq, like } from "drizzle-orm";

import { createDatabase } from "./db/client";
import { Adjustment, Variable } from "./db/schema";

type NativeDatabase = ReturnType<typeof createDatabase>;

const DEFAULT_ADJUSTMENT_FORMAT = "ADJ-{YEAR}-{SEQ}";

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatAdjustmentNumber(sequence: number, date: Date, customFormat?: string): string {
  const format = customFormat || DEFAULT_ADJUSTMENT_FORMAT;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  return format
    .replace(/{PREFIX}/g, "ADJ")
    .replace(/{YEAR}/g, String(year))
    .replace(/{YY}/g, String(year).slice(-2))
    .replace(/{MONTH}/g, pad(month, 2))
    .replace(/{PERIOD}/g, `${year}-${pad(month, 2)}`)
    .replace(/{SEQ}/g, pad(sequence, 5));
}

export async function generateAdjustmentNumber(
  db: NativeDatabase,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const [formatVariable] = await db
    .select({ value: Variable.value })
    .from(Variable)
    .where(eq(Variable.key, "system.adjustmentNumberFormat"))
    .limit(1);

  const existing = await db
    .select({ adjustmentNumber: Adjustment.adjustmentNumber })
    .from(Adjustment)
    .where(like(Adjustment.adjustmentNumber, `ADJ-${year}-%`));

  let maxSequence = 0;
  for (const row of existing) {
    if (!row.adjustmentNumber) continue;
    const parts = row.adjustmentNumber.split("-");
    const sequence = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (Number.isFinite(sequence) && sequence > maxSequence) maxSequence = sequence;
  }

  return formatAdjustmentNumber(maxSequence + 1, date, formatVariable?.value || undefined);
}
