import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/session";
import { z } from "zod";

/**
 * Policy Engine (PRD Module 17 — Settings & Policy Engine)
 *
 * Policies are stored as Variables with the `policy.` key prefix.
 * This keeps them separate from:
 *   - Settings (institution profile — Institution model)
 *   - Variables (calculation inputs — used by formulas)
 *
 * Policy categories:
 *   - policy.lowBalance.* — financial restriction behavior
 *   - policy.meal.* — meal booking defaults
 *   - policy.billing.* — billing cycle configuration
 *   - policy.payment.* — payment verification rules
 *   - policy.notification.* — notification behavior
 *   - policy.auth.* — authentication rules
 */

// Default policy definitions (used to seed if not already in the DB)
const POLICY_DEFS: { key: string; value: string; category: string; description: string }[] = [
  // Low Balance / Restriction
  { key: "policy.lowBalance.enabled", value: "true", category: "FINANCIAL", description: "Enable automatic meal restriction when balance falls below threshold" },
  { key: "policy.lowBalance.requiredBalance", value: "1000", category: "FINANCIAL", description: "Minimum required available balance (₹)" },
  { key: "policy.lowBalance.graceDays", value: "2", category: "FINANCIAL", description: "Grace period days before meals are suspended" },
  // Meal
  { key: "policy.meal.guestEnabled", value: "true", category: "MEAL", description: "Allow residents to add guest meals" },
  { key: "policy.meal.defaultState", value: "ON", category: "MEAL", description: "Default booking state for new meals (ON or OFF)" },
  { key: "policy.meal.overrideRequiresReason", value: "true", category: "MEAL", description: "Admin meal overrides require a mandatory reason" },
  // Billing
  { key: "policy.billing.generationDay", value: "2", category: "BILLING", description: "Day of the month when bills are generated (1-28)" },
  { key: "policy.billing.dueDateDay", value: "10", category: "BILLING", description: "Default due date day (of the next month)" },
  { key: "policy.billing.billNumberFormat", value: "BILL-{YEAR}-{SEQ}", category: "BILLING", description: "Bill number format. Placeholders: {PREFIX} {YEAR} {YY} {MONTH} {PERIOD} {SEQ}" },
  { key: "policy.billing.allowRegeneration", value: "true", category: "BILLING", description: "Allow bill regeneration before the cycle is closed" },
  // Payment
  { key: "policy.payment.proofRequired", value: "true", category: "PAYMENT", description: "Require payment proof upload for deposits" },
  { key: "policy.payment.referenceRequired", value: "true", category: "PAYMENT", description: "Require a transaction reference number" },
  { key: "policy.payment.duplicateRefCheck", value: "true", category: "PAYMENT", description: "Check for duplicate transaction references" },
  // Notification
  { key: "policy.notification.billGenerated", value: "true", category: "NOTIFICATION", description: "Notify residents when bills are generated" },
  { key: "policy.notification.paymentApproved", value: "true", category: "NOTIFICATION", description: "Notify residents when payments are approved" },
  { key: "policy.notification.lowBalanceWarning", value: "true", category: "NOTIFICATION", description: "Send low balance warnings to residents" },
  // Auth
  { key: "policy.auth.otpExpiryMinutes", value: "10", category: "AUTH", description: "OTP expiry time in minutes" },
  { key: "policy.auth.maxLoginAttempts", value: "5", category: "AUTH", description: "Maximum failed login attempts before rate limiting" },
  { key: "policy.auth.sessionTimeoutDays", value: "30", category: "AUTH", description: "Session timeout in days" },
  { key: "policy.auth.passwordMinLength", value: "8", category: "AUTH", description: "Minimum password length" },
];

const CATEGORY_LABELS: Record<string, string> = {
  FINANCIAL: "Financial Policies",
  MEAL: "Meal Policies",
  BILLING: "Billing Policies",
  PAYMENT: "Payment Policies",
  NOTIFICATION: "Notification Policies",
  AUTH: "Authentication Policies",
};

const CATEGORY_ORDER = ["FINANCIAL", "MEAL", "BILLING", "PAYMENT", "NOTIFICATION", "AUTH"];

/**
 * GET /api/policies — list all policies grouped by category (admin only).
 * Seeds default policies if they don't exist yet.
 */
export async function GET() {
  try {
    await requireRole("ADMIN");

    // Seed any missing default policies
    for (const def of POLICY_DEFS) {
      const existing = await db.variable.findUnique({ where: { key: def.key } });
      if (!existing) {
        await db.variable.create({
          data: {
            key: def.key,
            name: def.key.replace("policy.", "").replace(/\./g, " "),
            description: def.description,
            type: def.value === "true" || def.value === "false" ? "BOOLEAN" : isNaN(Number(def.value)) ? "TEXT" : "NUMBER",
            value: def.value,
            category: def.category,
            isSystem: true,
            isProtected: true,
            status: "ACTIVE",
          },
        });
      }
    }

    // Fetch all policy variables
    const policies = await db.variable.findMany({
      where: { key: { startsWith: "policy." } },
      orderBy: { category: "asc" },
    });

    // Group by category
    const grouped = CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] || cat,
      policies: policies
        .filter((p) => p.category === cat)
        .map((p) => ({
          key: p.key,
          value: p.value,
          type: p.type,
          description: p.description,
        })),
    })).filter((g) => g.policies.length > 0);

    return ok({ categories: grouped });
  } catch (e) {
    return handleApiError(e);
  }
}

const updateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

/**
 * PUT /api/policies — update a single policy value (admin only).
 */
export async function PUT(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await db.variable.findUnique({ where: { key: data.key } });
    if (!existing) return err("Policy not found", 404);
    if (!existing.key.startsWith("policy.")) return err("Not a policy key", 400);

    const updated = await db.variable.update({
      where: { key: data.key },
      data: { value: data.value },
    });

    await logAudit({
      actorId: admin.id,
      action: "POLICY_UPDATE",
      entity: "Variable",
      entityId: updated.id,
      oldValue: { key: existing.key, value: existing.value },
      newValue: { key: updated.key, value: updated.value },
      reason: `Policy ${existing.key} changed from "${existing.value}" to "${data.value}"`,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ key: updated.key, value: updated.value });
  } catch (e) {
    return handleApiError(e);
  }
}
