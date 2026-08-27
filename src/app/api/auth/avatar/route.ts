import { env } from "cloudflare:workers";

import { db } from "@/lib/db";
import { requireAuth, getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function r2KeyFromAvatarUrl(url?: string | null): string | null {
  const prefix = "/api/uploads/";
  if (!url?.startsWith(prefix)) return null;
  try {
    return url
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const formData = await req.formData();
    const file = formData.get("avatar");

    if (!file || !(file instanceof File)) {
      return err("No avatar file provided", 400);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return err("Invalid file type. Use JPEG, PNG, WebP, or GIF.", 422);
    }

    if (file.size <= 0 || file.size > MAX_SIZE) {
      return err("File too large. Maximum 4 MB.", 422);
    }

    const ext = EXTENSIONS[file.type];
    const key = `avatars/${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    await env.UPLOADS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        ownerId: user.id,
        purpose: "avatar",
      },
    });

    const avatarUrl = `/api/uploads/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;

    let updated: { avatarUrl: string | null };
    try {
      updated = await db.user.update({
        where: { id: user.id },
        data: { avatarUrl },
        select: { avatarUrl: true },
      });
    } catch (error) {
      await env.UPLOADS.delete(key);
      throw error;
    }

    const oldKey = r2KeyFromAvatarUrl(user.avatarUrl);
    if (oldKey && oldKey !== key && oldKey.startsWith(`avatars/${user.id}/`)) {
      try {
        await env.UPLOADS.delete(oldKey);
      } catch (error) {
        console.warn("[avatar] Failed to remove previous R2 object", { oldKey, error });
      }
    }

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
