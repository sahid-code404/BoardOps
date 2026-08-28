import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as relations from "./relations";
import * as schema from "./schema";

const boardOpsSchema = {
  ...schema,
  ...relations,
};

export type BoardOpsDatabase = DrizzleD1Database<typeof boardOpsSchema>;

export function createDatabase(binding: D1Database): BoardOpsDatabase {
  return drizzle(binding, { schema: boardOpsSchema });
}
