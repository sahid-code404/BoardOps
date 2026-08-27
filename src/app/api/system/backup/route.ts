import "server-only";

import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/system/backup
 *
 * BoardOps now runs on Cloudflare D1, so a Worker cannot and should not spawn
 * sqlite3/bash or write database snapshots to a local filesystem. D1 provides
 * managed point-in-time recovery (Time Travel) at the platform layer.
 *
 * This endpoint intentionally preserves the existing admin action/API surface
 * while reporting the production recovery policy truthfully. It does NOT claim
 * to have created a manual snapshot.
 */
export async function POST() {
  try {
    const user = await requireRole("ADMIN", "SUPER_ADMIN");
    const checkedAt = new Date().toISOString();

    await logAudit({
      actorId: user.id,
      action: "BACKUP_POLICY_CHECKED",
      entity: "System",
      newValue: {
        provider: "CLOUDFLARE_D1",
        recovery: "TIME_TRAVEL",
        managed: true,
        checkedAt,
      },
    });

    return ok({
      provider: "CLOUDFLARE_D1",
      recovery: "TIME_TRAVEL",
      managed: true,
      manualSnapshotCreated: false,
      checkedAt,
      message:
        "Database recovery is managed by Cloudflare D1 Time Travel; no local SQLite snapshot is required or created by this request.",
    });
  } catch (e) {
    return handleApiError(e);
  }
}
