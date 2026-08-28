import { readFile, writeFile } from "node:fs/promises";

const booleanColumns = new Map([
  ["User.twoFactorEnabled", false],
  ["User.emailVerified", false],
  ["LoginHistory.success", null],
  ["Role.isSystem", false],
  ["MealEntry.locked", false],
  ["MealPreset.isSystem", false],
  ["Variable.isSystem", false],
  ["Variable.isProtected", false],
  ["Unit.isActive", true],
  ["Product.isActive", true],
  ["Holiday.mealsDisabled", true],
  ["Announcement.isPinned", true],
  ["Setting.isPublic", false],
  ["Institution.isActive", true],
]);

function normalizeSchema(source) {
  let currentTable = null;
  const seen = new Set();

  const lines = source.split(/\r?\n/).map((line) => {
    const tableMatch = line.match(/^export const\s+\w+\s*=\s*sqliteTable\(["']([^"']+)["']/);
    if (tableMatch) currentTable = tableMatch[1];

    if (!currentTable) return line;

    const columnMatch = line.match(/^(\s*)([A-Za-z_$][\w$]*):\s*numeric\(\).*,$/);
    if (!columnMatch) return line;

    const [, indent, column] = columnMatch;
    const key = `${currentTable}.${column}`;
    if (!booleanColumns.has(key)) return line;

    seen.add(key);
    const defaultValue = booleanColumns.get(key);
    const defaultClause = defaultValue === null ? "" : `.default(${defaultValue})`;
    return `${indent}${column}: integer({ mode: "boolean" })${defaultClause}.notNull(),`;
  });

  const missing = [...booleanColumns.keys()].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new Error(`Failed to normalize BOOLEAN columns: ${missing.join(", ")}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  throw new Error("Usage: node scripts/cf03-normalize-drizzle-schema.mjs <schema.ts> [...schema.ts]");
}

for (const path of paths) {
  const source = await readFile(path, "utf8");
  await writeFile(path, normalizeSchema(source), "utf8");
  console.log(`Normalized Drizzle BOOLEAN mappings in ${path}`);
}
