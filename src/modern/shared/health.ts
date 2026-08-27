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

export const healthResponseSchema = z.object({
  success: z.literal(true),
  data: healthDataSchema,
  requestId: z.string().min(1),
});

export type HealthData = z.infer<typeof healthDataSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
