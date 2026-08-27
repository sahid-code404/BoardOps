"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  avatarUrl?: string | null;
  room?: string | null;
  gender?: string | null;
  emergencyContact?: string | null;
  theme?: string;
  language?: string;
  timezone?: string;
  twoFactorEnabled?: boolean;
  twoFactorMethod?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
};

type AuthState = {
  user: CurrentUser | null;
  token: string | null;
  setUser: (u: CurrentUser | null) => void;
  setToken: (t: string | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
};

/**
 * SEC-3 — Auth state is now primarily stored in an httpOnly cookie set by the
 * login/verify-otp routes. The token kept here in localStorage is intentionally
 * retained for two reasons:
 *   1. As a client-side hint that the user is signed in before the first API
 *      call resolves (e.g. for the initial route guard in `AppShell`).
 *   2. As a backward-compat `Authorization: Bearer` fallback that the API
 *      accepts alongside the cookie. The server prefers the cookie when both
 *      are present (see `getSessionToken` in `src/lib/session.ts`).
 *
 * On logout, the client clears this store AND calls `/api/auth/logout`, which
 * clears the httpOnly cookie server-side.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      setUser: (u) => set({ user: u }),
      setToken: (t) => set({ token: t }),
      logout: () => set({ user: null, token: null }),
      isAuthenticated: () => !!get().token,
    }),
    { name: "boardops-auth" }
  )
);
