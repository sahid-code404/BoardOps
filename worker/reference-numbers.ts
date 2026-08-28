import { eq, like } from "drizzle-orm";

import { createDatabase } from "./db/client";
import { Adjustment, Refund, Variable } from "./db/schema";

type NativeDatabase = ReturnType<typeof createDatabase>;

type ReferenceKind = "adjustment" | "refund";

const DEFAULTS: Record<ReferenceKind, { prefix: string; format: string; variable: string }> = {
  adjustment: {
    prefix: "ADJ",
    format: "ADJ-{YEAR}-{SEQ}",
    variable: "system.adjustmentNumberFormat",
  },
  refund: {
    prefix: "REF",
    format: "REF-{YEAR}-{SEQ}",
    variable: "system.refundNumberFormat",
  },
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatReferenceNumber(
  kind: ReferenceKind,
  sequence: number,
  date: Date,
  customFormat?: string,
): string {
  const config = DEFAULTS[kind];
  const format = customFormat || config.format;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  return format
    .replace(/{PREFIX}/g, config.prefix)
    .replace(/{YEAR}/g, String(year))
    .replace(/{YY}/g, String(year).slice(-2))
    .replace(/{MONTH}/g, pad(month, 2))
    .replace(/{PERIOD}/g, `${year}-${pad(month, 2)}`)
    .replace(/{SEQ}/g, pad(sequence, 5));
}

async function getFormatVariable(db: NativeDatabase, key: string) {
  const [row] = await db
    .select({ value: Variable.value })
    .from(Variable)
    .where(eq(Variable.key, key))
    .limit(1);
  return row?.value || undefined;
}

export async function generateAdjustmentNumber(
  db: NativeDatabase,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const config = DEFAULTS.adjustment;
  const customFormat = await getFormatVariable(db, config.variable);
  const existing = await db
    .select({ value: Adjustment.adjustmentNumber })
    .from(Adjustment)
    .where(like(Adjustment.adjustmentNumber, `${config.prefix}-${year}-%`));

  let maxSequence = 0;
  for (const row of existing) {
    if (!row.value) continue;
    const sequence = Number.parseInt(row.value.split("-").at(-1) ?? "", 10);
    if (Number.isFinite(sequence) && sequence > maxSequence) maxSequence = sequence;
  }

  return formatReferenceNumber("adjustment", maxSequence + 1, date, customFormat);
}

export async function generateRefundNumber(
  db: NativeDatabase,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const config = DEFAULTS.refund;
  const customFormat = await getFormatVariable(db, config.variable);
  const existing = await db
    .select({ value: Refund.refundNumber })
    .from(Refund)
    .where(like(Refund.refundNumber, `${config.prefix}-${year}-%`));

  let maxSequence = 0;
  for (const row of existing) {
    if (!row.value) continue;
    const sequence = Number.parseInt(row.value.split("-").at(-1) ?? "", 10);
    if (Number.isFinite(sequence) && sequence > maxSequence) maxSequence = sequence;
  }

  return formatReferenceNumber("refund", maxSequence + 1, date, customFormat);
}
