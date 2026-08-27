"use client";

import { motion } from "framer-motion";
import { navForRole, primaryNav } from "./nav-config";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

/** Mobile bottom navigation bar — primary experience.
 *  Shows up to 4 primary items + a "More" button that opens the sidebar. */
export function MobileBottomNav() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const role = useAuthStore((s) => s.user?.role) ?? "USER";
  const allItems = navForRole(role);
  // Show 4 primary items + More button
  const primaryItems = primaryNav(role).slice(0, 4);
  const hasMore = allItems.length > primaryItems.length;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 safe-x safe-bottom"
      aria-label="Primary navigation"
    >
      <div className="mx-auto max-w-6xl px-2.5 sm:px-4 lg:px-6 pb-2 pt-1">
        <div className="glass-strong rounded-3xl px-1.5 py-1.5 flex items-center justify-around shadow-2xl">
          {primaryItems.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                onClick={() => setView(item.view)}
                className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 rounded-2xl min-w-0"
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  <motion.div
                    className="absolute inset-0 rounded-2xl bg-primary/15"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  />
                )}
                <motion.div
                  whileTap={{ scale: 0.85 }}
                  className={cn(
                    "relative z-10 transition-colors",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.5 : 2} />
                </motion.div>
                <span
                  className={cn(
                    "relative z-10 text-[9px] font-medium transition-colors truncate max-w-full",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
          {hasMore && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 rounded-2xl min-w-0"
              aria-label="More navigation"
            >
              <div className="relative z-10 text-muted-foreground">
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </div>
              <span className="relative z-10 text-[9px] font-medium text-muted-foreground">
                More
              </span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
