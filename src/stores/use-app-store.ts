"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewKey =
  | "dashboard"
  | "meals"
  | "user-meals"
  | "kitchen"
  | "billing"
  | "payments"
  | "expenses"
  | "funds"
  | "monthly-closing"
  | "formula-engine"
  | "users"
  | "notifications"
  | "settings"
  | "system"
  | "profile";

type AppState = {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
  notificationsOpen: boolean;
  setNotificationsOpen: (v: boolean) => void;
  pendingAction: { label: string; description?: string } | null;
  setPendingAction: (a: { label: string; description?: string } | null) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "dashboard",
      setView: (v) => set({ view: v }),
      sidebarOpen: false,
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      commandOpen: false,
      setCommandOpen: (v) => set({ commandOpen: v }),
      notificationsOpen: false,
      setNotificationsOpen: (v) => set({ notificationsOpen: v }),
      pendingAction: null,
      setPendingAction: (a) => set({ pendingAction: a }),
    }),
    { name: "boardops-ui" }
  )
);
