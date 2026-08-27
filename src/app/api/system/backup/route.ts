import { requireRole } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * POST /api/system/backup
 *   Triggers a SQLite database backup by running scripts/backup-db.sh.
 *   Admin only. Returns the script's stdout (which includes the backup path).
 *
 * The backup script uses `sqlite3 .backup` (safe while the DB is in use) and
 * gzip-compresses the result into the /backups directory. Old backups (>30d)
 * are pruned automatically.
 */
export async function POST() {
  try {
    const user = await requireRole("ADMIN", "SUPER_ADMIN");
    const { stdout, stderr } = await execAsync("bash /home/z/my-project/scripts/backup-db.sh", {
      timeout: 60_000,
    });
    await logAudit({
      actorId: user.id,
      action: "BACKUP_TRIGGERED",
      entity: "System",
      newValue: { stdout: stdout.trim(), stderr: stderr.trim() },
    });
    if (stderr && !stdout) {
      return err(`Backup failed: ${stderr}`, 500);
    }
    return ok({ output: stdout.trim() || "Backup completed." });
  } catch (e) {
    return handleApiError(e);
  }
}
