import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { getResidentFundAccount } from "@/lib/resident-fund";

/**
 * GET /api/reports/export?type=X&month=X&year=Y
 * Exports a report as CSV. Supported types: financial, meals, purchases,
 * outstanding, residents, expenses.
 */
function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = headers.map(escape).join(",");
  const dataLines = rows.map((r) => headers.map((h) => escape(r[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "financial";
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month];

    let headers: string[];
    let rows: Record<string, unknown>[];
    let filename: string;

    switch (type) {
      case "expenses": {
        const expenses = await db.expense.findMany({
          where: { expenseDate: { gte: start, lte: end }, deletedAt: null, status: { not: "DELETED" } },
          include: { user: { select: { name: true } } },
          orderBy: { expenseDate: "desc" },
        });
        headers = ["Date", "Title", "Category", "Amount", "Quantity", "Unit", "PaidTo", "Status", "CreatedBy"];
        rows = expenses.map((e) => ({
          Date: new Date(e.expenseDate).toLocaleDateString(),
          Title: e.title,
          Category: e.category,
          Amount: e.amount,
          Quantity: e.quantity,
          Unit: e.unit,
          PaidTo: e.paidTo || "",
          Status: e.status,
          CreatedBy: e.user?.name || "",
        }));
        filename = `expenses-${monthName}-${year}.csv`;
        break;
      }

      case "purchases": {
        const purchases = await db.purchase.findMany({
          where: { purchaseDate: { gte: start, lte: end }, deletedAt: null },
          include: { items: true, user: { select: { name: true } } },
          orderBy: { purchaseDate: "desc" },
        });
        headers = ["Date", "Vendor", "Item", "Category", "Quantity", "Unit", "Rate", "Total", "CreatedBy"];
        rows = [];
        for (const p of purchases) {
          for (const item of p.items) {
            rows.push({
              Date: new Date(p.purchaseDate).toLocaleDateString(),
              Vendor: p.vendor,
              Item: item.productName,
              Category: item.category,
              Quantity: item.quantity,
              Unit: item.unit,
              Rate: item.rate,
              Total: item.total,
              CreatedBy: p.user?.name || "",
            });
          }
        }
        filename = `purchases-${monthName}-${year}.csv`;
        break;
      }

      case "outstanding": {
        const bills = await db.bill.findMany({
          where: { deletedAt: null, status: { notIn: ["VOID", "DELETED"] }, dueAmount: { gt: 0 }, user: { role: "USER" } },
          include: { user: { select: { name: true, email: true, room: true } } },
          orderBy: { dueAmount: "desc" },
        });
        headers = ["Resident", "Email", "Room", "BillNumber", "Period", "TotalAmount", "PaidAmount", "DueAmount", "PreviousDue", "TotalOutstanding", "Status", "DueDate"];
        rows = bills.map((b) => ({
          Resident: b.user.name,
          Email: b.user.email,
          Room: b.user.room || "",
          BillNumber: b.billNumber || "",
          Period: `${b.periodMonth + 1}/${b.periodYear}`,
          TotalAmount: b.totalAmount,
          PaidAmount: b.paidAmount,
          DueAmount: b.dueAmount,
          PreviousDue: b.previousDue,
          TotalOutstanding: b.dueAmount + b.previousDue,
          Status: b.status,
          DueDate: b.dueDate ? new Date(b.dueDate).toLocaleDateString() : "",
        }));
        filename = `outstanding-${monthName}-${year}.csv`;
        break;
      }

      case "residents": {
        const users = await db.user.findMany({
          where: { role: "USER", deletedAt: null, status: "ACTIVE" },
          select: { id: true, name: true, email: true, room: true },
          orderBy: { name: "asc" },
        });
        const accounts = await Promise.all(users.map((u) => getResidentFundAccount(u.id)));
        headers = ["Resident", "Email", "Room", "AvailableBalance", "PendingDeposits", "RefundPending", "OutstandingDue", "PreviousDue", "TotalDeposited", "TotalBilled", "TotalRefunded", "FinancialStatus"];
        rows = users.map((u, i) => {
          const fa = accounts[i];
          return {
            Resident: u.name,
            Email: u.email,
            Room: u.room || "",
            AvailableBalance: fa?.availableBalance ?? 0,
            PendingDeposits: fa?.pendingDeposits ?? 0,
            RefundPending: fa?.refundPending ?? 0,
            OutstandingDue: fa?.outstandingDue ?? 0,
            PreviousDue: fa?.previousDue ?? 0,
            TotalDeposited: fa?.totalDeposited ?? 0,
            TotalBilled: fa?.totalBilled ?? 0,
            TotalRefunded: fa?.totalRefunded ?? 0,
            FinancialStatus: fa?.financialStatus ?? "HEALTHY",
          };
        });
        filename = `residents-${monthName}-${year}.csv`;
        break;
      }

      case "bills": {
        const bills = await db.bill.findMany({
          where: { periodMonth: month, periodYear: year, deletedAt: null, user: { role: "USER" } },
          include: { user: { select: { name: true, email: true, room: true } } },
          orderBy: { createdAt: "desc" },
        });
        headers = ["BillNumber", "Resident", "Email", "Room", "Period", "MealCharges", "OtherCharges", "TotalAmount", "PaidAmount", "DueAmount", "PreviousDue", "Status", "DueDate", "FormulaVersion"];
        rows = bills.map((b) => ({
          BillNumber: b.billNumber || "",
          Resident: b.user.name,
          Email: b.user.email,
          Room: b.user.room || "",
          Period: `${b.periodMonth + 1}/${b.periodYear}`,
          MealCharges: b.mealCharges,
          OtherCharges: b.otherCharges,
          TotalAmount: b.totalAmount,
          PaidAmount: b.paidAmount,
          DueAmount: b.dueAmount,
          PreviousDue: b.previousDue,
          Status: b.status,
          DueDate: b.dueDate ? new Date(b.dueDate).toLocaleDateString() : "",
          FormulaVersion: b.formulaVersion || "",
        }));
        filename = `bills-${monthName}-${year}.csv`;
        break;
      }

      default:
        return err(`Unknown export type: ${type}. Supported: expenses, purchases, outstanding, residents, bills`, 400);
    }

    const csv = toCSV(headers, rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
