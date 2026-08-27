import { Hono } from "hono";
import { getHealth } from "@modern/application/get-health";
import { createDatabase } from "@modern/infrastructure/db/client";
import { DrizzleSystemRepository } from "@modern/infrastructure/db/system-repository";
import type { ApiSuccess } from "@modern/shared/http";
import type { HealthData } from "@modern/shared/health";
import type { ModernHonoEnv } from "@modern/server/types";

export const healthRoutes = new Hono<ModernHonoEnv>();

healthRoutes.get("/health", async (c) => {
  const db = createDatabase(c.env.DB);
  const repository = new DrizzleSystemRepository(db);
  const data = await getHealth(repository, c.env.APP_VERSION ?? "development");

  return c.json<ApiSuccess<HealthData>>({
    success: true,
    data,
    requestId: c.get("requestId"),
  });
});
