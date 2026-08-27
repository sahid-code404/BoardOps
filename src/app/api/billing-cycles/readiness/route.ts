import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { getReadiness } from "@/lib/monthly-closing";

// GET /api/billing-cycles/readiness?month=X&year=Y — readiness checklist
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());

    const result = await getReadiness(month, year);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
