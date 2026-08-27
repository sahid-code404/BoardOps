import { requireAuth } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { getResidentFundAccount, getLedgerHistory } from "@/lib/resident-fund";

// GET /api/resident-fund/me — get the current user's Resident Fund Account + ledger
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const ledgerLimit = Number(url.searchParams.get("ledgerLimit") || 50);

    const [account, ledger] = await Promise.all([
      getResidentFundAccount(user.id),
      getLedgerHistory(user.id, ledgerLimit),
    ]);

    return ok({ account, ledger });
  } catch (e) {
    return handleApiError(e);
  }
}
