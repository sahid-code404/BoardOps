import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ApiFailure, ApiSuccess } from "@modern/shared/http";
import { requestIdMiddleware } from "@modern/server/middleware/request-id";
import { healthRoutes } from "@modern/server/routes/health";
import type { ModernHonoEnv } from "@modern/server/types";

export function createServerApp() {
  const app = new Hono<ModernHonoEnv>();

  app.use("*", requestIdMiddleware);
  app.use("*", secureHeaders());

  app.get("/api", (c) =>
    c.json<ApiSuccess<{ version: "v1"; status: "ok" }>>({
      success: true,
      data: { version: "v1", status: "ok" },
      requestId: c.get("requestId"),
    })
  );

  app.route("/api/v1", healthRoutes);

  app.notFound((c) =>
    c.json<ApiFailure>(
      {
        success: false,
        error: "The requested API resource does not exist.",
        details: { code: "NOT_FOUND" },
        requestId: c.get("requestId"),
      },
      404
    )
  );

  app.onError((error, c) => {
    const requestId = c.get("requestId") || crypto.randomUUID();

    console.error(
      JSON.stringify({
        level: "error",
        service: "boardops",
        architecture: "modular-monolith",
        requestId,
        method: c.req.method,
        path: c.req.path,
        message: error instanceof Error ? error.message : "Unknown server error",
      })
    );

    return c.json<ApiFailure>(
      {
        success: false,
        error: "An unexpected server error occurred.",
        details: { code: "INTERNAL_ERROR" },
        requestId,
      },
      500
    );
  });

  return app;
}

export type ModernApp = ReturnType<typeof createServerApp>;
