import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";

import { logAudit } from "../auth/audit";
import { getAuthUser, getClientIp, getUserAgent } from "../auth/session";
import { createDatabase } from "../db/client";
import { User } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type AvatarErrorStatus = 400 | 401 | 422 | 500;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function failure(c: Context<BoardOpsEnv>, error: string, status: AvatarErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

async function matchesImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  switch (file.type) {
    case "image/jpeg":
      return hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a");
    case "image/webp":
      return hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP");
    default:
      return false;
  }
}

function r2KeyFromAvatarUrl(url: string | null): string | null {
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

function publicAvatarUrl(key: string): string {
  return `/api/uploads/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function registerAvatarRoutes(app: Hono<BoardOpsEnv>): void {
  app.post("/api/auth/avatar", async (c) => {
    const user = await getAuthUser(c);
    if (!user || user.status !== "ACTIVE") return failure(c, "Not authenticated", 401);

    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("avatar");

    if (!file || !(file instanceof File)) {
      return failure(c, "No avatar file provided", 400);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return failure(c, "Invalid file type. Use JPEG, PNG, WebP, or GIF.", 422);
    }
    if (file.size <= 0 || file.size > MAX_SIZE) {
      return failure(c, "File too large. Maximum 4 MB.", 422);
    }
    if (!(await matchesImageSignature(file))) {
      return failure(c, "File contents do not match the declared image type.", 422);
    }

    const extension = EXTENSIONS[file.type];
    const key = `avatars/${user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    await c.env.UPLOADS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        ownerId: user.id,
        purpose: "avatar",
      },
    });

    const avatarUrl = publicAvatarUrl(key);
    const db = createDatabase(c.env.DB);

    try {
      await db
        .update(User)
        .set({ avatarUrl, updatedAt: new Date().toISOString() })
        .where(eq(User.id, user.id));
    } catch (error) {
      await c.env.UPLOADS.delete(key).catch(() => undefined);
      throw error;
    }

    const oldKey = r2KeyFromAvatarUrl(user.avatarUrl);
    if (oldKey && oldKey !== key && oldKey.startsWith(`avatars/${user.id}/`)) {
      try {
        await c.env.UPLOADS.delete(oldKey);
      } catch (error) {
        console.warn("failed to remove previous avatar object", {
          requestId: c.get("requestId"),
          oldKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await logAudit(c, {
      actorId: user.id,
      action: "AVATAR_UPLOAD",
      entity: "User",
      entityId: user.id,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<{ avatarUrl: string }>>({
      success: true,
      data: { avatarUrl },
      requestId: c.get("requestId"),
    });
  });
}
