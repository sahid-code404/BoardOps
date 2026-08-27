import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { getDeletionDate } from "@/lib/user-cleanup";
import { recomputeBillPaidState } from "@/lib/bill-sync";
import { getEffectiveBillingCycle, createLedgerEntry } from "@/lib/resident-fund";
import { checkAndLiftFinancialRestriction } from "@/lib/restriction-engine";
import { z } from "zod";

/** PATCH /api/payments/[id] — approve or reject a payment.
 *  Idempotent: re-approving an already-approved payment is a no-op (no
 *  double-counting). Rejecting a previously-approved payment reverses the
 *  bill update via recomputeBillPaidState.
 *  On APPROVE: sets the effective billing cycle + creates a ledger entry. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = body.action || "APPROVE";

    const payment = await db.payment.findUnique({ where: { id }, include: { user: true } });
    if (!payment) return err("Payment not found", 404);
    if (payment.deletedAt) return err("Payment is scheduled for deletion", 422);

    const newStatus = action === "REJECT" ? "REJECTED" : "APPROVED";

    // Idempotency — no-op if the payment is already in the target status
    if (payment.status === newStatus) {
      return ok(payment);
    }

    // LB-10: don't approve a payment that is linked to a VOID or DELETED bill —
    // doing so would credit the resident's fund account without ever reducing
    // their outstanding due (the bill no longer exists). Rejecting is still
    // allowed (it doesn't touch the bill).
    if (newStatus === "APPROVED" && payment.billId) {
      const linkedBill = await db.bill.findUnique({
        where: { id: payment.billId },
        select: { status: true, deletedAt: true },
      });
      if (!linkedBill || linkedBill.status === "VOID" || linkedBill.status === "DELETED" || linkedBill.deletedAt) {
        return err("Cannot approve payment for a voided or deleted bill", 422);
      }
    }

    // PRD: determine the effective billing cycle when approving
    let effectiveMonth: number | undefined;
    let effectiveYear: number | undefined;
    if (newStatus === "APPROVED") {
      const cycle = await getEffectiveBillingCycle();
      effectiveMonth = cycle.month;
      effectiveYear = cycle.year;
    }

    const updated = await db.payment.update({
      where: { id },
      data: {
        status: newStatus,
        approvedBy: user.id,
        ...(effectiveMonth !== undefined ? { effectiveMonth, effectiveYear } : {}),
      },
    });

    // PRD: create a ledger entry on APPROVE (credit the resident's fund account)
    // On REJECT of a previously-APPROVED payment: create a reversing ledger entry (debit)
    if (newStatus === "APPROVED") {
      await createLedgerEntry({
        userId: payment.userId,
        type: "DEPOSIT",
        amount: payment.amount, // positive = credit
        entityType: "Payment",
        entityId: payment.id,
        description: `Deposit approved: ₹${Math.round(payment.amount).toLocaleString("en-IN")} via ${payment.method}`,
        billingMonth: effectiveMonth,
        billingYear: effectiveYear,
      });
    } else if (payment.status === "APPROVED") {
      // Rejecting a previously-approved payment → reverse the deposit
      await createLedgerEntry({
        userId: payment.userId,
        type: "ADJUSTMENT",
        amount: -payment.amount, // negative = debit (reversal)
        entityType: "Payment",
        entityId: payment.id,
        description: `Deposit reversed (payment rejected): -₹${Math.round(payment.amount).toLocaleString("en-IN")}`,
      });
    }

    // Re-sync the linked bill (if any) from scratch
    if (payment.billId) {
      await recomputeBillPaidState(payment.billId);
    }

    // PRD: after approving a payment, check if the financial restriction should be lifted
    if (newStatus === "APPROVED") {
      const liftResult = await checkAndLiftFinancialRestriction(payment.userId);
      if (liftResult.lifted) {
        await createNotification({
          userId: payment.userId,
          title: "Meal restriction lifted",
          description: "Your available balance has been restored. Meal booking is now enabled. Please review and re-book any future meals that were turned off.",
          type: "SUCCESS",
          priority: "HIGH",
          route: "user-meals",
        });
      }
    }

    await createNotification({
      userId: payment.userId,
      title: `Payment ${newStatus.toLowerCase()}`,
      description: newStatus === "APPROVED"
        ? `Your payment of ₹${payment.amount} via ${payment.method} has been approved. ${effectiveMonth !== undefined ? `Effective billing cycle: ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][effectiveMonth]} ${effectiveYear}.` : ""}`
        : `Your payment of ₹${payment.amount} via ${payment.method} has been rejected.`,
      type: newStatus === "APPROVED" ? "SUCCESS" : "WARNING",
      priority: "HIGH",
      route: "billing",
    });

    await logAudit({
      actorId: user.id,
      action: `PAYMENT_${newStatus}`,
      entity: "Payment",
      entityId: id,
      oldValue: payment,
      newValue: { ...updated, effectiveMonth, effectiveYear },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

const editSchema = z.object({
  amount: z.number().positive().optional(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).optional(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  action: z.enum(["EDIT", "VOID"]).optional(),
});

/** PUT /api/payments/[id] — admin edits a payment's fields, OR voids it.
 *  Body: { action: "EDIT", amount?, method?, reference?, notes? } for edit
 *        { action: "VOID" } to mark the payment as void (reverses any bill update if it was APPROVED) */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = editSchema.parse(body);

    const existing = await db.payment.findUnique({ where: { id }, include: { user: true } });
    if (!existing) return err("Payment not found", 404);
    if (existing.deletedAt) return err("Payment is scheduled for deletion", 422);

    // VOID action — mark as VOID. The linked bill (if any) is re-synced from
    // scratch via recomputeBillPaidState, which removes this payment's
    // contribution (since it's no longer APPROVED).
    if (data.action === "VOID") {
      if (existing.status === "VOID") return err("Payment is already void", 422);
      if (existing.status === "DELETED") return err("Payment is scheduled for deletion", 422);

      const updated = await db.payment.update({
        where: { id },
        data: { status: "VOID" },
      });

      // Re-sync the bill — removes this payment's amount from paidAmount
      if (existing.billId) {
        await recomputeBillPaidState(existing.billId);
      }

      await createNotification({
        userId: existing.userId,
        title: "Payment voided",
        description: `Your payment of ₹${existing.amount} via ${existing.method} has been voided by an administrator.`,
        type: "WARNING",
        priority: "HIGH",
        route: "billing",
      });

      await logAudit({
        actorId: user.id,
        action: "PAYMENT_VOID",
        entity: "Payment",
        entityId: id,
        oldValue: existing,
        newValue: updated,
      });
      return ok(updated);
    }

    // EDIT action — update editable fields (amount, method, reference, notes)
    // Cannot edit if VOID or DELETED
    if (existing.status === "VOID") return err("Cannot edit a voided payment", 422);
    if (existing.status === "DELETED") return err("Payment is scheduled for deletion", 422);

    const updateData: Record<string, unknown> = {};
    if (data.amount !== undefined) {
      // If the payment is APPROVED and linked to a bill, changing the amount would
      // desync the bill's paidAmount. To keep this safe, refuse amount edits on
      // APPROVED payments linked to a bill — admin must void + resubmit instead.
      if (existing.status === "APPROVED" && existing.billId) {
        return err("Cannot edit amount on an approved payment linked to a bill. Void it and submit a new payment instead.", 422);
      }
      updateData.amount = data.amount;
    }
    if (data.method !== undefined) updateData.method = data.method;
    if (data.reference !== undefined) updateData.reference = data.reference;
    if (data.notes !== undefined) updateData.notes = data.notes;

    if (Object.keys(updateData).length === 0) {
      return err("No editable fields provided", 422);
    }

    const updated = await db.payment.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      actorId: user.id,
      action: "PAYMENT_EDIT",
      entity: "Payment",
      entityId: id,
      oldValue: existing,
      newValue: updated,
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/payments/[id] — soft-delete a single payment (7-day grace period).
 *  The linked bill (if any) is re-synced so paidAmount no longer includes
 *  this payment. On restore, the payment reverts to PENDING (not auto-
 *  approved), so the bill stays consistent until an admin re-approves. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = (body as { reason?: string }).reason;
    const existing = await db.payment.findUnique({ where: { id } });
    if (!existing) return err("Payment not found", 404);
    if (existing.deletedAt) return err("Payment is already scheduled for deletion", 422);

    const deletionDate = getDeletionDate();
    await db.payment.update({
      where: { id },
      data: { deletedAt: deletionDate, deletedBy: user.id, status: "DELETED", deletionReason: reason || null },
    });

    // Re-sync the linked bill — DELETED payments are excluded from paidAmount
    if (existing.billId) {
      await recomputeBillPaidState(existing.billId);
    }

    await logAudit({
      actorId: user.id,
      action: "PAYMENT_SOFT_DELETE",
      entity: "Payment",
      entityId: id,
      oldValue: existing,
      newValue: { deletedAt: deletionDate, status: "DELETED", reason },
      reason,
    });
    return ok({ success: true, permanentDeletion: deletionDate.toISOString() });
  } catch (e) {
    return handleApiError(e);
  }
}
