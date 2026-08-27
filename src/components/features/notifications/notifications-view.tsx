"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCheck,
  Info,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/use-app-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type NotificationType = "INFO" | "SUCCESS" | "WARNING" | "DANGER";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type Notification = {
  id: string;
  title: string;
  description: string;
  type: NotificationType;
  priority: Priority;
  route?: string;
  readAt: string | null;
  createdAt: string;
};

type NotifResponse = { notifications: Notification[]; unreadCount: number };

type Filter = "ALL" | "UNREAD" | "INFO" | "SUCCESS" | "WARNING" | "DANGER";

const TYPE_META: Record<NotificationType, { icon: typeof Info; bg: string; fg: string; ring: string; label: string }> = {
  INFO: { icon: Info, bg: "bg-info/15", fg: "text-info", ring: "ring-info/30", label: "Info" },
  SUCCESS: { icon: CheckCircle2, bg: "bg-success/15", fg: "text-success", ring: "ring-success/30", label: "Success" },
  WARNING: { icon: AlertTriangle, bg: "bg-warning/15", fg: "text-warning", ring: "ring-warning/30", label: "Warning" },
  DANGER: { icon: ShieldAlert, bg: "bg-destructive/15", fg: "text-destructive", ring: "ring-destructive/30", label: "Alert" },
};

const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  LOW: { label: "Low", className: "bg-muted text-muted-foreground" },
  NORMAL: { label: "Normal", className: "bg-info/15 text-info" },
  HIGH: { label: "High", className: "bg-warning/15 text-warning" },
  URGENT: { label: "Urgent", className: "bg-destructive/15 text-destructive" },
};

const FILTERS: { key: Filter; label: string; short: string }[] = [
  { key: "ALL", label: "All", short: "All" },
  { key: "UNREAD", label: "Unread", short: "Unread" },
  { key: "INFO", label: "Info", short: "Info" },
  { key: "SUCCESS", label: "Success", short: "Success" },
  { key: "WARNING", label: "Warning", short: "Warning" },
  { key: "DANGER", label: "Alerts", short: "Alerts" },
];

// Defensive unwrap — handles both { success, data } and raw payloads.
async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = await promise;
  if (res && typeof res === "object" && "success" in res && "data" in (res as Record<string, unknown>)) {
    return (res as unknown as { data: T }).data;
  }
  return res as T;
}

export function NotificationsView() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const setView = useAppStore((s) => s.setView);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap<NotifResponse>(api.get("/notifications")),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap<{ success: boolean }>(api.patch("/notifications", { markAllRead: true })),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<NotifResponse>(["notifications"]);
      if (prev) {
        qc.setQueryData<NotifResponse>(["notifications"], {
          ...prev,
          notifications: prev.notifications.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })),
          unreadCount: 0,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
      toast.error("Failed to mark all as read");
    },
    onSuccess: () => toast.success("All notifications marked as read"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => unwrap<{ success: boolean }>(api.patch("/notifications", { id })),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<NotifResponse>(["notifications"]);
      if (prev) {
        qc.setQueryData<NotifResponse>(["notifications"], {
          ...prev,
          notifications: prev.notifications.map((n) =>
            n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
          ),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const filtered = notifications.filter((n) => {
    if (filter === "ALL") return true;
    if (filter === "UNREAD") return !n.readAt;
    return n.type === filter;
  });

  const handleNotifClick = (n: Notification) => {
    if (!n.readAt) markOneRead.mutate(n.id);
    if (n.route) {
      // route may be a view key like "dashboard" or a path like "/dashboard"
      const viewKey = n.route.replace(/^\//, "").split("/")[0] as never;
      try {
        setView(viewKey);
      } catch {
        // ignore unknown view keys
      }
    }
  };

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Action bar — centered glass card button */}
      <StaggerItem>
        <div className="flex items-center justify-center">
          <GlassButton
            variant="ghost"
            size="lg"
            onClick={() => markAllRead.mutate()}
            loading={markAllRead.isPending}
            disabled={unreadCount === 0}
            className="shrink-0 glass text-primary hover:text-primary font-semibold"
          >
            <CheckCheck className="h-5 w-5" />
            Mark all read
          </GlassButton>
        </div>
      </StaggerItem>

      {/* Filters — same design as users page: compact pills, short/long labels */}
      <StaggerItem>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const badge = f.key === "UNREAD" && unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : null;
            return (
              <motion.button
                key={f.key}
                whileTap={{ scale: 0.96 }}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-xl text-[11px] font-medium transition-all whitespace-nowrap shrink-0",
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "glass-soft text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{f.short}</span>
                {badge !== null && (
                  <span className={cn(
                    "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                    active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-destructive text-white"
                  )}>
                    {badge}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </StaggerItem>

      {/* List */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-24" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.INFO;
                const Icon = meta.icon;
                const prio = PRIORITY_META[n.priority] ?? PRIORITY_META.NORMAL;
                const isUnread = !n.readAt;
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 280, damping: 26 }}
                  >
                    <GlassCard
                      hover
                      className={cn(
                        "p-4 cursor-pointer",
                        isUnread && "ring-1 ring-primary/30",
                        meta.ring
                      )}
                      onClick={() => handleNotifClick(n)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Fixed symmetrical icon */}
                        <div className={cn("grid place-items-center h-10 w-10 rounded-xl shrink-0", meta.bg, meta.fg)}>
                          <Icon className="h-[18px] w-[18px]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Title row */}
                          <div className="flex items-center gap-2">
                            {isUnread && (
                              <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />
                            )}
                            <h3 className={cn("font-medium text-sm truncate flex-1", isUnread ? "text-foreground" : "text-muted-foreground")}>
                              {n.title}
                            </h3>
                            <Badge variant="outline" className={cn("text-[10px] shrink-0 h-5", prio.className)}>
                              {prio.label}
                            </Badge>
                          </div>
                          {/* Description */}
                          <p className={cn("text-xs mt-1 line-clamp-2", isUnread ? "text-foreground/70" : "text-muted-foreground")}>
                            {n.description}
                          </p>
                          {/* Footer row */}
                          <div className="flex items-center justify-between mt-2.5 gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </span>
                            {n.route && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                                View <ArrowRight className="h-3 w-3" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>
    </StaggerGroup>
  );
}

function EmptyState() {
  return (
    <GlassCard className="p-10 text-center" hover={false} glow="primary">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
        className="mx-auto max-w-sm space-y-4"
      >
        <div className="relative mx-auto h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-success/20 blur-xl" />
          <div className="relative grid place-items-center h-full w-full rounded-full glass-strong">
            <Sparkles className="h-10 w-10 text-success" />
          </div>
        </div>
        <div>
          <h3 className="text-xl font-semibold">You're all caught up</h3>
          <p className="text-sm text-muted-foreground mt-1">
            No notifications to show here. New activity will appear automatically.
          </p>
        </div>
      </motion.div>
    </GlassCard>
  );
}
