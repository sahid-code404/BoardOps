const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const configPath = process.argv[2] ?? "wrangler.jsonc";
const configText = await Bun.file(configPath).text();
let config: Record<string, any>;

try {
  config = JSON.parse(configText);
} catch (error) {
  console.error(
    `Cloudflare preflight failed: ${configPath} must remain valid JSON/JSONC without unsupported comments for this check.`
  );
  throw error;
}

const errors: string[] = [];

const d1 = config.d1_databases?.find((entry: any) => entry.binding === "DB");
if (!d1) {
  errors.push("Missing D1 binding: DB");
} else {
  if (!d1.database_name) errors.push("D1 DB binding has no database_name");
  if (!d1.database_id || d1.database_id === ZERO_UUID) {
    errors.push("D1 DB binding still uses the placeholder database_id");
  }
}

const uploads = config.r2_buckets?.find((entry: any) => entry.binding === "UPLOADS");
if (!uploads?.bucket_name) {
  errors.push("Missing R2 binding/bucket: UPLOADS");
}

const limiter = config.ratelimits?.find(
  (entry: any) => entry.name === "AUTH_RATE_LIMITER"
);
if (!limiter) {
  errors.push("Missing Rate Limiting binding: AUTH_RATE_LIMITER");
} else if (!limiter.simple?.limit || !limiter.simple?.period) {
  errors.push("AUTH_RATE_LIMITER must define simple.limit and simple.period");
}

const email = config.send_email?.find((entry: any) => entry.name === "EMAIL");
if (!email) {
  errors.push("Missing Email binding: EMAIL");
}

const isModern = configPath.endsWith("wrangler.modern.jsonc");
if (isModern) {
  if (config.main !== "./src/modern/server/index.ts") {
    errors.push("Modern Worker main entry must be ./src/modern/server/index.ts");
  }
  if (config.assets?.not_found_handling !== "single-page-application") {
    errors.push("Modern Worker assets must use SPA fallback handling");
  }
  const workerFirst = config.assets?.run_worker_first;
  if (!Array.isArray(workerFirst) || !workerFirst.includes("/api/*")) {
    errors.push("Modern Worker must run /api/* through the Worker before assets");
  }
} else if (config.main !== "vinext/server/app-router-entry") {
  errors.push("Legacy Worker main entry is not vinext/server/app-router-entry");
}

if (errors.length > 0) {
  console.error(`Cloudflare deployment preflight FAILED (${configPath}):\n`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Cloudflare deployment preflight passed (${configPath}).`);
console.log(`D1: ${d1.database_name} (${d1.database_id})`);
console.log(`R2: ${uploads.bucket_name}`);
console.log(`Rate limit: ${limiter.simple.limit}/${limiter.simple.period}s`);
console.log("Email binding: EMAIL");
