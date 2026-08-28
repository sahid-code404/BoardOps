import type { Hono } from "hono";

import type { BoardOpsEnv } from "../types";

function decodeObjectKey(pathname: string): string | null {
  const prefix = "/api/uploads/";
  if (!pathname.startsWith(prefix)) return null;

  try {
    return pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

export function registerUploadRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/uploads/*", async (c) => {
    const key = decodeObjectKey(new URL(c.req.url).pathname);
    if (!key || !key.startsWith("avatars/")) {
      return c.text("Not found", 404);
    }

    const object = await c.env.UPLOADS.get(key);
    if (!object) return c.text("Not found", 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set(
      "cache-control",
      object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
    );
    headers.set("x-content-type-options", "nosniff");

    return new Response(object.body, { status: 200, headers });
  });
}
