import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema is introduced incrementally against the existing D1 tables.
 * Table/column names intentionally match migrations/0001_initial.sql exactly,
 * so adopting Drizzle does not require a destructive data migration.
 *
 * Existing Prisma-generated DATETIME columns are mapped conservatively as
 * strings during the transition. Domain/application code owns date parsing;
 * storage representation changes require explicit database migrations.
 */
export const users = sqliteTable("User", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("USER"),
  status: text("status").notNull().default("PENDING"),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});
