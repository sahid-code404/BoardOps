import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string[] }>;
};

/**
 * Read-only delivery endpoint for public R2-backed application assets.
 * Only the avatars namespace is public; future private documents should use
 * separate authenticated routes or short-lived signed access.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { key: segments } = await context.params;
  const key = segments.map((segment) => decodeURIComponent(segment)).join("/");

  if (!key.startsWith("avatars/")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.UPLOADS.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");

  return new Response(object.body, { headers });
}
