import { z } from "zod";

export const healthDataSchema = z.object({
  service: z.literal("boardops"),
  runtime: z.literal("cloudflare-workers"),
  architecture: z.literal("modular-monolith"),
  version: z.string(),
  database: z.object({
    reachable: z.boolean(),
  }),
});

export type HealthData = z.infer<typeof healthDataSchema>;
