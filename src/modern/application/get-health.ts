import type { SystemRepository } from "@modern/application/ports/system-repository";
import type { HealthData } from "@modern/shared/health";

export async function getHealth(
  systemRepository: SystemRepository,
  version: string
): Promise<HealthData> {
  const reachable = await systemRepository.pingDatabase();

  return {
    service: "boardops",
    runtime: "cloudflare-workers",
    architecture: "modular-monolith",
    version,
    database: { reachable },
  };
}
