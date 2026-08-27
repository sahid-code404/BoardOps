import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/lib/session";

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productName: z.string().min(1, "Product name is required"),
  category: z.string().default("GENERAL"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required"),
  rate: z.number().min(0).default(0),
  total: z.number().min(0),
  notes: z.string().optional().nullable(),
});

const createSchema = z.object({
  vendor: z.string().min(1, "Vendor is required").max(200),
  purchaseDate: z.string(), // ISO date string
  items: z.array(itemSchema).min(1, "At least one item is required"),
  receiptUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const limit = Number(url.searchParams.get("limit") || 100);

    const where: Record<string, unknown> = {};
    if (!includeDeleted) where.deletedAt = null;
    if (month && year) {
      const start = new Date(Number(year), Number(month) - 1, 1);
      const end = new Date(Number(year), Number(month), 1);
      where.purchaseDate = { gte: start, lt: end };
    }

    const purchases = await db.purchase.findMany({
      where,
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { purchaseDate: "desc" },
      take: limit,
    });
    return ok(purchases);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);

    const purchaseDate = new Date(data.purchaseDate);
    if (isNaN(purchaseDate.getTime())) return err("Invalid purchase date", 400);

    const totalAmount = data.items.reduce((sum, it) => sum + it.total, 0);

    // Validate products exist if specified
    for (const item of data.items) {
      if (item.productId) {
        const product = await db.product.findUnique({ where: { id: item.productId } });
        if (!product) return err(`Product not found: ${item.productName}`, 404);
      }
    }

    // Create Expense + Purchase + PurchaseItems in a transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Create the linked Expense (so existing expense totals/reports still work)
      const expense = await tx.expense.create({
        data: {
          title: `Purchase: ${data.vendor}`,
          description: data.notes || `${data.items.length} item(s) from ${data.vendor}`,
          category: "PURCHASE",
          quantity: 1,
          unit: "purchase",
          amount: totalAmount,
          currency: (await db.institution.findFirst())?.currency || "INR",
          expenseDate: purchaseDate,
          paidTo: data.vendor,
          receiptUrl: data.receiptUrl ?? null,
          status: "APPROVED",
          createdBy: admin.id,
        },
      });

      // 2. Create the Purchase record linked to the Expense
      const purchase = await tx.purchase.create({
        data: {
          vendor: data.vendor,
          purchaseDate,
          totalAmount,
          receiptUrl: data.receiptUrl ?? null,
          notes: data.notes ?? null,
          expenseId: expense.id,
          createdBy: admin.id,
          status: "APPROVED",
          items: {
            create: data.items.map((it) => ({
              productId: it.productId ?? null,
              productName: it.productName,
              category: it.category,
              quantity: it.quantity,
              unit: it.unit,
              rate: it.rate,
              total: it.total,
              notes: it.notes ?? null,
            })),
          },
        },
        include: { items: true, expense: true },
      });

      return { expense, purchase };
    });

    await logAudit({
      actorId: admin.id,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: result.purchase.id,
      newValue: {
        vendor: data.vendor,
        totalAmount,
        itemCount: data.items.length,
        expenseId: result.expense.id,
      },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok(result.purchase);
  } catch (e) {
    return handleApiError(e);
  }
}
