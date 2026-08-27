import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getClientIp, getUserAgent } from "@/lib/session";
import { createLedgerEntry } from "@/lib/resident-fund";
import { z } from "zod";

const partialSchema = z.object({
  amount: z.number().positive("Partial payment amount must be positive"),
  method: z.enum(["UPI", "CASH", "BANK_TRANSFER", "CHEQUE"]).optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// POST /api/refunds/[id]/partial — record a partial refund payment (PRD DEC-029)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = partialSchema.parse(body);

    const refund = await db.refund.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!refund) return err("Refund not found", 404);
    if (refund.status === "COMPLETED") return err("This refund is already fully completed", 400);
    if (refund.status === "CANCELLED") return err("This refund has been cancelled", 400);

    // Validate the partial amount doesn't exceed the remaining
    if (data.amount > refund.remainingAmount + 0.01) {
      return err(`Partial amount exceeds remaining refund balance (₹${Math.round(refund.remainingAmount).toLocaleString("en-IN")} remaining)`, 400);
    }

    // Create the transaction + update the refund in a transaction
    const result = await db.$transaction(async (tx) => {
      // Record the partial payment
      const transaction = await tx.refundTransaction.create({
        data: {
          refundId: id,
          amount: data.amount,
          method: data.method ?? null,
          reference: data.reference ?? null,
          notes: data.notes ?? null,
          processedBy: admin.id,
        },
      });

      // Update the refund's paidAmount + remainingAmount + status
      const newPaidAmount = refund.paidAmount + data.amount;
      const newRemaining = Math.max(0, refund.amount - newPaidAmount);
      const newStatus = newRemaining <= 0.01 ? "COMPLETED" : "PARTIALLY_PAID";

      const updated = await tx.refund.update({
        where: { id },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemaining,
          status: newStatus,
          method: data.method ?? refund.method,
          reference: data.reference ?? refund.reference,
          completedAt: newStatus === "COMPLETED" ? new Date() : null,
        },
      });

      return { transaction, refund: updated };
    });

    // PRD: create a ledger entry for the refund payment (debit the resident's fund account)
    await createLedgerEntry({
      userId: refund.userId,
      type: "REFUND",
      amount: -data.amount, // negative = debit (money returned to resident)
      entityType: "Refund",
      entityId: id,
      description: `Refund paid: -₹${Math.round(data.amount).toLocaleString("en-IN")} (${refund.refundNumber})`,
    });

    await logAudit({
      actorId: admin.id,
      action: result.refund.status === "COMPLETED" ? "REFUND_COMPLETED" : "REFUND_PARTIAL_PAYMENT",
      entity: "Refund",
      entityId: id,
      newValue: { partialAmount: data.amount, paidAmount: result.refund.paidAmount, remaining: result.refund.remainingAmount, status: result.refund.status },
      reason: data.notes || undefined,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    // Notify the user
    if (result.refund.status === "COMPLETED") {
      await createNotification({
        userId: refund.userId,
        title: "Refund completed",
        description: `Your refund ${refund.refundNumber} of ₹${Math.round(refund.amount).toLocaleString("en-IN")} has been fully processed.`,
        type: "SUCCESS",
        priority: "HIGH",
        route: "payments",
      });
    } else {
      await createNotification({
        userId: refund.userId,
        title: "Partial refund processed",
        description: `₹${Math.round(data.amount).toLocaleString("en-IN")} has been refunded (${refund.refundNumber}). Remaining: ₹${Math.round(result.refund.remainingAmount).toLocaleString("en-IN")}.`,
        type: "INFO",
        priority: "NORMAL",
        route: "payments",
      });
    }

    return ok(result.refund);
  } catch (e) {
    return handleApiError(e);
  }
}
