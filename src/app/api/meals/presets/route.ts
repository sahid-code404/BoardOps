import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    await requireAuth();
    const presets = await db.mealPreset.findMany({
      include: { items: { include: { meal: true } } },
      orderBy: { name: "asc" },
    });
    return ok(presets);
  } catch (e) {
    return handleApiError(e);
  }
}
