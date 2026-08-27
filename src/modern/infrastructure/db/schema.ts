import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema is introduced incrementally against the existing D1 tables.
 * Table/column names intentionally match migrations/0001_initial.sql exactly,
 * so adopting Drizzle does not require a destructive data migration.
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
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("Setting", {
  id: text("id").primaryKey().notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  category: text("category").notNull(),
  type: text("type").notNull(),
  isPublic: integer("isPublic", { mode: "boolean" }).notNull().default(false),
});
