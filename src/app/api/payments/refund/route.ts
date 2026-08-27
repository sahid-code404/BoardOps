import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import { recomputeBillPaidState } from "@/lib/bill-sync";
import { getUserCredit } from "@/lib/credit";
import { z } from "zod";

/** GET /api/payments/refund — lists users with refundable credit.
 *  Credit = (approved payments) − (total billed) − (already refunded).
 *  Includes unlinked payments (direct deposits) and overpayments on bills.
 *
 *  IMPORTANT: Only shows users AFTER bill generation for the current period.
 *  If no bills exist for the current month, returns an empty list — refunds
 *  are not available until bills have been generated (the user's overpayment
 *  can't be confirmed until we know what they actually owe). */
export async function GET() {
  try {
    await requireRole("ADMIN");

    // Check if bills have been generated for the current period.
    // If not, return an empty list — don't show refund-eligible users
    // before bill generation.
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentPeriodBills = await db.bill.count({
      where: {
        periodMonth: currentMonth,
        periodYear: currentYear,
        deletedAt: null,
        status: { notIn: ["VOID", "DELETED"] },
      },
    });
    if (currentPeriodBills === 0) {
      // No bills generated for the current period yet — refunds not available.
      return ok([]);
    }

    const residents = await db.user.findMany({
      where: { status: "ACTIVE", role: "USER" },
      select: { id: true, name: true, email: true, avatarUrl: true, room: true },
      orderBy: { name: "asc" },
    });

    const refundUsers = [];
    for (const u of residents) {
      const { credit, totalApproved, totalBilled, totalRefunded } = await getUserCredit(u.id);
      if (credit > 0) {
        refundUsers.push({
          userId: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          room: u.room,
          creditAmount: credit,
          breakdown: { totalApproved, totalBilled, totalRefunded },
        });
      }
    }

    // Sort by credit descending
    refundUsers.sort((a, b) => b.creditAmount - a.creditAmount);
    return ok(refundUsers);
  } catch (e) {
    return handleApiError(e);
  }
}

const refundSchema = z.object({
  userId: z.string(),
  amount: z.number().positive(),
  billId: z.string().optional(),
  notes: z.string().optional(),
});

/** POST /api/payments/refund — processes a refund to a user.
 *  Creates a REFUNDED payment record and notifies the user.
 *  The refund is linked to the bill that has the overpayment (if any), so
 *  recomputeBillPaidState correctly reduces that bill's paidAmount. */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = refundSchema.parse(body);

    // Verify the user has enough credit (using the same calculation as GET)
    const { credit } = await getUserCredit(data.userId);
    if (credit < data.amount) {
      return err(`User only has ₹${Math.round(credit)} credit (requested ₹${Math.round(data.amount)})`, 422);
    }

    // Determine which bill to link the refund to.
    // Priority:
    //  1. Admin-specified billId (if any)
    //  2. The bill with the most overpayment (paidAmount > totalAmount) —
    //     this is the bill the refund should reduce.
    //  3. Fallback: the user's most recent non-void, non-deleted bill.
    let billId = data.billId || null;
    if (!billId) {
      const userBills = await db.bill.findMany({
        where: { userId: data.userId, deletedAt: null, status: { notIn: ["VOID", "DELETED"] } },
        select: { id: true, totalAmount: true, paidAmount: true, createdAt: true },
      });
      // Find the bill with the most overpayment
      const overpaidBills = userBills
        .map((b) => ({ ...b, overpay: b.paidAmount - b.totalAmount }))
        .filter((b) => b.overpay > 0)
        .sort((a, b) => b.overpay - a.overpay);
      if (overpaidBills.length > 0) {
        billId = overpaidBills[0].id;
      } else {
        // No single bill overpaid — link to most recent bill for attribution
        const sorted = [...userBills].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        billId = sorted[0]?.id || null;
      }
    }

    // Create a REFUNDED payment record linked to the overpaid bill.
    // recomputeBillPaidState treats REFUNDED payments as negative contributions
    // to that bill's paidAmount, so the bill stays in sync.
    const payment = await db.payment.create({
      data: {
        userId: data.userId,
        billId,
        amount: data.amount,
        method: "REFUND",
        status: "REFUNDED",
        reference: "REFUND",
        notes: data.notes || "Refund of excess deposit",
        approvedBy: admin.id,
      },
    });

    // Re-sync the linked bill so paid/due/status reflect the refund
    if (billId) {
      await recomputeBillPaidState(billId);
    }

    // Notify the user
    const user = await db.user.findUnique({ where: { id: data.userId } });
    if (user) {
      await createNotification({
        userId: data.userId,
        title: "Refund processed",
        description: `₹${Math.round(data.amount)} has been refunded to your account${data.notes ? ` — ${data.notes}` : ""}.`,
        type: "INFO",
        priority: "HIGH",
        route: "billing",
      });
    }

    await logAudit({
      actorId: admin.id,
      action: "PAYMENT_REFUND",
      entity: "Payment",
      entityId: payment.id,
      newValue: { userId: data.userId, amount: data.amount, billId },
    });

    return ok(payment, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
