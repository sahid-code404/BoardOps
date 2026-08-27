import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { recomputeBillPaidState } from "@/lib/bill-sync";
import { z } from "zod";

const markPaidSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "WALLET"]).default("CASH"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

/** POST /api/bills/[id]/mark-paid — admin manually marks a bill as paid.
 *
 *  Used when a user couldn't complete their payment by the due date. The admin
 *  records the payment on their behalf (e.g. cash collected offline). Creates
 *  an APPROVED payment linked to the bill, recomputes the bill's paid/due/status,
 *  and notifies the user.
 *
 *  Body: { amount, method, reference?, notes? } */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json();
    const data = markPaidSchema.parse(body);

    // Fetch the bill
    const bill = await db.bill.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        status: true,
        periodMonth: true,
        periodYear: true,
        deletedAt: true,
      },
    });
    if (!bill) return err("Bill not found", 404);
    if (bill.deletedAt) return err("This bill is scheduled for deletion", 422);
    if (bill.status === "VOID") return err("Cannot mark a voided bill as paid", 422);

    // Validate the amount doesn't exceed the remaining due
    const remainingDue = Math.max(0, bill.totalAmount - bill.paidAmount);
    if (data.amount > remainingDue) {
      return err(
        `Amount ₹${Math.round(data.amount)} exceeds the remaining due of ₹${Math.round(remainingDue)}. The bill total is ₹${Math.round(bill.totalAmount)} and ₹${Math.round(bill.paidAmount)} is already paid.`,
        422
      );
    }

    // Create an APPROVED payment linked to this bill
    const payment = await db.payment.create({
      data: {
        userId: bill.userId,
        billId: bill.id,
        amount: data.amount,
        method: data.method,
        reference: data.reference,
        notes: data.notes || `Marked as paid by admin (${admin.name})`,
        status: "APPROVED",
        approvedBy: admin.id,
      },
    });

    // Re-sync the bill's paid/due/status from the linked payments
    await recomputeBillPaidState(bill.id);

    // Notify the user
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const periodLabel = `${MONTHS[bill.periodMonth] ?? `Month ${bill.periodMonth + 1}`} ${bill.periodYear}`;
    await createNotification({
      userId: bill.userId,
      title: "Bill marked as paid",
      description: `Your ${periodLabel} bill has been marked as paid by an administrator (₹${Math.round(data.amount)} via ${data.method}).${data.notes ? ` Notes: ${data.notes}` : ""}`,
      type: "SUCCESS",
      priority: "HIGH",
      route: "billing",
    });

    await logAudit({
      actorId: admin.id,
      action: "BILL_MARK_PAID",
      entity: "Bill",
      entityId: bill.id,
      newValue: { amount: data.amount, method: data.method, paymentId: payment.id },
      reason: data.notes,
    });

    return ok({ payment, billId: bill.id }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
