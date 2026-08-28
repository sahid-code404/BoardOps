export type PaymentTargetStatus = "APPROVED" | "REJECTED";

export type EffectiveBillingPeriod = {
  month: number;
  year: number;
};

export type PaymentLedgerIntent = {
  type: "DEPOSIT" | "ADJUSTMENT";
  amount: number;
  description: string;
};

export function resolvePaymentTarget(action: unknown): PaymentTargetStatus {
  return action === "REJECT" ? "REJECTED" : "APPROVED";
}

export function getEffectiveBillingPeriod(
  now: Date,
  currentCycleStatus: string | null | undefined,
): EffectiveBillingPeriod {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  if (currentCycleStatus !== "CLOSED") return { month, year };
  if (month === 11) return { month: 0, year: year + 1 };
  return { month: month + 1, year };
}

export function getLedgerTargetBalance(status: string, amount: number): number {
  return status === "APPROVED" ? amount : 0;
}

export function getLedgerCorrection(
  status: string,
  amount: number,
  currentPaymentLedgerNet: number,
): number {
  return getLedgerTargetBalance(status, amount) - currentPaymentLedgerNet;
}

export function getPaymentLedgerIntent(
  targetStatus: PaymentTargetStatus,
  amount: number,
  method: string,
): PaymentLedgerIntent {
  if (targetStatus === "APPROVED") {
    return {
      type: "DEPOSIT",
      amount,
      description: `Deposit approved: ₹${Math.round(amount).toLocaleString("en-IN")} via ${method}`,
    };
  }

  return {
    type: "ADJUSTMENT",
    amount: -amount,
    description: `Deposit reversed (payment rejected): -₹${Math.round(amount).toLocaleString("en-IN")}`,
  };
}
