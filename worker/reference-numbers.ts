export type ReferenceNumberType = "bill" | "refund" | "adjustment";

const DEFAULTS: Record<ReferenceNumberType, { prefix: string; format: string }> = {
  bill: { prefix: "BILL", format: "BILL-{YEAR}-{SEQ}" },
  refund: { prefix: "REF", format: "REF-{YEAR}-{SEQ}" },
  adjustment: { prefix: "ADJ", format: "ADJ-{YEAR}-{SEQ}" },
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function getReferencePrefix(type: ReferenceNumberType): string {
  return DEFAULTS[type].prefix;
}

export function getDefaultReferenceFormat(type: ReferenceNumberType): string {
  return DEFAULTS[type].format;
}

export function formatReferenceNumber(
  type: ReferenceNumberType,
  sequence: number,
  date: Date = new Date(),
  customFormat?: string | null,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Reference sequence must be a positive integer");
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error("Reference date must be valid");
  }

  const config = DEFAULTS[type];
  const format = customFormat?.trim() || config.format;
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

export function getNextReferenceSequence(
  references: Iterable<string | null | undefined>,
  type: ReferenceNumberType,
  date: Date = new Date(),
): number {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Reference date must be valid");
  }

  const prefix = DEFAULTS[type].prefix;
  const year = date.getUTCFullYear();
  const expectedStart = `${prefix}-${year}-`;
  let maxSequence = 0;

  for (const reference of references) {
    if (!reference?.startsWith(expectedStart)) continue;
    const suffix = reference.slice(reference.lastIndexOf("-") + 1);
    if (!/^\d+$/.test(suffix)) continue;
    const sequence = Number.parseInt(suffix, 10);
    if (Number.isSafeInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  return maxSequence + 1;
}
