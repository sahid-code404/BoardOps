"use client";

import { motion, AnimatePresence } from "framer-motion";
import { groupedNavForRole } from "./nav-groups";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { cn } from "@/lib/utils";
import { Sparkles, ChevronRight, X } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useEffect } from "react";

const AVATAR_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-indigo-500 to-purple-500",
];

function gradientFor(name: string) {
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  USER: "Resident",
};

/** Premium mobile sidebar — slides in from the left with glassmorphic panel,
 *  grouped navigation, brand header, and user card. Matches desktop quality. */
export function MobileSidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? "USER";
  const groups = groupedNavForRole(role as "ADMIN" | "USER");

  // Lock body scroll when open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  const handleNav = (v: typeof view) => {
    setView(v);
    setSidebarOpen(false);
  };

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          />

          {/* Sidebar panel */}
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed left-0 top-0 bottom-0 z-50 w-[85vw] max-w-sm flex flex-col safe-top safe-bottom"
          >
            <div className="m-2 mr-1 glass-strong rounded-3xl flex-1 flex flex-col overflow-hidden shadow-2xl">
              {/* Brand header */}
              <div className="p-5 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
                    <Sparkles className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground leading-tight">BoardOps</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Operations Suite
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="grid place-items-center h-9 w-9 rounded-xl glass-soft text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* User card */}
              <div className="p-4 border-b border-border/40">
                <button
                  onClick={() => handleNav("profile")}
                  className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-secondary/40 transition-colors text-left"
                >
                  <Avatar className="h-11 w-11 rounded-2xl">
                    {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user?.name || "User"} />}
                    <AvatarFallback
                      className={cn(
                        "rounded-2xl bg-gradient-to-br text-white font-bold text-sm",
                        gradientFor(user?.name || "U")
                      )}
                    >
                      {user?.name ? initials(user.name) || "U" : "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold">{user?.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {ROLE_LABELS[user?.role || "USER"] || user?.role}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </div>

              {/* Grouped navigation */}
              <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-5">
                {groups.map((group) => (
                  <div key={group.title}>
                    <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {group.title}
                    </p>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const active = view === item.view;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.view}
                            onClick={() => handleNav(item.view)}
                            className={cn(
                              "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-colors",
                              active
                                ? "text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            )}
                          >
                            {active && (
                              <motion.div
                                className="absolute inset-0 rounded-2xl bg-primary shadow-lg shadow-primary/30"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                              />
                            )}
                            <Icon
                              className="relative z-10 h-[18px] w-[18px]"
                              strokeWidth={active ? 2.5 : 2}
                            />
                            <span className="relative z-10 flex-1 text-left">{item.label}</span>
                            {active && (
                              <ChevronRight className="relative z-10 h-4 w-4" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
