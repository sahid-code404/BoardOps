import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { getResidentFundAccount, getLedgerHistory } from "@/lib/resident-fund";

// GET /api/resident-fund/[userId] — get the full Resident Fund Account for a user
export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  try {
    await requireRole("ADMIN");
    const { userId } = await ctx.params;
    const url = new URL(req.url);
    const includeLedger = url.searchParams.get("ledger") === "true";
    const ledgerLimit = Number(url.searchParams.get("ledgerLimit") || 50);

    const account = await getResidentFundAccount(userId);
    if (!account) return ok(null, 404);

    const result: Record<string, unknown> = { account };
    if (includeLedger) {
      result.ledger = await getLedgerHistory(userId, ledgerLimit);
    }
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
