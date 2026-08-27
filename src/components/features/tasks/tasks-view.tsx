"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Cpu,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Trash2,
  Download,
  CalendarClock,
  Megaphone,
  Receipt,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Task = {
  id: string;
  type: string;
  status: string;
  progress: number;
  payload: string | null;
  result: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: string | null;
  finishedAt: string | null;
  triggeredBy: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

type ApiResponse<T> = { success: boolean; data: T };

const TYPE_META: Record<string, { label: string; icon: typeof Cpu }> = {
  MONTHLY_CLOSING: { label: "Monthly Closing", icon: CalendarClock },
  REPORT_EXPORT: { label: "Report Export", icon: Download },
  SESSION_CLEANUP: { label: "Session Cleanup", icon: Trash2 },
  BILL_GENERATION: { label: "Bill Generation", icon: Receipt },
  ANNOUNCEMENT_SCHEDULE: { label: "Announcement", icon: Megaphone },
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  QUEUED: { label: "Queued", color: "bg-muted text-muted-foreground", icon: Clock },
  RUNNING: { label: "Running", color: "bg-info/15 text-info", icon: Loader2 },
  COMPLETED: { label: "Completed", color: "bg-success/15 text-success", icon: CheckCircle2 },
  FAILED: { label: "Failed", color: "bg-destructive/15 text-destructive", icon: XCircle },
  CANCELLED: { label: "Cancelled", color: "bg-muted text-muted-foreground", icon: X },
};

export function TasksView() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", { statusFilter }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== "ALL") params.status = statusFilter;
      const r = await api.get<ApiResponse<Task[]>>("/tasks", { params });
      return r.data;
    },
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
  });

  const cleanupMutation = useMutation({
    mutationFn: () => api.post<ApiResponse<{ result: { purgedSessions: number } }>>("/tasks/cleanup"),
    onSuccess: (res) => {
      const purged = res.data?.result?.purgedSessions ?? 0;
      toast.success(`Session cleanup complete — ${purged} expired session(s) purged`);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message || "Cleanup failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/cancel`),
    onSuccess: () => {
      toast.success("Task cancelled");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to cancel"),
  });

  const stats = {
    total: tasks.length,
    queued: tasks.filter((t) => t.status === "QUEUED").length,
    running: tasks.filter((t) => t.status === "RUNNING").length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
    failed: tasks.filter((t) => t.status === "FAILED").length,
  };

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Cpu className="h-6 w-6 text-primary" />
              Background Tasks
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Async operations: monthly closing, exports, session cleanup. Auto-refreshes every 5s.
            </p>
          </div>
          <GlassButton size="sm" variant="ghost" loading={cleanupMutation.isPending} onClick={() => cleanupMutation.mutate()}>
            <Trash2 className="h-4 w-4" />
            Run Session Cleanup
          </GlassButton>
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Cpu className="h-3.5 w-3.5" />Total</div>
            <p className="text-2xl font-bold tabular-nums"><AnimatedCounter value={stats.total} /></p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Clock className="h-3.5 w-3.5" />Queued</div>
            <p className="text-2xl font-bold tabular-nums text-muted-foreground"><AnimatedCounter value={stats.queued} /></p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Loader2 className="h-3.5 w-3.5" />Running</div>
            <p className="text-2xl font-bold tabular-nums text-info"><AnimatedCounter value={stats.running} /></p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><CheckCircle2 className="h-3.5 w-3.5" />Completed</div>
            <p className="text-2xl font-bold tabular-nums text-success"><AnimatedCounter value={stats.completed} /></p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-muted-foreground mb-1"><XCircle className="h-3.5 w-3.5" />Failed</div>
            <p className="text-2xl font-bold tabular-nums text-destructive"><AnimatedCounter value={stats.failed} /></p>
          </GlassCard>
        </div>
      </StaggerItem>

      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <div className="flex gap-1 flex-wrap">
            {["ALL", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-3 py-1.5 rounded-xl text-xs font-medium transition-all",
                  statusFilter === s ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {s === "ALL" ? "All Tasks" : STATUS_META[s]?.label || s}
              </button>
            ))}
          </div>
        </GlassCard>
      </StaggerItem>

      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => (<ShimmerSkeleton key={i} className="h-20 rounded-3xl" />))}</div>
        ) : tasks.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <Cpu className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No background tasks</p>
            <p className="text-sm text-muted-foreground">Tasks will appear here when async operations are triggered.</p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {tasks.map((t) => {
                const typeMeta = TYPE_META[t.type] || { label: t.type, icon: Cpu };
                const statusMeta = STATUS_META[t.status] || STATUS_META.QUEUED;
                const Icon = typeMeta.icon;
                const StatusIcon = statusMeta.icon;
                let payload: Record<string, unknown> | null = null;
                let result: Record<string, unknown> | null = null;
                try { payload = t.payload ? JSON.parse(t.payload) : null; } catch {}
                try { result = t.result ? JSON.parse(t.result) : null; } catch {}
                return (
                  <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
                    <GlassCard className="p-4" hover>
                      <div className="flex items-start gap-3">
                        <div className={cn("grid place-items-center h-10 w-10 rounded-xl shrink-0", statusMeta.color)}>
                          <Icon className={cn("h-5 w-5", t.status === "RUNNING" && "animate-spin")} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-semibold text-sm">{typeMeta.label}</p>
                            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1", statusMeta.color)}>
                              <StatusIcon className={cn("h-2.5 w-2.5", t.status === "RUNNING" && "animate-spin")} />
                              {statusMeta.label}
                            </span>
                            {t.retryCount > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Retry {t.retryCount}/{t.maxRetries}</span>
                            )}
                          </div>
                          {t.status === "RUNNING" && (
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-1">
                              <div className="h-full bg-info rounded-full transition-all" style={{ width: `${t.progress}%` }} />
                            </div>
                          )}
                          {payload && (
                            <p className="text-[10px] text-muted-foreground font-mono truncate">
                              {Object.entries(payload).map(([k, v]) => `${k}=${v}`).join(", ")}
                            </p>
                          )}
                          {result && t.status === "COMPLETED" && (
                            <p className="text-[10px] text-success font-mono truncate">
                              {Object.entries(result).map(([k, v]) => `${k}=${v}`).join(", ")}
                            </p>
                          )}
                          {t.errorMessage && <p className="text-[10px] text-destructive truncate">{t.errorMessage}</p>}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span>Created {format(new Date(t.createdAt), "d MMM, h:mm:ss a")}</span>
                            {t.startedAt && <span>· Started {format(new Date(t.startedAt), "h:mm:ss a")}</span>}
                            {t.finishedAt && <span>· Finished {format(new Date(t.finishedAt), "h:mm:ss a")}</span>}
                            {t.user && <span>· by {t.user.name}</span>}
                          </div>
                        </div>
                        {(t.status === "QUEUED" || t.status === "RUNNING") && (
                          <GlassButton variant="ghost" size="sm" className="text-destructive" onClick={() => cancelMutation.mutate(t.id)}>
                            <X className="h-3.5 w-3.5" />
                          </GlassButton>
                        )}
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
