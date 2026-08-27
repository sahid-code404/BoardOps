"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  Info,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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

const TYPE_META: Record<NotificationType, { icon: typeof Info; bg: string; fg: string }> = {
  INFO: { icon: Info, bg: "bg-info/15", fg: "text-info" },
  SUCCESS: { icon: CheckCircle2, bg: "bg-success/15", fg: "text-success" },
  WARNING: { icon: AlertTriangle, bg: "bg-warning/15", fg: "text-warning" },
  DANGER: { icon: ShieldAlert, bg: "bg-destructive/15", fg: "text-destructive" },
};

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = await promise;
  if (res && typeof res === "object" && "success" in res && "data" in (res as Record<string, unknown>)) {
    return (res as unknown as { data: T }).data;
  }
  return res as T;
}

export function NotificationsSheet() {
  const open = useAppStore((s) => s.notificationsOpen);
  const setOpen = useAppStore((s) => s.setNotificationsOpen);
  const setView = useAppStore((s) => s.setView);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap<NotifResponse>(api.get("/notifications")),
    enabled: open,
    refetchInterval: open ? 15000 : false,
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

  const notifications = (data?.notifications ?? []).slice(0, 10);
  const unreadCount = data?.unreadCount ?? 0;

  const handleNotifClick = (n: Notification) => {
    if (!n.readAt) markOneRead.mutate(n.id);
    setOpen(false);
    if (n.route) {
      const viewKey = n.route.replace(/^\//, "").split("/")[0] as never;
      try {
        setView(viewKey);
      } catch {
        // ignore
      }
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    setView("notifications");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="glass-strong border-border/60 w-full sm:max-w-md p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="p-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg font-semibold">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-destructive text-white text-[10px] font-semibold">
                  {unreadCount}
                </span>
              )}
            </div>
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              loading={markAllRead.isPending}
              disabled={unreadCount === 0}
              className="text-xs"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </GlassButton>
          </div>
          <SheetDescription className="sr-only">
            Recent notifications and activity across your workspace
          </SheetDescription>
        </SheetHeader>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <ShimmerSkeleton key={i} className="h-20" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-4 py-16 text-center"
            >
              <div className="mx-auto grid place-items-center h-16 w-16 rounded-full glass-soft mb-4">
                <Inbox className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-medium text-sm">No notifications yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                New activity will show up here in real time.
              </p>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {notifications.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.INFO;
                const Icon = meta.icon;
                const isUnread = !n.readAt;
                return (
                  <motion.button
                    key={n.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ type: "spring", stiffness: 280, damping: 26 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleNotifClick(n)}
                    className="w-full text-left"
                  >
                    <GlassCard
                      hover={false}
                      className={cn(
                        "p-3.5 ring-1",
                        isUnread ? "ring-primary/30 bg-primary/5" : "ring-border/40"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("grid place-items-center h-9 w-9 rounded-xl shrink-0", meta.bg, meta.fg)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn("text-sm font-medium truncate", isUnread ? "text-foreground" : "text-foreground/80")}>
                              {n.title}
                            </p>
                            {isUnread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {n.description}
                          </p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </span>
                            {n.route && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
                                Open <ArrowRight className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border/40 safe-bottom">
          <GlassButton
            variant="secondary"
            size="md"
            className="w-full"
            onClick={handleViewAll}
          >
            <Bell className="h-4 w-4" />
            View all notifications
          </GlassButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
