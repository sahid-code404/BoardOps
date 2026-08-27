import { db } from "@/lib/db";
import { requireAuth, getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const formData = await req.formData();
    const file = formData.get("avatar");

    if (!file || !(file instanceof File)) {
      return err("No avatar file provided", 400);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return err("Invalid file type. Use JPEG, PNG, WebP, or GIF.", 422);
    }

    if (file.size > MAX_SIZE) {
      return err("File too large. Maximum 4 MB.", 422);
    }

    const ext = file.type.split("/")[1];
    const filename = `${user.id}_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;

    const updated = await db.user.update({
      where: { id: user.id },
      data: { avatarUrl },
      select: { avatarUrl: true },
    });

    await logAudit({
      actorId: user.id,
      action: "AVATAR_UPLOAD",
      entity: "User",
      entityId: user.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return ok({ avatarUrl: updated.avatarUrl });
  } catch (e) {
    return handleApiError(e);
  }
}
