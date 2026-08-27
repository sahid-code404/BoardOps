const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const configText = await Bun.file("wrangler.jsonc").text();
let config: Record<string, any>;

try {
  config = JSON.parse(configText);
} catch (error) {
  console.error("Cloudflare preflight failed: wrangler.jsonc must remain valid JSON/JSONC without unsupported comments for this check.");
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

const limiter = config.ratelimits?.find((entry: any) => entry.name === "AUTH_RATE_LIMITER");
if (!limiter) {
  errors.push("Missing Rate Limiting binding: AUTH_RATE_LIMITER");
} else if (!limiter.simple?.limit || !limiter.simple?.period) {
  errors.push("AUTH_RATE_LIMITER must define simple.limit and simple.period");
}

const email = config.send_email?.find((entry: any) => entry.name === "EMAIL");
if (!email) {
  errors.push("Missing Email binding: EMAIL");
}

if (config.main !== "vinext/server/app-router-entry") {
  errors.push("Worker main entry is not vinext/server/app-router-entry");
}

if (errors.length > 0) {
  console.error("Cloudflare deployment preflight FAILED:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Cloudflare deployment preflight passed.");
console.log(`D1: ${d1.database_name} (${d1.database_id})`);
console.log(`R2: ${uploads.bucket_name}`);
console.log(`Rate limit: ${limiter.simple.limit}/${limiter.simple.period}s`);
console.log("Email binding: EMAIL");
