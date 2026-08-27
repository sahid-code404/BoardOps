import "server-only";

import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import { env } from "cloudflare:workers";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  __prismaSchemaVersion: string | undefined;
};

// Increment whenever the Prisma schema changes in a way that must invalidate
// a hot-reload singleton during local vinext development.
const SCHEMA_VERSION = "2026-08-27-cloudflare-d1";

const needsFresh =
  !globalForPrisma.prisma ||
  globalForPrisma.__prismaSchemaVersion !== SCHEMA_VERSION;

if (needsFresh) {
  const adapter = new PrismaD1(env.DB);
  globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
  globalForPrisma.__prismaSchemaVersion = SCHEMA_VERSION;
}

/**
 * Application-wide Prisma client backed by the Cloudflare D1 `DB` binding.
 * All existing repositories/routes continue importing `db` from this module,
 * keeping the D1 migration centralized instead of rewriting every query.
 */
export const db = globalForPrisma.prisma!;
