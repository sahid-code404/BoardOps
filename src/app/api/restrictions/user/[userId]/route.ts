import { requireAuth, requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { evaluateRestrictions } from "@/lib/restriction-engine";

// GET /api/restrictions/user/[userId] — get the restriction evaluation for a user
// Admins can query any user; residents can only query themselves.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  try {
    const user = await requireAuth();
    const { userId } = await ctx.params;

    if (user.role === "USER" && userId !== user.id) {
      return err("You can only view your own restrictions", 403);
    }

    const evaluation = await evaluateRestrictions(userId);
    return ok(evaluation);
  } catch (e) {
    return handleApiError(e);
  }
}
