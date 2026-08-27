import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LOG_DIR = "/home/z/my-project/logs";
const LOG_FILE = join(LOG_DIR, "errors.log");

// Ensure log directory exists
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

export type ErrorLogEntry = {
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  userId?: string;
  ip?: string;
  statusCode?: number;
  timestamp?: string;
};

export function logError(error: ErrorLogEntry) {
  const entry: ErrorLogEntry = {
    ...error,
    timestamp: error.timestamp || new Date().toISOString(),
  };
  const line = JSON.stringify(entry) + "\n";

  try {
    appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error("[error-logger] Failed to write:", e);
  }

  // Also log to console for dev visibility
  console.error(
    `[ERROR] ${entry.timestamp} ${entry.method || ""} ${entry.path || ""} ${entry.statusCode || ""} — ${entry.message}`
  );
}
