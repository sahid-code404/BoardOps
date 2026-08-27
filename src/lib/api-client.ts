"use client";

import { useAuthStore } from "@/stores/use-auth-store";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type FetchOpts = RequestInit & {
  params?: Record<string, unknown>;
};

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { params, headers, ...rest } = opts;
  const token = useAuthStore.getState().token;
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    credentials: "include",
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message =
      body?.error || body?.message || (typeof body?.details === "string" ? body.details : `Request failed (${res.status})`);
    throw new ApiError(message, res.status, body);
  }
  // Return the full response envelope { success: true, data: T }.
  // Callers access `.data` on the result.
  return body as T;
}

export const api = {
  get: <T>(path: string, opts?: FetchOpts) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, data?: unknown, opts?: FetchOpts) =>
    apiFetch<T>(path, { ...opts, method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown, opts?: FetchOpts) =>
    apiFetch<T>(path, { ...opts, method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown, opts?: FetchOpts) =>
    apiFetch<T>(path, { ...opts, method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string, opts?: FetchOpts) => apiFetch<T>(path, { ...opts, method: "DELETE" }),
};
