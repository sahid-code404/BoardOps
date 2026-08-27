import { getAuthUser } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return err("Not authenticated", 401);
    return ok(user);
  } catch (e) {
    return handleApiError(e);
  }
}
