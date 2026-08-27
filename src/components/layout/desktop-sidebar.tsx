"use client";

import { motion } from "framer-motion";
import { navForRole } from "./nav-config";
import { groupNavItems } from "./nav-groups";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { cn } from "@/lib/utils";
import { Sparkles, ChevronRight } from "lucide-react";
import { GlassButton } from "@/components/glass/glass-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function DesktopSidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const user = useAuthStore((s) => s.user);
  const setNotificationsOpen = useAppStore((s) => s.setNotificationsOpen);
  const role = user?.role ?? "USER";
  const items = navForRole(role);
  const groups = groupNavItems(items);

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-30 w-64 lg:w-72 flex-col safe-top safe-bottom">
      <div className="m-3 mr-0 glass rounded-3xl flex-1 flex flex-col overflow-hidden">
        {/* Brand */}
        <div className="p-5 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground leading-tight">BoardOps</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Operations Suite
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-6">
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
                      onClick={() => setView(item.view)}
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

        {/* User card */}
        <div className="p-3 border-t border-border/40">
          <GlassButton
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setView("profile")}
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/15 text-primary text-xs">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left min-w-0">
              <p className="truncate text-xs font-semibold">{user?.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">{user?.role}</p>
            </div>
          </GlassButton>
        </div>
      </div>

      <button
        onClick={() => setNotificationsOpen(true)}
        className="hidden lg:block absolute bottom-24 right-4 z-40"
        aria-label="Notifications"
      />
    </aside>
  );
}
