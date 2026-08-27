import { healthResponseSchema, type HealthResponse } from "@modern/shared/health";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health", {
    signal,
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Health request failed with HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  return healthResponseSchema.parse(payload);
}
