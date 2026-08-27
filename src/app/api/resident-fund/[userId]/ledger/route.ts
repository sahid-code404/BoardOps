import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { getLedgerHistory } from "@/lib/resident-fund";

// GET /api/resident-fund/[userId]/ledger — get the ledger history for a user
export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  try {
    const user = await requireAuth();
    const { userId } = await ctx.params;
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);

    // Residents can only view their own ledger
    if (user.role === "USER" && userId !== user.id) {
      return err("You can only view your own ledger", 403);
    }

    const ledger = await getLedgerHistory(userId, limit, offset);
    return ok(ledger);
  } catch (e) {
    return handleApiError(e);
  }
}
