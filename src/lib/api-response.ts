import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logError } from "@/lib/error-logger";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function err(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, details },
    { status }
  );
}

export function handleApiError(e: unknown) {
  if (e instanceof ZodError) {
    logError({
      message: "Validation failed",
      statusCode: 422,
    });
    return err("Validation failed", 422, e.issues);
  }
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") {
      logError({ message: "Authentication required", statusCode: 401 });
      return err("Authentication required", 401);
    }
    if (e.message === "FORBIDDEN") {
      logError({ message: "You don't have permission for this action", statusCode: 403 });
      return err("You don't have permission for this action", 403);
    }
    if (e.message === "ACCOUNT_NOT_ACTIVE") {
      logError({ message: "Account is not active", statusCode: 403 });
      return err("Account is not active", 403);
    }
    logError({
      message: e.message,
      stack: e.stack,
      statusCode: 400,
    });
    return err(e.message, 400);
  }
  logError({
    message: "Internal server error",
    statusCode: 500,
  });
  return err("Internal server error", 500);
}
