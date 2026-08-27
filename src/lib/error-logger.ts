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

/**
 * Structured Worker log entry. Cloudflare Workers Observability captures
 * console output, so production logging must not depend on a local filesystem.
 */
export function logError(error: ErrorLogEntry) {
  const entry: ErrorLogEntry & { level: "error"; service: "boardops" } = {
    level: "error",
    service: "boardops",
    ...error,
    timestamp: error.timestamp || new Date().toISOString(),
  };

  console.error(JSON.stringify(entry));
}
