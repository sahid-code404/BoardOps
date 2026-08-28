import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

export type BoardOpsDatabase = DrizzleD1Database;

export function createDatabase(binding: D1Database): BoardOpsDatabase {
  return drizzle(binding);
}
