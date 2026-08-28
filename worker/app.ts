import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { createDatabase } from "./db/client";
import type { ApiFailure, ApiSuccess } from "./http";
import { registerAccountRoutes } from "./routes/account";
import { registerAnnouncementRoutes } from "./routes/announcements";
import { registerAuditLogRoutes } from "./routes/audit-logs";
import { registerAuthRoutes } from "./routes/auth";
import { registerAvatarRoutes } from "./routes/avatar";
import { registerHolidayRoutes } from "./routes/holidays";
import { registerInstitutionRoutes } from "./routes/institution";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerPasswordRecoveryRoutes } from "./routes/password-recovery";
import { registerProductRoutes } from "./routes/products";
import { registerRegistrationRoutes } from "./routes/registration";
import { registerResubmissionRoutes } from "./routes/resubmission";
import { registerSettingRoutes } from "./routes/settings";
import { registerTwoFactorRoutes } from "./routes/two-factor";
import { registerUnitRoutes } from "./routes/units";
import { registerUploadRoutes } from "./routes/uploads";
import { registerVariableRoutes } from "./routes/variables";
import type { BoardOpsEnv } from "./types";

export function createWorkerApp() {
  const app = new Hono<BoardOpsEnv>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("cf-ray") || crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });
  app.use("*", secureHeaders());

  app.get("/api", (c) =>
    c.json<ApiSuccess<{ status: "ok"; runtime: "cloudflare-workers"; stack: "native" }>>({
      success: true,
      data: {
        status: "ok",
        runtime: "cloudflare-workers",
        stack: "native",
      },
      requestId: c.get("requestId"),
    })
  );

  app.get("/api/health", async (c) => {
    const db = createDatabase(c.env.DB);
    const result = await db.get<{ ok: number }>(sql`select 1 as ok`);

    return c.json<ApiSuccess<{ status: "ok"; database: "d1" }>>({
      success: true,
      data: {
        status: result?.ok === 1 ? "ok" : "ok",
        database: "d1",
      },
      requestId: c.get("requestId"),
    });
  });

  registerAuthRoutes(app);
  registerAccountRoutes(app);
  registerTwoFactorRoutes(app);
  registerRegistrationRoutes(app);
  registerPasswordRecoveryRoutes(app);
  registerResubmissionRoutes(app);
  registerAvatarRoutes(app);
  registerUploadRoutes(app);
  registerNotificationRoutes(app);
  registerAnnouncementRoutes(app);
  registerAuditLogRoutes(app);
  registerHolidayRoutes(app);
  registerInstitutionRoutes(app);
  registerVariableRoutes(app);
  registerUnitRoutes(app);
  registerProductRoutes(app);
  registerSettingRoutes(app);

  app.notFound((c) =>
    c.json<ApiFailure>(
      {
        success: false,
        error: "The requested API resource does not exist.",
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
        architecture: "native-cloudflare-modular-monolith",
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
        requestId,
      },
      500
    );
  });

  return app;
}

export type BoardOpsWorkerApp = ReturnType<typeof createWorkerApp>;
