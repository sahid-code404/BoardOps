import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { hashPassword } from "../src/lib/auth";

const DATABASE_NAME = "boardops";
const DEFAULT_EMAIL = "admin@boardops.local";
const DEFAULT_NAME = "Local Administrator";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("LOCAL_ADMIN_EMAIL must be a valid email address");
  }
  return email;
}

function createStrongLocalPassword(): string {
  return `Local!${randomBytes(12).toString("hex")}9A`;
}

async function runWranglerSql(sqlFile: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      DATABASE_NAME,
      "--local",
      `--file=${sqlFile}`,
    ],
    {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Local D1 bootstrap failed with exit code ${exitCode}`);
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the local D1 bootstrap with NODE_ENV=production");
  }

  const email = validateEmail(process.env.LOCAL_ADMIN_EMAIL ?? DEFAULT_EMAIL);
  const name = (process.env.LOCAL_ADMIN_NAME ?? DEFAULT_NAME).trim() || DEFAULT_NAME;
  const generatedPassword = process.env.LOCAL_ADMIN_PASSWORD?.trim() || createStrongLocalPassword();
  const passwordHash = hashPassword(generatedPassword);
  const userId = `local_${randomBytes(12).toString("hex")}`;

  const bootstrapDir = resolve(".wrangler");
  const sqlFile = resolve(bootstrapDir, `boardops-local-bootstrap-${process.pid}.sql`);

  const sql = `-- BoardOps local-only D1 bootstrap. Never apply this file remotely.\n\nINSERT INTO "User" (\n  "id",\n  "name",\n  "email",\n  "passwordHash",\n  "role",\n  "status",\n  "timezone",\n  "emailVerified",\n  "twoFactorEnabled",\n  "updatedAt"\n) VALUES (\n  ${sqlString(userId)},\n  ${sqlString(name)},\n  ${sqlString(email)},\n  ${sqlString(passwordHash)},\n  'ADMIN',\n  'ACTIVE',\n  'UTC',\n  1,\n  0,\n  CURRENT_TIMESTAMP\n)\nON CONFLICT("email") DO UPDATE SET\n  "name" = excluded."name",\n  "passwordHash" = excluded."passwordHash",\n  "role" = 'ADMIN',\n  "status" = 'ACTIVE',\n  "emailVerified" = 1,\n  "twoFactorEnabled" = 0,\n  "twoFactorMethod" = 'EMAIL',\n  "twoFactorSecret" = NULL,\n  "twoFactorBackupCodes" = NULL,\n  "emailOtpCode" = NULL,\n  "emailOtpExpiresAt" = NULL,\n  "emailOtpAttempts" = 0,\n  "otpPendingToken" = NULL,\n  "otpPendingExpiresAt" = NULL,\n  "updatedAt" = CURRENT_TIMESTAMP;\n`;

  await mkdir(bootstrapDir, { recursive: true });
  await Bun.write(sqlFile, sql);

  try {
    await runWranglerSql(sqlFile);
  } finally {
    await rm(sqlFile, { force: true });
  }

  console.log("\nBoardOps local D1 is ready.");
  console.log(`Local admin email: ${email}`);
  console.log(`Local admin password: ${generatedPassword}`);
  console.log("These credentials exist only in your local D1 database.\n");
}

main().catch((error) => {
  console.error("[bootstrap-local-d1]", error instanceof Error ? error.message : error);
  process.exit(1);
});
